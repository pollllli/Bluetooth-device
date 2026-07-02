import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Modal, Alert, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import StorageService from '../services/StorageService';
import ShelfService from '../services/ShelfService';
import { getCategories } from '../services/DeviceCategoryService';
import { logError } from '../utils/ErrorHandler';
import { findFirstEmptyPosition as findFirstEmptyPositionFromUtils, getOccupiedPositionMap } from '../utils/positionUtils';

// 爬虫服务器地址保存到本地
const CRAWLER_SERVER_KEY = 'crawlerServerAddress';
// 默认爬虫服务器地址（首次启动时使用）
const DEFAULT_CRAWLER_ADDRESS = 'http://192.168.7.170:3000';

const ScanScreen = ({ navigation, route }) => {
  // 相机权限
  const [permission, requestPermission] = useCameraPermissions();
  // 提示消息相关状态
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  // 确认弹窗与位置选择弹窗的显示状态
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  // 类目选择弹窗的显示状态
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  // 当前展开的排（位置选择器中3排的展开/折叠）
  const [expandedBank, setExpandedBank] = useState(null);
  // 当前展开的类目大类（类目选择器中10个大类的展开/折叠）
  const [expandedCategory, setExpandedCategory] = useState(null);
  // 当前扫码识别到的器件信息（名称、供应商编号）
  const [currentDeviceInfo, setCurrentDeviceInfo] = useState(null);
  // 用于弹窗渲染的完整器件字段快照（从 pendingDeviceRef 同步出来，state 触发刷新）
  const [deviceSnapshot, setDeviceSnapshot] = useState(null);
  // 爬虫状态：null(未爬) | 'crawling'(爬取中) | 'success'(已爬到) | 'failed'(爬取失败)
  const [crawlStatus, setCrawlStatus] = useState(null);
  // 爬虫是否正在执行（用于弹窗显示加载状态）
  const [isCrawling, setIsCrawling] = useState(false);
  // [CRAWLER_DISABLED] 爬虫关闭后，"采购渠道"由用户在弹窗手动输入
  const [procurementChannel, setProcurementChannel] = useState('');
  // 当前上架位置（默认为第一个空位置，用户可通过位置选择器更改）
  const [currentEmptyPosition, setCurrentEmptyPosition] = useState(null);
  // 已占用的位置映射（位置号 → 器件名称），用于位置选择器显示
  const [occupiedPositions, setOccupiedPositions] = useState(new Map());
  // 提示消息的透明度动画值
  const toastOpacity = useRef(new Animated.Value(0)).current;
  // 当前亮灯的位置编号（用于熄灯操作）
  const currentLitPosition = useRef(null);
  // 爬虫服务器地址（从本地加载）
  const [crawlerServer, setCrawlerServer] = useState(DEFAULT_CRAWLER_ADDRESS);
  // 爬虫服务器配置弹窗
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [tempServerInput, setTempServerInput] = useState('');
  // 预览灯自动熄灭定时器
  const previewTimeout = useRef(null);
  // 扫码提示音引用
  const soundRef = useRef(null);
  // 暂存扫码解析出的器件数据（确认后才保存到数据库）
  const pendingDeviceRef = useRef(null);
  // 蓝牙未连接提示的防抖状态（避免频繁弹窗）
  const lastBluetoothAlertTime = useRef(0);
  // 是否已开启扫码（默认关闭，点击"扫码"按钮后才启动识别）
  // 流程：点击"扫码" → 相机开始识别 → 命中后弹确认窗 → 上架/取消 → 回到 idle（预览待命）
  // 再次扫码需用户再次点击按钮
  const [isDetecting, setIsDetecting] = useState(false);
  const detectingRef = useRef(false);
  // 器件类目数据（从存储加载，支持用户在"分类管理"页增删）
  const [categories, setCategories] = useState([]);
  // 类目搜索关键词
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  // 扫描框的实际屏幕坐标（用于判断二维码是否完全在框内）
  const scanFrameLayoutRef = useRef(null);
  // 1s 延迟定时器（扫到完整码后 1s 再弹窗，给用户视觉缓冲）
  const detectionDelayTimerRef = useRef(null);

  // 组件挂载时重置所有状态，防止弹窗重复弹出
  useEffect(() => {
    console.log('ScanScreen 组件挂载，重置所有状态');
    setShowConfirmModal(false);
    setShowPositionPicker(false);
    setCurrentDeviceInfo(null);
    setCurrentEmptyPosition(null);

    pendingDeviceRef.current = null;
    currentLitPosition.current = null;
    detectingRef.current = false;
    setIsDetecting(false);

    // 组件卸载时清理延迟定时器
    return () => {
      if (detectionDelayTimerRef.current) {
        clearTimeout(detectionDelayTimerRef.current);
        detectionDelayTimerRef.current = null;
      }
    };
  }, []);

  // 同步 isDetecting → detectingRef（供 handleBarCodeScanned 等回调读取，避免闭包过期）
  useEffect(() => {
    detectingRef.current = isDetecting;
  }, [isDetecting]);

  // 加载类目数据
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        try {
          const list = await getCategories();
          if (active) setCategories(list);
        } catch (error) {
          console.log('加载类目失败:', error);
        }
      };
      load();
      return () => {
        active = false;
      };
    }, [])
  );

  // 组件挂载时加载扫码提示音
  useEffect(() => {
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/scan_beep.wav')
        );
        soundRef.current = sound;
      } catch (error) {
        console.log('加载音效失败:', error);
      }
    };
    loadSound();
    // 组件卸载时释放音效资源
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  // 播放扫码提示音
  const playBeep = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.replayAsync();
      }
    } catch (error) {
      console.log('播放音效失败:', error);
    }
  };

  // 显示提示消息（带淡入淡出动画，1.5秒后自动消失）
  const showToast = (message) => {
    setToastMessage(message);
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  };

  /**
   * 扫码框内提示文案：根据是否正在识别切换
   */
  const getScanHintText = () => {
    return isDetecting ? '正在识别…' : '将二维码/条形码对准扫描框';
  };

  // 把 pendingDeviceRef 中的最新字段同步到 state（用于触发弹窗重新渲染）
  const syncDeviceSnapshot = () => {
    if (pendingDeviceRef.current) {
      setDeviceSnapshot({ ...pendingDeviceRef.current });
    }
  };

  // 恢复扫码状态：回到预览待命状态，等待用户再次点击"扫码"按钮
  const resumeScanning = useCallback(() => {
    setIsDetecting(false);
  }, []);

  /**
   * 强制重置扫码（兜底）：用于相机原生层异常、扫码中途被中断等场景
   */
  const resetCamera = useCallback(() => {
    setIsDetecting(false);
    // 下一帧再开启，给原生相机一个释放时间
    setTimeout(() => {
      setIsDetecting(true);
    }, 150);
  }, []);

  /**
   * 用户点击"扫码"按钮：
   *   进入识别态，相机开始识别二维码/条码
   *   命中后弹确认窗，确认/取消后回到 idle（预览待命）
   *   下一次扫码需用户再次点击本按钮
   */
  const handleStartScan = useCallback(() => {
    if (isDetecting) return; // 已在识别中
    if (showConfirmModal || showPositionPicker) return; // 弹窗优先
    setIsDetecting(true);
  }, [isDetecting, showConfirmModal, showPositionPicker]);

  /**
   * 判断识别到的二维码是否完整在扫描框内（边角露出则不算）
   * @param {Object} qrBounds - onBarcodeScanned 返回的边界，格式 {origin:{x,y}, size:{width,height}} 或 {x,y,width,height}
   * @param {Object} frameLayout - 扫描框 onLayout 拿到的 {x, y, width, height}
   * @returns {boolean}
   */
  const isQrFullyInFrame = (qrBounds, frameLayout) => {
    if (!qrBounds || !frameLayout) return false;

    // 兼容两种 bounds 格式
    const qrLeft   = qrBounds.origin ? qrBounds.origin.x : (qrBounds.x ?? 0);
    const qrTop    = qrBounds.origin ? qrBounds.origin.y : (qrBounds.y ?? 0);
    const qrW      = qrBounds.size   ? qrBounds.size.width  : (qrBounds.width  ?? 0);
    const qrH      = qrBounds.size   ? qrBounds.size.height : (qrBounds.height ?? 0);
    const qrRight  = qrLeft + qrW;
    const qrBottom = qrTop  + qrH;

    // 容差：10 像素内都算贴边，避免一两个像素的抖动反复"识别/丢失"
    const tolerance = 10;
    const frameLeft   = frameLayout.x + tolerance;
    const frameTop    = frameLayout.y + tolerance;
    const frameRight  = frameLayout.x + frameLayout.width  - tolerance;
    const frameBottom = frameLayout.y + frameLayout.height - tolerance;

    return (
      qrLeft   >= frameLeft  &&
      qrTop    >= frameTop   &&
      qrRight  <= frameRight &&
      qrBottom <= frameBottom
    );
  };

  // 发送灯光指令（亮灯/熄灯）到蓝牙设备
  const sendLightCommand = async (type, position) => {
    if (!global.deviceConnection || !global.deviceConnection.handler) return;
    try {
      await global.deviceConnection.handler.sendCommand({ type, lightId: position });
    } catch (error) {
      console.log('灯光指令发送失败:', error);
    }
  };

  // 组件卸载时熄灭当前亮着的灯
  useEffect(() => {
    return () => {
      if (currentLitPosition.current !== null) {
        sendLightCommand('lightOff', currentLitPosition.current);
      }
    };
  }, []);

  // 加载保存的爬虫服务器地址
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(CRAWLER_SERVER_KEY);
        if (saved) setCrawlerServer(saved);
      } catch (e) {
        console.log('加载爬虫地址失败:', e);
      }
    })();
  }, []);

  // 查找指定库存上第一个空位置(0-89) —— 包装共享工具
  const findFirstEmptyPosition = async () => {
    const [devices, shelfId] = await Promise.all([
      StorageService.getDevices(),
      ShelfService.getCurrentShelfId(),
    ]);
    return findFirstEmptyPositionFromUtils(devices, shelfId, 90);
  };

  /**
   * 加载已占用的位置映射(按当前库存过滤)
   */
  const loadOccupiedPositions = async () => {
    const [devices, shelfId] = await Promise.all([
      StorageService.getDevices(),
      ShelfService.getCurrentShelfId(),
    ]);
    setOccupiedPositions(getOccupiedPositionMap(devices, shelfId));
  };

  /**
   * 获取所有位置信息（0-239，共240个位置，分8排，每排30个）
   */
  const getAllPositions = () => {
    const positions = [];
    for (let i = 0; i < 240; i++) {
      positions.push({
        position: i,
        isOccupied: occupiedPositions.has(i),
        deviceName: occupiedPositions.get(i) || '',
      });
    }
    return positions;
  };

  // 解析二维码数据（格式：key1:value1,key2:value2,...）
  const parseQRCode = (data) => {
    try {
      console.log('原始二维码数据:', data);
      const result = {};
      const pairs = data.split(',');
      pairs.forEach(pair => {
        const colonIndex = pair.indexOf(':');
        if (colonIndex > 0) {
          const key = pair.substring(0, colonIndex).trim();
          const value = pair.substring(colonIndex + 1).trim();
          result[key] = value;
          console.log(`解析字段: ${key} = ${value}`);
        }
      });
      console.log('解析结果:', result);
      return result;
    } catch (error) {
      console.error('二维码解析失败:', error);
      return {};
    }
  };

  // 扫码回调：识别到条码/二维码后触发
  const handleBarCodeScanned = async ({ type, data, bounds }) => {
    // 仅在识别态才处理（用 detectingRef 避免闭包过期）
    if (!detectingRef.current) return;
    // 确认弹窗显示时不处理新扫码
    if (showConfirmModal) return;

    // ★ 关键：必须二维码完整在扫描框内才识别（边角露出则忽略）
    if (!isQrFullyInFrame(bounds, scanFrameLayoutRef.current)) {
      // 不完整：不暂停识别、不显示绿点，让用户继续对准
      return;
    }

    // 完整识别：暂停识别（防止连击），保持相机继续打开
    detectingRef.current = false;
    setIsDetecting(false);

    // 清理上一次的延迟定时器（如果存在）
    if (detectionDelayTimerRef.current) {
      clearTimeout(detectionDelayTimerRef.current);
    }
    // 0.5s 后弹窗（用户视觉缓冲）
    detectionDelayTimerRef.current = setTimeout(async () => {
      detectionDelayTimerRef.current = null;
      await processParsedQrCode(type, data);
    }, 500);
  };

  /**
   * 处理识别到的二维码内容（绿点显示 1s 后被调用）
   * 包含：解析 → 字段提取 → 校验 → 写入弹窗快照
   */
  const processParsedQrCode = async (type, data) => {
    // 解析二维码内容
    const parsed = parseQRCode(data);

    // 支持多种字段名映射（适配不同格式的二维码）
    // 注意：立创二维码里"没有值"的字段是字面字符串 "null"，需要过滤掉
    const cleanStr = (v) => {
      if (v == null) return '';
      const s = String(v).trim();
      if (!s) return '';
      // 字面字符串"null"/"undefined"/"无"等都视为空
      if (['null', 'undefined', 'none', 'n/a', 'na', '无', '/', '-'].includes(s.toLowerCase())) return '';
      return s;
    };
    const supplierId = cleanStr(parsed.pc || parsed.code || parsed.supplierId || parsed.id || parsed['供应商编号']);  // 供应商编号
    const deviceName = cleanStr(parsed.pm || parsed.name || parsed.model || parsed.part || parsed['器件名称'] || parsed['型号']);   // 器件名称
    const brand = cleanStr(parsed.brand || parsed.b || parsed.manufacturer || parsed['品牌']);               // 品牌
    const devicePackage = cleanStr(parsed.pkg || parsed.package || parsed.p || parsed['封装']);              // 封装
    const notes = cleanStr(parsed.notes || parsed.remark || parsed.desc || parsed.description || parsed['描述'] || parsed['备注']); // 描述/备注
    const quantity = parseInt(parsed.qty || parsed.quantity || parsed.count || parsed.num || parsed['数量']) || 1; // 数量，默认为1

    // 类目可以来自多个字段（mc是立创二维码的类目字段）
    let category = cleanStr(parsed.mc || parsed.cat || parsed.category || parsed.type || parsed.c || parsed['类目'] || parsed['类别'] || parsed['分类']);
    if (!category && notes) {
      category = notes;
    }

    // 参数值字段（用于存储电气参数如频率、电压等）
    const params = parsed.params || parsed.param || parsed.spec || parsed['参数'] || '';                 // 参数（不再解析pdi字段）

    console.log('提取的字段:', { supplierId, deviceName, brand, devicePackage, category, notes, params, quantity });

    // 校验：必须有供应商编号
    if (!supplierId) {
      showToast('未识别到供应商编号');
      resumeScanning();
      return;
    }

    // 校验：必须连接蓝牙设备才能上架
    if (!global.deviceConnection) {
      const now = Date.now();
      // 防抖：5秒内不重复提示
      if (now - lastBluetoothAlertTime.current > 5000) {
        lastBluetoothAlertTime.current = now;
        Alert.alert(
          '提示',
          '蓝牙未连接，无法上架器件。请先在连接页面连接蓝牙设备。',
          [
            { text: 'OK', style: 'cancel' },
            {
              text: '去连接',
              onPress: () =>
                navigation.navigate('MainTabs', { screen: 'Connection' }),
            },
          ]
        );
      }
      resumeScanning();
      return;
    }

    try {
      // 查找第一个空位置
      const emptyPosition = await findFirstEmptyPosition();
      if (emptyPosition === null) {
        showToast('器件架已满，没有空位置');
        resumeScanning();
        return;
      }

      // [CRAWLER_DISABLED] 暂时关闭爬虫，电气参数解析也暂不启用（仅保留代码便于后续恢复）
      /*
      // 从二维码中提取值字段（支持多种字段名）
      const valueStr = parsed.val || parsed.value || parsed.v || params || parsed['值'] || '';
      // 解析电气参数（支持复合值如 "10uf/50V"）
      const electricalParams = { resistance: '', voltage: '', capacitance: '', inductance: '', current: '', power: '', frequency: '' };
      if (valueStr) {
        // 按斜杠、逗号、空格拆分复合值
        const parts = valueStr.trim().split(/[/,，\s]+/).filter(p => p.trim());
        for (const part of parts) {
          const v = part.trim();
          // 电阻（Ω/ohm）
          if (/^\d+\.?\d*\s*[kKMmμuGg]?\s*[ΩΩRr]$/i.test(v) || /^\d+\.?\d*\s*[kKMmμuGg]?\s*ohm$/i.test(v)) {
            electricalParams.resistance = v;
          // 频率（Hz）
          } else if (/^\d+\.?\d*\s*[kKMmGgT]?\s*[Hh]z$/i.test(v)) {
            electricalParams.frequency = v;
          // 电容（F）
          } else if (/^\d+\.?\d*\s*[pPnNμuUmM]?\s*[Ff]$/i.test(v)) {
            electricalParams.capacitance = v;
          // 电感（H）
          } else if (/^\d+\.?\d*\s*[nNμuUmM]?\s*[Hh]$/i.test(v)) {
            electricalParams.inductance = v;
          // 电压（V）
          } else if (/^\d+\.?\d*\s*[mMkK]?\s*[Vv]$/i.test(v)) {
            electricalParams.voltage = v;
          // 电流（A）
          } else if (/^\d+\.?\d*\s*[nNμuUmMkK]?\s*[Aa]$/i.test(v)) {
            electricalParams.current = v;
          // 功率（W）
          } else if (/^\d+\.?\d*\s*[mMkK]?\s*[Ww]$/i.test(v)) {
            electricalParams.power = v;
          }
        }
      }
      */
      const valueStr = '';
      const electricalParams = { resistance: '', voltage: '', capacitance: '', inductance: '', current: '', power: '', frequency: '' };

      // [CRAWLER_DISABLED] 不再保存需要爬虫才能补全的字段
      // 当前策略：只存 QR 码里直接读到的 名称/编号/数量 + 用户手动输入的"采购渠道"
      // 备注：原"品牌"字段保留为存储键名 brand，但语义改为"采购渠道"，由用户手动填写
      // 多库存: 扫码上架归属当前选中库存
      const currentShelfId = await ShelfService.getCurrentShelfId();
      const newDevice = {
        name: deviceName || '',
        supplierId: supplierId,
        // package: devicePackage,   // [CRAWLER_DISABLED] 隐藏
        // category: rawCategory,    // [CRAWLER_DISABLED] 隐藏（爬虫已关，从 QR 拿到的类目也忽略）
        // notes: notes,             // [CRAWLER_DISABLED] 隐藏
        brand: '',                  // [采购渠道] 爬虫关闭后由用户在弹窗手动输入
        // value: valueStr,          // [CRAWLER_DISABLED] 隐藏
        // resistance, voltage, ...  // [CRAWLER_DISABLED] 隐藏
        position: '',
        shelfId: currentShelfId,
        location: String(emptyPosition),
        quantity: parseInt(quantity) || 1,
      };

      // 【自动归类】QR 没带类目时，根据 name/notes 等智能匹配分类树
      // 让用户能通过左上角"全部器件 ▼"下拉准确筛选到
      try {
        const { autoClassifyDevice } = await import('../services/DeviceCategoryService');
        const classification = await autoClassifyDevice(newDevice);
        if (classification) {
          newDevice.category = classification.sub;
          newDevice.bigCategory = classification.big;
          console.log(
            `[扫码自动归类] ${classification.sub} (来源=${classification.source})`
          );
        }
      } catch (clsErr) {
        console.warn('[扫码自动归类] 失败，不影响扫码流程:', clsErr);
      }

      pendingDeviceRef.current = newDevice;

      // 播放扫码提示音
      playBeep();

      // 点亮第一个空位置的指示灯（先熄灭之前亮着的灯）
      if (currentLitPosition.current !== null) {
        await sendLightCommand('lightOff', currentLitPosition.current);
        await new Promise(resolve => setTimeout(resolve, 300)); // 等待熄灯完成
      }
      await sendLightCommand('lightOn', emptyPosition);
      currentLitPosition.current = emptyPosition;

      // 立即显示弹窗，使用二维码中的数据
      setCurrentDeviceInfo({ name: deviceName || supplierId, supplierId });
      setCurrentEmptyPosition(emptyPosition);
      setDeviceSnapshot({ ...newDevice });
      // [CRAWLER_DISABLED] 初始化"采购渠道"输入框（每次扫码重置为空）
      setProcurementChannel('');
      setShowConfirmModal(true);
      setCrawlStatus(null);
      setIsCrawling(false);

      // 更新暂存的器件数据（使用二维码数据）
      // [CRAWLER_DISABLED] 暂时关闭爬虫，brand/category/package/notes 不再写入
      if (pendingDeviceRef.current) {
        if (deviceName) pendingDeviceRef.current.name = deviceName;
        // if (brand) pendingDeviceRef.current.brand = brand;             // [CRAWLER_DISABLED]
        // if (category) pendingDeviceRef.current.category = category;    // [CRAWLER_DISABLED]
        // if (devicePackage) pendingDeviceRef.current.package = devicePackage; // [CRAWLER_DISABLED]
        // if (notes) pendingDeviceRef.current.notes = notes;             // [CRAWLER_DISABLED]
        // 同步刷新弹窗快照
        setDeviceSnapshot({ ...pendingDeviceRef.current });
      }

      // [CRAWLER_DISABLED] 暂时关闭爬虫功能，保留代码用于后续升级
      // 当前策略：扫码扫到什么就存什么数据，只用 QR 码里直接读到的 名称/编号/数量
      // 品牌/封装/类目/电气参数等需要爬虫才能补全的字段暂不获取
      /*
      if (supplierId && (!deviceName || !brand || !category || !devicePackage)) {
        await runCrawler(supplierId, deviceName, brand, category, devicePackage);
      } else {
        // 二维码已包含完整信息，无需爬虫
        setCrawlStatus('success');
      }
      */
      // 临时占位：让 UI 跳过爬虫提示分支
      setCrawlStatus('success');
    } catch (error) {
      logError('扫码处理失败', error, 'ScanScreen.handleBarCodeScanned');
      showToast('扫码处理失败');
      resumeScanning();
    }
  };

  /**
   * 调用爬虫服务器补全器件详情。可被弹窗"重试"按钮复用。
   */
  const runCrawler = async (supplierId, deviceName, brand, category, devicePackage) => {
    setIsCrawling(true);
    setCrawlStatus('crawling');
    try {
      showToast('正在获取器件详情...');

      // 使用用户配置的爬虫服务器地址 + 几个常见地址
      const serverAddresses = [
        crawlerServer,
        'http://192.168.1.100:3000',
        'http://192.168.0.100:3000',
        'http://192.168.7.170:3000',
        'http://localhost:3000',
      ];

      let crawlResult = null;
      let crawlError = null;
      for (const server of serverAddresses) {
        try {
          console.log(`尝试爬虫服务器: ${server}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000); // 4秒超时
          const response = await fetch(`${server}/api/crawl?keyword=${encodeURIComponent(supplierId)}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
            },
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            console.log(`服务器 ${server} 响应:`, data);
            if (data && !data.error && (data.productNumber || data.name || data.brand || data.category || data.package)) {
              crawlResult = data;
              console.log('爬虫获取数据成功:', crawlResult);
              break;
            } else if (data && data.error) {
              crawlError = data.error;
              console.log(`服务器 ${server} 返回错误:`, crawlError);
            }
          } else {
            console.log(`服务器 ${server} 响应失败: ${response.status}`);
          }
        } catch (e) {
          console.log(`服务器 ${server} 不可达:`, e.message || e);
        }
      }

      setIsCrawling(false);

      if (crawlResult) {
        setCrawlStatus('success');
        if (!deviceName && crawlResult.name) {
          pendingDeviceRef.current.name = crawlResult.name;
          setCurrentDeviceInfo(prev => prev ? { ...prev, name: crawlResult.name } : prev);
        }
        if (!brand && crawlResult.brand) {
          pendingDeviceRef.current.brand = crawlResult.brand;
        }
        if (!category && crawlResult.category) {
          pendingDeviceRef.current.category = crawlResult.category;
        }
        if (!devicePackage && crawlResult.package) {
          pendingDeviceRef.current.package = crawlResult.package;
        }
        if (crawlResult.productNumber && crawlResult.productNumber !== supplierId) {
          pendingDeviceRef.current.supplierId = crawlResult.productNumber;
          setCurrentDeviceInfo(prev => prev ? { ...prev, supplierId: crawlResult.productNumber } : prev);
        }
        if (crawlResult.quantity != null && (pendingDeviceRef.current.quantity == null || pendingDeviceRef.current.quantity === 1)) {
          pendingDeviceRef.current.quantity = crawlResult.quantity;
          setCurrentDeviceInfo(prev => prev ? { ...prev, quantity: crawlResult.quantity } : prev);
        }
        setDeviceSnapshot({ ...pendingDeviceRef.current, _crawledAt: Date.now() });
        console.log(`爬虫数据已合并到弹窗 (缓存:${crawlResult._cached ? '是' : '否'})`);
        showToast(`已获取器件详情${crawlResult._cached ? '（缓存）' : ''}`);
      } else {
        setCrawlStatus('failed');
        console.warn('所有爬虫服务器均未返回数据, crawlError:', crawlError);
        showToast(`爬虫未返回数据${crawlError ? ': ' + crawlError : '，可点击下方"重新获取"或"分类"按钮手动补充'}`);
      }
    } catch (error) {
      setIsCrawling(false);
      setCrawlStatus('failed');
      console.log('爬虫调用失败:', error);
    }
  };

  /**
   * 弹窗里的"重新获取详情"按钮：仅在爬虫失败时出现，复用 runCrawler
   */
  const handleRetryCrawl = async () => {
    if (!pendingDeviceRef.current) return;
    const p = pendingDeviceRef.current;
    await runCrawler(p.supplierId, p.name, p.brand, p.category, p.package);
  };

  /**
   * 确认上架：将暂存的器件数据保存到数据库，熄灭指示灯
   */
  const handleConfirm = async () => {
    console.log('点击确认按钮，清理所有状态');
    try {
      if (pendingDeviceRef.current) {
        await StorageService.addDevice(pendingDeviceRef.current);
        pendingDeviceRef.current = null;
      }
      // 上架成功后熄灭指示灯
      if (currentLitPosition.current !== null) {
        await sendLightCommand('lightOff', currentLitPosition.current);
        currentLitPosition.current = null;
      }
      // 关闭确认弹窗，重置所有状态
      setShowConfirmModal(false);
      setShowPositionPicker(false);
      setCurrentDeviceInfo(null);
      setCurrentEmptyPosition(null);
      setDeviceSnapshot(null);
      setCrawlStatus(null);
      setIsCrawling(false);
      showToast('上架成功');
      // 回到 idle 阶段，等待用户再次点击"扫码"按钮
      setScanPhase('idle');
    } catch (error) {
      console.log('上架失败:', error);
      showToast('上架失败: ' + error.message);
      setScanPhase('idle');
    }
  };

  /**
   * 打开位置选择器：加载已占用位置，隐藏确认弹窗
   */
  const handleOpenPositionPicker = async () => {
    await loadOccupiedPositions();
    setShowConfirmModal(false);
    setExpandedBank(null);
    setShowPositionPicker(true);
  };

  /**
   * 打开类目选择器：隐藏确认弹窗，默认展开当前类目所在的大类
   */
  const handleOpenCategoryPicker = async () => {
    // 重置搜索关键词
    setCategorySearchQuery('');
    // 重新加载类目，保证拿到最新数据
    const list = await getCategories();
    setCategories(list);
    // 尝试从当前类目找到对应的大类，自动展开
    const currentCat = deviceSnapshot?.category || pendingDeviceRef.current?.category || '';
    let matchedIndex = null;
    if (currentCat) {
      matchedIndex = list.findIndex(c =>
        c.name === currentCat || (c.subCategories || []).includes(currentCat)
      );
    }
    setExpandedCategory(matchedIndex >= 0 ? matchedIndex : null);
    setShowConfirmModal(false);
    setShowCategoryPicker(true);
  };

  /**
   * 选择具体类目（小类目）后，更新暂存器件的类目字段，回到确认弹窗
   */
  const handleSelectCategory = (subCategory) => {
    if (pendingDeviceRef.current) {
      pendingDeviceRef.current.category = subCategory;
      syncDeviceSnapshot();
    }
    setShowCategoryPicker(false);
    setExpandedCategory(null);
    setShowConfirmModal(true);
  };

  /**
   * 关闭类目选择器，回到确认弹窗
   */
  const handleCancelCategoryPicker = () => {
    setShowCategoryPicker(false);
    setExpandedCategory(null);
    setCategorySearchQuery('');
    setShowConfirmModal(true);
  };

  /**
   * 从位置选择器选择位置后，仅更新位置变量，回到确认弹窗
   * 不会直接上架，需要用户在确认弹窗点击确认才会上架
   */
  const handleSelectPosition = async (position) => {
    try {
      // 只更新暂存器件的位置变量，不保存到数据库
      if (pendingDeviceRef.current) {
        pendingDeviceRef.current.location = String(position);
      }

      // 熄灭之前的灯光，点亮新选择的位灯
      if (currentLitPosition.current !== null) {
        await sendLightCommand('lightOff', currentLitPosition.current);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      await sendLightCommand('lightOn', position);
      currentLitPosition.current = position;

      // 回到确认弹窗，显示新选择的位置
      setCurrentEmptyPosition(position);
      setShowPositionPicker(false);
      setShowConfirmModal(true);
    } catch (error) {
      showToast('位置选择失败');
    }
  };

  /**
   * 位置选择器中长按位置格子时预览亮灯（不选择，仅亮灯预览）
   */
  const handlePositionPreview = async (posInfo) => {
    if (posInfo.isOccupied) return; // 已占用的位置不预览
    
    // 清除之前的自动熄灭定时器
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
    }
    
    // 关闭之前亮的灯
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // 点亮新位置的灯
    await sendLightCommand('lightOn', posInfo.position);
    currentLitPosition.current = posInfo.position;
    
    // 1.5秒后自动熄灭预览灯
    previewTimeout.current = setTimeout(async () => {
      if (currentLitPosition.current === posInfo.position) {
        await sendLightCommand('lightOff', posInfo.position);
        currentLitPosition.current = null;
      }
      previewTimeout.current = null;
    }, 1500);
  };

  // 返回按钮：熄灭灯光，导航回器件列表页
  const handleCancel = () => {
    console.log('点击返回按钮，清理所有状态');
    // 清理所有状态
    setShowConfirmModal(false);
    setShowPositionPicker(false);
    setCurrentDeviceInfo(null);
    setCurrentEmptyPosition(null);
    setDeviceSnapshot(null);
    setCrawlStatus(null);
    setIsCrawling(false);

    pendingDeviceRef.current = null;

    if (currentLitPosition.current !== null) {
      sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
    navigation.navigate('MainTabs', { screen: 'DeviceListTab' });
  };

  /**
   * 取消确认弹窗：放弃本次扫码上架，熄灭灯光，回到 idle 阶段
   */
  const handleCancelConfirm = () => {
    console.log('点击取消按钮，清理所有状态');
    pendingDeviceRef.current = null;
    if (currentLitPosition.current !== null) {
      sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
    setShowConfirmModal(false);
    setShowPositionPicker(false);
    setCurrentDeviceInfo(null);
    setCurrentEmptyPosition(null);
    setDeviceSnapshot(null);
    setCrawlStatus(null);
    setIsCrawling(false);

    // 取消上架：回到预览待命状态，用户需再次点击按钮才能继续扫码
    setIsDetecting(false);
  };

  /**
   * 关闭位置选择器，回到确认弹窗（立即熄灭预览灯）
   */
  const handleCancelPositionPicker = () => {
    // 清除预览定时器并熄灭灯光
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
      previewTimeout.current = null;
    }
    if (currentLitPosition.current !== null) {
      sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
    setShowPositionPicker(false);
    setShowConfirmModal(true);
  };

  // 熄灭当前亮着的灯
  const turnOffCurrentLight = async () => {
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
  };

  // 正在请求相机权限
  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>请求相机权限...</Text>
      </View>
    );
  }

  // 相机权限未授予，显示授权引导页
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>需要相机权限才能扫码</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>授权</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelPermissionButton} onPress={handleCancel}>
          <Text style={styles.cancelPermissionButtonText}>取消</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 主界面：相机预览 + 扫码框 + 弹窗
  return (
    <View style={styles.container}>
      {/* 相机预览（常驻，授权后即打开，用户可随时预览二维码与扫描框的相对位置） */}
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={handleBarCodeScanned}
        onMountError={({ message }) => {
          // 相机原生层挂载失败（权限被撤销、相机被占用、硬件故障等）
          logError('相机挂载失败', new Error(message), 'ScanScreen.CameraView');
          showToast(`相机启动失败：${message || '请重试'}`);
          // 相机已挂掉，关闭识别等待用户重试
          setIsDetecting(false);
        }}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'code93', 'upc_e', 'itf14'],
        }}
      />

      {/* 顶部导航栏 */}
      <View style={styles.topBar}>
        <View style={styles.placeholder} />
        <Text style={styles.scanTitle}>扫码导入器件</Text>
        <View style={styles.placeholder} />
      </View>

      {/* 扫码框（常驻），内部提示语根据是否在识别切换 */}
      <View
        style={styles.scanFrame}
        onLayout={(e) => {
          // 记录扫描框的实际屏幕坐标，用于判断二维码是否完整在框内
          scanFrameLayoutRef.current = e.nativeEvent.layout;
        }}
      >
        <View style={styles.frameCornerTopLeft} />
        <View style={styles.frameCornerTopRight} />
        <View style={styles.frameCornerBottomLeft} />
        <View style={styles.frameCornerBottomRight} />

        <Text style={styles.scanHint}>{getScanHintText()}</Text>
      </View>

      {/* "扫码"按钮：位于扫码框下方，弹窗时隐藏 */}
      {!showConfirmModal && !showPositionPicker && (
        <View style={styles.scanButtonContainer}>
          <TouchableOpacity
            style={styles.scanActionButton}
            onPress={handleStartScan}
            disabled={isDetecting}
            activeOpacity={0.8}
          >
            <Text style={styles.scanActionButtonText}>
              {isDetecting ? '识别中…' : '扫码'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 提示消息（带淡入淡出动画） */}
      {toastVisible && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* 扫码确认弹窗：显示器件信息，提供确认/位置/取消按钮 */}
      <Modal
        visible={showConfirmModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>扫码识别成功</Text>
            
            <ScrollView style={styles.modalBody}>
              {/* [CRAWLER_DISABLED] 暂时关闭爬虫，只显示 QR 码直接读到的字段：编号/名称/数量
                  以下需要爬虫才能补全的字段已隐藏（保留代码便于后续恢复） */}
              <Text style={styles.modalText}>
                编号：{currentDeviceInfo?.supplierId || 'null'}
              </Text>
              <Text style={styles.modalText}>
                名称：{deviceSnapshot?.name || 'null'}
              </Text>
              <Text style={styles.modalText}>
                器件数量：{deviceSnapshot?.quantity || 1}
              </Text>
              <Text style={styles.modalText}>
                上架位置：{currentEmptyPosition ?? 'null'}
              </Text>
              <Text style={styles.modalText}>
                类目：{deviceSnapshot?.category || '未分类'}
              </Text>

              {/* [CRAWLER_DISABLED] 爬虫状态指示器已隐藏
              {isCrawling && (
                <View style={styles.crawlStatusBox}>
                  <ActivityIndicator size="small" color="#1976d2" />
                  <Text style={styles.crawlStatusText}>正在从立创商城获取器件详情...</Text>
                </View>
              )}
              {!isCrawling && crawlStatus === 'success' && (
                <View style={[styles.crawlStatusBox, styles.crawlStatusSuccess]}>
                  <Text style={[styles.crawlStatusText, styles.crawlStatusSuccessText]}>
                    ✓ 已获取器件详情
                  </Text>
                </View>
              )}
              {!isCrawling && crawlStatus === 'failed' && (
                <View>
                  <View style={[styles.crawlStatusBox, styles.crawlStatusFailed]}>
                    <Text style={[styles.crawlStatusText, styles.crawlStatusFailedText]}>
                      ✗ 爬虫未返回数据，点击右侧按钮重试，或手动选择类目
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.retryCrawlButton}
                    onPress={handleRetryCrawl}
                    disabled={isCrawling}
                  >
                    <Text style={styles.retryCrawlButtonText}>重新获取详情</Text>
                  </TouchableOpacity>
                </View>
              )}
              */}
            </ScrollView>
            
            {/* 按钮布局：2行2列（位置/分类/确认/取消） */}
            <View style={styles.confirmButtonColumn}>
              <View style={styles.confirmButtonRow}>
                <TouchableOpacity
                  style={styles.positionButton}
                  onPress={handleOpenPositionPicker}
                >
                  <Text style={styles.positionButtonText}>位置</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.categoryButton}
                  onPress={handleOpenCategoryPicker}
                >
                  <Text style={styles.categoryButtonText}>分类</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.confirmButtonRow}>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={handleConfirm}
                >
                  <Text style={styles.confirmButtonText}>入库</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelConfirmButton}
                  onPress={handleCancelConfirm}
                >
                  <Text style={styles.cancelConfirmButtonText}>取消</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* 位置选择弹窗：8排×30个位置，点击选择，长按预览亮灯 */}
      <Modal
        visible={showPositionPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancelPositionPicker}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.positionModalContent}>
            <Text style={styles.modalTitle}>选择物理位置</Text>
            {/* 显示当前待上架的器件名称 */}
            {deviceSnapshot && (
              <Text style={styles.positionModalSubtitle}>
                {deviceSnapshot.name || deviceSnapshot.supplierId}
              </Text>
            )}
            {/* 位置网格：8排，每排可展开/折叠 */}
            <ScrollView style={styles.positionGrid}>
              {Array.from({ length: 8 }, (_, bankIndex) => (
                <View key={bankIndex}>
                  {/* 排标题（点击展开/折叠） */}
                  <TouchableOpacity
                    style={styles.positionBankHeader}
                    onPress={() => setExpandedBank(expandedBank === bankIndex ? null : bankIndex)}
                  >
                    <Text style={styles.positionBankHeaderText}>
                      第{bankIndex + 1}排（位置 {bankIndex * 30}-{bankIndex * 30 + 29}）
                    </Text>
                    <Text style={styles.positionBankHeaderArrow}>
                      {expandedBank === bankIndex ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                  {/* 展开后显示该排的位置格子 */}
                  {expandedBank === bankIndex && (
                    <View style={styles.positionGridInner}>
                      {getAllPositions()
                        .slice(bankIndex * 30, (bankIndex + 1) * 30)
                        .map((posInfo) => (
                          <TouchableOpacity
                            key={posInfo.position}
                            style={[
                              styles.positionItem,
                              posInfo.isOccupied ? styles.positionItemOccupied : styles.positionItemEmpty,
                            ]}
                            onPress={() => {
                              if (posInfo.isOccupied) return; // 已占用的位置不可选择
                              handleSelectPosition(posInfo.position);
                            }}
                            onLongPress={() => handlePositionPreview(posInfo)}
                            activeOpacity={posInfo.isOccupied ? 1 : 0.7}
                          >
                            <Text
                              style={[
                                styles.positionItemText,
                                posInfo.isOccupied ? styles.positionItemTextOccupied : styles.positionItemTextEmpty,
                              ]}
                            >
                              {posInfo.position}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
            {/* 取消按钮：关闭位置选择器，回到确认弹窗 */}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={handleCancelPositionPicker}
            >
              <Text style={styles.modalCancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 类目选择弹窗：10个大类，每个大类可展开/折叠小类目，点击小类目确认 */}
      <Modal
        visible={showCategoryPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancelCategoryPicker}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.positionModalContent}>
            <Text style={styles.modalTitle}>选择器件类目</Text>
            {/* 搜索框 */}
            <TextInput
              style={styles.categorySearchInput}
              placeholder="搜索类目..."
              value={categorySearchQuery}
              onChangeText={setCategorySearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* 显示当前已选类目 */}
            {deviceSnapshot?.category && (
              <Text style={styles.positionModalSubtitle}>
                当前：{deviceSnapshot.category}
              </Text>
            )}
            {/* 类目网格：所有大类，点击展开/折叠显示小类目 */}
            <ScrollView style={styles.positionGrid}>
              {(() => {
                if (categorySearchQuery.trim()) {
                  const query = categorySearchQuery.toLowerCase().trim();
                  const matchedSubs = [];
                  categories.forEach((cat) => {
                    cat.subCategories.forEach((sub) => {
                      if (sub.toLowerCase().includes(query)) {
                        matchedSubs.push({ big: cat.name, sub });
                      }
                    });
                  });
                  if (matchedSubs.length > 0) {
                    return (
                      <View style={styles.searchResultList}>
                        {matchedSubs.map((item, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={styles.subCategoryItem}
                            onPress={() => handleSelectCategory(item.sub)}
                          >
                            <Text style={styles.subCategoryItemText}>
                              {item.sub}
                            </Text>
                            <Text style={styles.subCategoryItemBig}>
                              {item.big}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  } else {
                    return (
                      <Text style={styles.searchEmptyText}>
                        未找到匹配的类目
                      </Text>
                    );
                  }
                }
                return categories.map((cat, idx) => (
                  <View key={cat.name}>
                    {/* 大类标题（点击展开/折叠） */}
                    <TouchableOpacity
                      style={styles.positionBankHeader}
                      onPress={() => setExpandedCategory(expandedCategory === idx ? null : idx)}
                    >
                      <Text style={styles.positionBankHeaderText}>
                        {cat.name}（{cat.subCategories.length}项）
                      </Text>
                      <Text style={styles.positionBankHeaderArrow}>
                        {expandedCategory === idx ? '▲' : '▼'}
                      </Text>
                    </TouchableOpacity>
                    {/* 展开后显示该大类的小类目 */}
                    {expandedCategory === idx && (
                      <View style={styles.subCategoryList}>
                        {cat.subCategories.map((sub) => (
                          <TouchableOpacity
                            key={sub}
                            style={styles.subCategoryItem}
                            onPress={() => handleSelectCategory(sub)}
                          >
                            <Text style={styles.subCategoryItemText}>{sub}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ));
              })()}
            </ScrollView>
            {/* 取消按钮：关闭类目选择器，回到确认弹窗 */}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={handleCancelCategoryPicker}
            >
              <Text style={styles.modalCancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 爬虫服务器配置弹窗 */}
      <Modal
        visible={showServerConfig}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowServerConfig(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>爬虫服务器配置</Text>
            <Text style={styles.modalText}>
              当前地址：
              <Text style={{ color: '#007AFF' }}>{crawlerServer}</Text>
            </Text>
            <Text style={styles.modalText}>
              请输入电脑的 IP 地址（如 192.168.7.170）
            </Text>
            <TextInput
              style={[styles.input, { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginTop: 8 }]}
              value={tempServerInput}
              onChangeText={setTempServerInput}
              placeholder="http://192.168.7.170:3000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.confirmButtonRow}>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: '#34C759' }]}
                onPress={async () => {
                  let addr = (tempServerInput || '').trim();
                  if (!addr) {
                    Alert.alert('提示', '地址不能为空');
                    return;
                  }
                  // 自动补全 http:// 前缀
                  if (!/^https?:\/\//i.test(addr)) {
                    addr = 'http://' + addr;
                  }
                  // 自动补全 :3000 端口
                  if (!/:\d+$/.test(addr)) {
                    addr = addr + ':3000';
                  }
                  try {
                    await AsyncStorage.setItem(CRAWLER_SERVER_KEY, addr);
                    setCrawlerServer(addr);
                    setShowServerConfig(false);
                    showToast('已保存: ' + addr);
                  } catch (e) {
                    Alert.alert('保存失败', String(e));
                  }
                }}
              >
                <Text style={styles.confirmButtonText}>保存</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: '#999' }]}
                onPress={() => setShowServerConfig(false)}
              >
                <Text style={styles.confirmButtonText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  /* ===== 基础布局 ===== */
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },

  /* ===== 相机权限引导页 ===== */
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  permissionText: {
    fontSize: 18,
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelPermissionButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  cancelPermissionButtonText: {
    color: '#999',
    fontSize: 16,
  },

  /* ===== 顶部导航栏 ===== */
  topBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  backButton: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  scanTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 60,
  },

  serverConfigButton: {
    width: 60,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  serverConfigButtonText: {
    fontSize: 24,
    color: '#333',
  },

  /* ===== 扫码框（四角绿色边框） ===== */
  scanFrame: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  frameCornerTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#00ff00',
  },
  frameCornerTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: '#00ff00',
  },
  frameCornerBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#00ff00',
  },
  frameCornerBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: '#00ff00',
  },
  scanHint: {
    position: 'absolute',
    bottom: -40,
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 8,
  },

  /* ===== 扫码按钮（位于扫码框下方） ===== */
  scanButtonContainer: {
    position: 'absolute',
    // 扫码框 top:30% + width:70% 的高度 ≈ 屏幕中段偏上
    // 按钮置于其下方约 16% 位置，确保可见且不与底部导航冲突
    bottom: '12%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  scanActionButton: {
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    paddingHorizontal: 56,
    borderRadius: 32,
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minWidth: 160,
    alignItems: 'center',
  },
  scanActionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },

  /* ===== 闲置状态：未开始扫码时的居中卡片（已废弃，预览常驻） ===== */
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 32,
  },
  // 【类目显示】弹窗里"器件类目"那一行的样式
  modalFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  modalFieldLabel: {
    fontSize: 14,
    color: '#666',
    minWidth: 80,
  },
  modalFieldValue: {
    flex: 1,
    fontSize: 14,
    color: '#1976d2',
    fontWeight: '500',
  },
  modalFieldValueEmpty: {
    color: '#999',
    fontStyle: 'italic',
    fontWeight: '400',
  },
  idleIconBox: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  idleIconText: {
    fontSize: 60,
  },
  idleTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  idleSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  startScanButton: {
    backgroundColor: '#4caf50',
    paddingVertical: 16,
    paddingHorizontal: 64,
    borderRadius: 32,
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  startScanButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },

  /* ===== 提示消息 ===== */
  toast: {
    position: 'absolute',
    bottom: 120,
    left: '10%',
    right: '10%',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    zIndex: 200,
  },
  toastText: {
    color: '#4caf50',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },

  /* ===== 弹窗通用样式 ===== */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 300,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    width: '80%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  modalBody: {
    width: '100%',
    marginBottom: 20,
    maxHeight: 500,
  },
  modalText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  // [采购渠道] 输入行：标签 + 输入框 横向布局
  procurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
  },
  modalLabel: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  procurementInput: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginLeft: 4,
    backgroundColor: '#fff',
    borderRadius: 4,
    minHeight: 32,
  },

  /* ===== 爬虫增强字段样式 ===== */
  crawlEnhancedText: {
    color: '#1976d2',
    fontSize: 15,
  },
  specsTitle: {
    fontWeight: '600',
    color: '#444',
    marginTop: 4,
  },
  specItem: {
    fontSize: 14,
    color: '#555',
    textAlign: 'left',
    paddingLeft: 20,
  },
  cacheHint: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  
  /* ===== 确认弹窗按钮行：2行2列布局 ===== */
  confirmButtonColumn: {
    flexDirection: 'column',
    width: '100%',
    gap: 10,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelConfirmButton: {
    flex: 1,
    backgroundColor: '#8E8E93',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelConfirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  positionButton: {
    flex: 1,
    backgroundColor: '#1976d2',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  positionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  categoryButton: {
    flex: 1,
    backgroundColor: '#ff9800',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  categoryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#4caf50',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  /* ===== 类目选择弹窗样式 ===== */
  subCategoryList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  subCategoryItem: {
    width: '48%',
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginHorizontal: '1%',
    marginBottom: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 0,
    alignItems: 'center',
  },
  subCategoryItemText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
    textAlign: 'center',
  },
  subCategoryItemBig: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  categorySearchInput: {
    width: '100%',
    height: 40,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  searchResultList: {
    paddingVertical: 4,
  },
  searchEmptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },

  /* ===== 位置选择弹窗样式 ===== */
  positionModalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
  },
  positionModalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  positionGrid: {
    maxHeight: 350,
  },
  positionBankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 6,
    marginTop: 4,
  },
  positionBankHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  positionBankHeaderArrow: {
    fontSize: 12,
    color: '#666',
  },
  positionGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  positionItem: {
    width: '18%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginHorizontal: '1%',
    marginBottom: 6,
    borderWidth: 1,
  },
  positionItemEmpty: {
    backgroundColor: '#e3f2fd',
    borderColor: '#bbdefb',
  },
  positionItemOccupied: {
    backgroundColor: '#e8f5e9',
    borderColor: '#a5d6a7',
  },
  positionItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  positionItemTextEmpty: {
    color: '#1976d2',
  },
  positionItemTextOccupied: {
    color: '#2e7d32',
  },
  positionItemDeviceName: {
    fontSize: 8,
    color: '#4caf50',
    marginTop: 1,
  },

  /* ===== 爬虫状态指示器样式 ===== */
  crawlStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#e3f2fd',
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  crawlStatusText: {
    fontSize: 13,
    color: '#1976d2',
    marginLeft: 8,
  },
  crawlStatusSuccess: {
    backgroundColor: '#e8f5e9',
    borderColor: '#81c784',
  },
  crawlStatusSuccessText: {
    color: '#2e7d32',
    marginLeft: 0,
  },
  crawlStatusFailed: {
    backgroundColor: '#fff3e0',
    borderColor: '#ffb74d',
  },
  crawlStatusFailedText: {
    color: '#e65100',
    marginLeft: 0,
  },
  retryCrawlButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderColor: '#1976d2',
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
  },
  retryCrawlButtonText: {
    color: '#1976d2',
    fontSize: 14,
    fontWeight: '500',
  },
  modalCancelButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#8E8E93',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },

  /* ===== 编辑表单样式 ===== */
  editForm: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  editFormTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  formLabel: {
    fontSize: 14,
    color: '#666',
    width: 60,
  },
  formInput: {
    flex: 1,
    fontSize: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#2196f3',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelEditButton: {
    flex: 1,
    backgroundColor: '#8E8E93',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelEditButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  
  /* ===== 编辑按钮样式 ===== */
  editButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#ff9800',
    alignItems: 'center',
    marginHorizontal: 6,
  },
  editButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  
});

export default ScanScreen;
