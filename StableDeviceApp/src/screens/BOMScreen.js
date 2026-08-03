/**
 * BOM配单屏幕
 * 用于创建、编辑和管理BOM（Bill of Materials）配单
 * 支持从Excel文件导入BOM数据，与器件架中的器件进行匹配
 * 支持蓝牙亮灯定位器件位置，以及将未上架的器件上架到指定位置
 */
import React, { useState, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Modal,
  SafeAreaView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import StorageService from '../services/StorageService';
import ShelfService from '../services/ShelfService';
import { logError } from '../utils/ErrorHandler';
import * as pendingBomImport from '../utils/pendingBomImport';
import { usePendingBomImport } from '../utils/pendingBomImport';
import { emitLightAllOff } from '../utils/lightEvents';
import {
  subscribeLightStatus,
  getLitDeviceIdsSnapshot,
  addLitDevice,
  removeLitDevice,
  clearAllLitDevices,
} from '../utils/lightStatusStore';

const BOMScreen = ({ navigation, isAdmin = false }) => {
  console.log('BOMScreen received isAdmin:', isAdmin);
  const isAdminUser = Boolean(isAdmin);

  /**
   * 状态定义说明：
   * 
   * components: 从Excel导入的BOM组件列表
   * devices: 器件架中的所有器件（用于匹配）
   * searchQuery: 搜索关键词（用于过滤BOM列表）
   * filteredComponents: 搜索过滤后的组件列表
   * isImporting: 是否正在导入文件（显示加载状态）
   * litDeviceIds: 当前已亮灯的器件ID列表（用于高亮显示）
   * showPositionPicker: 是否显示位置选择弹窗（用于上架未匹配的器件）
   * pendingComponent: 等待上架的组件（暂存，选择位置后使用）
   * expandedBank: 当前展开的排号（位置选择器中，共8排）
   * currentLitPosition: 当前亮灯的物理位置（用于位置选择器预览）
   * previewTimeout: 预览灯自动熄灭定时器
   * isOperatingRef: 操作锁，防止重复点击（避免并发操作问题）
   */
  const [components, setComponents] = useState([]);           // 导入的BOM组件列表
  const [devices, setDevices] = useState([]);                  // 器件架中的所有器件
  const [searchQuery, setSearchQuery] = useState('');          // 搜索关键词
  const [filteredComponents, setFilteredComponents] = useState([]); // 搜索过滤后的组件列表
  const [isImporting, setIsImporting] = useState(false);       // 是否正在导入文件
  const [litDeviceIds, setLitDeviceIds] = useState([]);        // 当前已亮灯的器件ID列表
  const [showPositionPicker, setShowPositionPicker] = useState(false); // 是否显示位置选择弹窗
  const [pendingComponent, setPendingComponent] = useState(null);     // 等待上架的组件（暂存）
  const [expandedBank, setExpandedBank] = useState(null);      // 当前展开的排号（位置选择器中）
  const currentLitPosition = useRef(null);                     // 当前亮灯的物理位置（用于位置选择器预览）
  const [currentShelfId, setCurrentShelfId] = useState(
    // 立即同步从 cache 拿当前库存 id, 避免首次 render 用错的默认值
    ShelfService.getCurrentShelfIdSync() || null
  );
  const previewTimeout = useRef(null);                         // 预览灯自动熄灭定时器
  const isOperatingRef = useRef(false);                        // 操作锁，防止重复点击

  // ========== 0 库存保护 ==========
  // 用户在 0 库存时仍可进入此页, 但点"导入 BOM"时弹提示并 return
  const [hasShelves, setHasShelves] = useState(true);
  useEffect(() => {
    let unsubscribe = null;
    try {
      unsubscribe = ShelfService.subscribeShelves((list) => {
        setHasShelves(Array.isArray(list) && list.length > 0);
      });
    } catch (e) {
      console.warn('ShelfService.subscribeShelves 不可用, 跳过 shelves 监听:', e?.message);
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // ========== 切库自动清空已导入的 BOM ==========
  const prevShelfRef = useRef(null);
  useEffect(() => {
    let unsubscribe = null;
    try {
      unsubscribe = ShelfService.subscribeCurrentShelf(async (newShelfId) => {
        if (!newShelfId) return;
        if (prevShelfRef.current === null) {
          // 首次回调: 仅记录, 不清空 (避免页面初始挂载时误清)
          prevShelfRef.current = newShelfId;
          return;
        }
        if (prevShelfRef.current === newShelfId) return; // 实际没变
        prevShelfRef.current = newShelfId;
        // 切库了 — 物理上"全灭灯"由 ShelfService.setCurrentShelfId 统一处理 (不依赖本页面是否 mounted)
        // 这里只负责: 清 BOM 页的本地 state (litDeviceIds / components / 搜索词)
        // 1) 通知 DeviceListScreen 同步清空它自己的 litDeviceIds
        emitLightAllOff();
        // 2) 清空 BOM 列表 (含已亮灯 / 搜索词)
        setComponents([]);
        setFilteredComponents([]);
        setLitDeviceIds([]);
        setSearchQuery('');
        setExpandedBank(null);
        setShowPositionPicker(false);
        setPendingComponent(null);
        // 3) 关闭可能残留的预览灯 (单灯位预览, 和切库全灭灯是两回事)
        if (previewTimeout.current) {
          clearTimeout(previewTimeout.current);
          previewTimeout.current = null;
        }
        if (currentLitPosition.current !== null) {
          // 异步熄灯, 不 await (不等蓝牙响应)
          sendLightCommand('lightOff', currentLitPosition.current).catch(() => {});
          currentLitPosition.current = null;
        }
        console.log('[BOM] 切库, 已清空当前 BOM 列表');
      });
    } catch (e) {
      console.warn('ShelfService.subscribeCurrentShelf 不可用, 跳过切库清空:', e?.message);
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // ==================== 蓝牙灯光控制 ====================

  /**
   * 发送灯光指令到蓝牙设备
   * @param {string} type - 指令类型：'lightOn'（点亮）或 'lightOff'（熄灭）
   * @param {number} position - 灯光位置编号
   */
  const sendLightCommand = async (type, position) => {
    if (!global.deviceConnection || !global.deviceConnection.handler) return;
    try {
      await global.deviceConnection.handler.sendCommand({ type, lightId: position });
    } catch (error) {
      console.log('灯光指令发送失败:', error);
    }
  };

  /**
   * 熄灭当前亮灯的位置（同时清除预览定时器）
   * 用于位置选择器关闭或页面离开时清理灯光状态
   */
  const turnOffCurrentLight = async () => {
    // 清除预览定时器
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
      previewTimeout.current = null;
    }
    // 熄灭灯光
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
  };

  /**
   * 熄灭所有灯 (controlAll: false) — 用于 BOM 失焦 / 切库 / 导入新数据时
   *
   * 关键: 之前 useFocusEffect 的 cleanup 只调 turnOffCurrentLight(),
   * 那个函数只灭"currentLitPosition.current" 记录的最后一个位置。
   * 如果用户在 BOM 页点了多个器件亮灯 (位置 1, 2, 3),
   * currentLitPosition 只记最后一个, 切回库存时只灭那一个, 其它残留。
   *
   * 现在改成 controlAll: false, 一帧全灭, 不依赖 litDeviceIds 的精确性。
   *
   * 【重要 — vivo 兼容性】
   * 不能返回 Promise, 不能在 cleanup 期间 await BLE 写。
   * BLE 操作必须 fire-and-forget, 推到下一个 tick (setTimeout 0) 异步执行。
   * 否则在某些 Android ROM (vivo) 上, component 失焦瞬间发起的 BLE 写会导致
   * unhandled promise rejection → RN bridge 异常 → 整棵 View 树重新挂载失败 → UI 消失。
   */
  const turnOffAllLights = () => {
    // 同步: 清预览定时器 + 重置 ref
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
      previewTimeout.current = null;
    }
    currentLitPosition.current = null;
    // 异步: 推到下一个 tick, 不阻塞 React unmount/cleanup
    setTimeout(() => {
      const conn = global.deviceConnection;
      const handler = conn && conn.handler;
      if (!handler) return;
      try {
        if (typeof handler.fastControlAll === 'function') {
          const p = handler.fastControlAll(false);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } else if (typeof handler.sendCommand === 'function') {
          const p = handler.sendCommand({ type: 'controlAll', state: false });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) {
        // 同步抛出也吞掉, 不能让它冒到 RN bridge
      }
    }, 0);
  };

  // ==================== 页面生命周期 ====================

  /**
   * 同步 lightStatusStore → BOM 本地 litDeviceIds
   *
   * 之前 BOM 自己维护一份 litDeviceIds (useState), 不订阅 store,
   * 导致其他页面 (DeviceListScreen / ShelfService.clearBomAndLights) 触发
   * clearAllLitDevices 时, BOM 这边的"亮灯"绿底不会被清掉。
   * 切回库存时物理灯灭了但 BOM 的绿底还在 — UI/物理不一致。
   *
   * 修复: 订阅 lightStatusStore 事件, 收到任何 type 都以 store 为准同步 BOM 本地 state.
   * 同时页面 mount/focus 时主动拉一次 snapshot (兜底事件错过的情况).
   *
   * 【重要 — vivo 兼容性】
   * listener 内部 setState 之前必须检查 mounted 标记。
   * 否则在某些 Android ROM (vivo) 上, component 失焦后 listener 仍可能
   * 触发 setState → "Can't perform state update on unmounted component"
   * 在该 ROM 上会触发 RN bridge 异常 → 整棵 View 树 UI 消失。
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    const unsubscribe = subscribeLightStatus(() => {
      if (!isMountedRef.current) return;
      const snap = getLitDeviceIdsSnapshot();
      setLitDeviceIds(snap);
    });
    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      isMountedRef.current = true;
      // 页面 focus 时主动拉一次 snapshot, 兜底 emit 错过
      if (isMountedRef.current) {
        const snap = getLitDeviceIdsSnapshot();
        setLitDeviceIds(snap);
      }

      loadDevices();
      // 同步当前选中库存 (从设置页/库存页切库后保持一致)
      ShelfService.getCurrentShelfId()
        .then((id) => {
          if (isMountedRef.current && id) setCurrentShelfId(id);
        })
        .catch((e) => console.warn('[BOM] 读取当前库存失败:', e));
      return () => {
        // 【关键 — vivo 兼容性】失焦时:
        //  1) 同步 set mounted = false (防止后续 store listener setState)
        //  2) 同步清空本地 litDeviceIds
        //  3) 同步 clearAllLitDevices (内部 emit 同步触发其他页面, 但 store listener 会先检查 mounted)
        //  4) 同步 emit 兜底
        //  5) turnOffAllLights() 内部把 BLE 写推到 setTimeout(0), 不阻塞 cleanup
        isMountedRef.current = false;
        setLitDeviceIds([]);
        clearAllLitDevices();
        emitLightAllOff();
        turnOffAllLights();
      };
    }, [])
  );

  /**
   * 搜索关键词变化时，实时过滤组件列表
   * 按组件名称进行模糊匹配
   */
  useEffect(() => {
    if (!searchQuery || searchQuery.trim() === '') {
      setFilteredComponents(components);
    } else {
      const query = searchQuery.toLowerCase().trim();
      const filtered = components.filter((component) => {
        // 搜索字段: 名称 / 器件名称 / 供应商编号 / 封装 / 类目 / 位置
        const fields = [
          component.name,
          component.deviceName,
          component.supplierId,
          component.package,
          component.category,
          component.location, // BOM 列表里的位置/序号
        ];
        return fields.some(
          (v) => v != null && String(v).toLowerCase().includes(query)
        );
      });
      setFilteredComponents(filtered);
    }
  }, [components, searchQuery]);

  // ==================== 数据加载 ====================

  /**
   * 从本地存储加载器件架中的所有器件
   */
  const loadDevices = async () => {
    try {
      let savedDevices = await StorageService.getDevices();
      setDevices(savedDevices);
    } catch (error) {
      logError('加载器件失败', error, 'BOMScreen.loadDevices');
    }
  };

  // ==================== BOM文件导入与解析 ====================

  /**
   * 构建Excel表头列名到列索引的映射
   * 根据中英文关键词自动识别各列的含义
   * @param {Array} headerRow - Excel表头行数据
   * @returns {Object} 列名到列索引的映射对象，-1表示未找到对应列
   */
  const buildColumnMapping = (headerRow) => {
    const mapping = {
      sortOrder: -1,      // 序号列
      deviceName: -1,     // 器件名称列
      value: -1,          // 参数值列
      supplierId: -1,     // 供应商编号列
      package: -1,        // 封装列
      position: -1,       // 位号列
      description: -1,    // 备注描述列
      category: -1,       // 类目列
      quantity: -1,       // 数量列
    };

    // 各列对应的中文/英文关键词，用于自动匹配表头
    const sortOrderKeywords = ['序号', 'no', 'index', '#'];
    // 器件名称识别优先级 (按"用户最常用的列"排, 不是按字母排):
    //   1) 明确的"名称"类列 (老表格默认, 如 "名称" / "器件名称" / "Component Name" / "型号")
    //   2) Comment 列 — 部分嘉立创导出模板**直接用 Comment 字段当器件名称**导出,
    //      且**不导出 Manufacturer Part 列**; 此时 Comment 必须能识别成名称
    //   3) Manufacturer Part (无换行的精确匹配)
    //   4) 'part' 兜底 — 防止 "Manufacturer\nPart" 含换行时漏匹配
    //      (注意: 不能用 'manufacturer part' 兜底, 因为表头里换行把它拆开了)
    const deviceNameKeywords = [
      'name', '器件名称', '名称', '器件', 'component', '型号',
      'comment',             // 部分表用 Comment 列作为器件名称 (不是参数名!)
      'manufacturer part',   // 精确匹配 (无换行的表)
      'part',                // 兜底: 含换行的 "Manufacturer\nPart"
    ];
    const valueKeywords = ['值', 'value', '数值', '规格', '参数', '参数值'];
    const supplierIdKeywords = ['supplier', '供应商', '编号', '料号', 'partno', 'pn', '供应商编号', 'vendor'];
    const packageKeywords = ['封装', 'package', '封装形式', 'footprint'];
    const positionKeywords = ['位号'];
    const descriptionKeywords = ['备注', '描述', 'description', 'desc', '说明'];
    const categoryKeywords = ['类目', '类别', '分类', 'category', 'type', '种类'];
    const quantityKeywords = ['数量', 'qty', 'amount', 'count', 'num', 'pcs'];

    // 遍历表头，根据关键词匹配各列的索引位置
    for (let i = 0; i < headerRow.length; i++) {
      const header = String(headerRow[i]).toLowerCase().trim();
      
      if (mapping.sortOrder === -1 && sortOrderKeywords.some(k => header === k.toLowerCase())) {
        mapping.sortOrder = i;
      } else if (mapping.deviceName === -1 && deviceNameKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.deviceName = i;
      } else if (mapping.value === -1 && valueKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.value = i;
      } else if (mapping.supplierId === -1 && supplierIdKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.supplierId = i;
      } else if (mapping.package === -1 && packageKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.package = i;
      } else if (mapping.position === -1 && positionKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.position = i;
      } else if (mapping.description === -1 && descriptionKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.description = i;
      } else if (mapping.category === -1 && categoryKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.category = i;
      } else if (mapping.quantity === -1 && quantityKeywords.some(k => header.includes(k.toLowerCase()))) {
        mapping.quantity = i;
      }
    }

    return mapping;
  };

  /**
   * 处理导入BOM文件
   * 打开文件选择器，读取Excel文件并解析为BOM组件数据
   */
  const handleImportBOM = async () => {
    // 0 库存时拦截: 弹提示, 不执行导入
    if (!hasShelves) {
      Alert.alert(
        '当前无库存',
        '需要先新建或导入一个库存, 才能导入 BOM 配单并与库存器件匹配。\n\n请到"设置 → 库存管理"创建。',
        [{ text: '我知道了', style: 'default' }]
      );
      return;
    }
    try {
      setIsImporting(true);

      // 打开文件选择器, 允许 xlsx / xls / csv 三种 BOM 表格格式
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
          'text/csv', // .csv
          'application/csv', // 部分 Android 来源
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setIsImporting(false);
        return;
      }

      const fileUri = result.assets[0].uri;
      const fileName = result.assets[0].name;

      // 导入前先加载最新的器件数据
      await loadDevices();

      try {
        // 将文件复制到缓存目录（统一走本地路径，便于 processBomFile 复用）
        const cacheDir = FileSystem.cacheDirectory;
        const localUri = cacheDir + fileName;

        await FileSystem.copyAsync({
          from: fileUri,
          to: localUri,
        });

        // 复用核心解析逻辑
        await processBomFile(localUri, fileName);
      } catch (error) {
        logError('处理Excel文件失败', error, 'BOMScreen.handleImportBOM');
        Alert.alert(
          '错误',
          `处理Excel文件失败: ${error.message || '请检查文件格式'}`
        );
      }
    } catch (error) {
      logError('导入BOM失败', error, 'BOMScreen.handleImportBOM');
      Alert.alert('错误', `导入BOM失败: ${error.message || '请重试'}`);
    } finally {
      setIsImporting(false);
    }
  };

  /**
   * 清空当前 BOM 匹配列表
   * 流程: 1) 关掉所有当前亮灯的器件 → 2) 清空 components / filteredComponents / litDeviceIds / 搜索词
   * 二次确认 (Alert) 防止误触
   */
  const handleClearBOM = () => {
    if (components.length === 0 && litDeviceIds.length === 0) {
      // 列表本身是空的, 没必要确认
      return;
    }
    Alert.alert(
      '清空 BOM 匹配',
      `确定要清空当前 BOM 列表（共 ${components.length} 条）吗？\n\n所有已点亮的灯也会熄灭。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: async () => {
            // 1) 一次性熄灭所有灯 (与"熄灭所有灯"按钮同协议: 0x03 + 0x0000)
            // 不管有多少灯开着, 一帧搞定 — 比逐个 lightOff 更快 + 不丢帧
            // 优先用 fastControlAll (不等 ACK + 1.5s 超时), 失败再兜底 sendCommand
            try {
              const handler = global.deviceConnection?.handler;
              if (handler) {
                if (typeof handler.fastControlAll === 'function') {
                  const r = await handler.fastControlAll(false);
                  if (!r || !r.success) {
                    try { await handler.sendCommand({ type: 'controlAll', state: false }); } catch (e) { /* ignore */ }
                  }
                } else {
                  await handler.sendCommand({ type: 'controlAll', state: false });
                }
                console.log('[BOM 清空] 一次性熄灭所有灯完成');
              }
            } catch (e) {
              console.warn('[BOM 清空] 熄灭灯光异常:', e);
              // 即使熄灯失败也继续清空列表, 至少 UI 状态干净
            }
            // 2) 走 store 集中清空 (DeviceListScreen / 后续其他页面都会收到)
            // 原因: 之前 emitLightAllOff 偶尔漏, 走 store 是单一权威源
            clearAllLitDevices();
            // 3) emit 兜底 (兼容老的 subscribeLight listener)
            emitLightAllOff();
            // 4) 清空本地 state
            setComponents([]);
            setFilteredComponents([]);
            setLitDeviceIds(getLitDeviceIdsSnapshot());
            setSearchQuery('');
            console.log('[BOM] 已清空 BOM 匹配列表');
          },
        },
      ]
    );
  };

  /**
   * 处理 BOM Excel 文件的核心流程（读取 → 解析 → 写入器件列表）
   * 既被本地文件选择器使用，也被外部应用（微信等）分享的 BOM 文件使用
   * @param {string} localUri - 缓存目录中的本地文件路径（file:// 开头或裸路径均可）
   * @param {string} [fileName] - 文件名（用于错误提示，可选）
   */
  const processBomFile = async (localUri, fileName) => {
    // 读取文件并以Base64编码解析
    const fileContent = await FileSystem.readAsStringAsync(localUri, {
      encoding: 'base64',
    });

    // 使用XLSX库解析Excel文件
    const binaryString = atob(fileContent);
    const workbook = XLSX.read(binaryString, { type: 'binary' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    await parseBOMData(csvContent, 'csv');
  };

  /**
   * 处理外部应用（微信等）传入的 BOM 文件
   *
   * 使用 usePendingBomImport() hook 替代 useFocusEffect / useNavigationState：
   *   - hook 内部订阅模块级 emitter
   *   - 每次 App.tsx 调用 pendingBomImport.set(uri, name) → 触发 BOMScreen re-render
   *   - 不依赖 navigation state、不依赖 tab focus 状态、不依赖 useFocusEffect 时序
   *   - 冷启动 / 热启动 / 已在 BOM tab / 刚切到 BOM tab 都能可靠工作
   *
   * 工作时序：
   *   - 冷启动：set() → BOMScreen 还没 mount → navigate('BOM') → BOMScreen mount
   *     → usePendingBomImport 注册 → 注册时 _state 有值 → 立即 listener
   *     → setVersion → re-render → useEffect 跑 → take() → 处理
   *   - 热启动：set() → BOMScreen 已 mount，hook 已注册 → listener 立即触发
   *     → re-render → useEffect 跑 → take() → 处理
   */
  const pendingImport = usePendingBomImport();

  useEffect(() => {
    if (!pendingImport) return;
    // 取出并清空（take 已经清空 _state，防止重复处理）
    const taken = pendingBomImport.take();
    if (!taken) return;

    console.log('[BOM] 处理待导入 BOM:', taken.fileName);
    (async () => {
      try {
        setIsImporting(true);
        await loadDevices();
        await processBomFile(taken.uri, taken.fileName);
        Alert.alert('成功', `BOM 已成功导入「${taken.fileName}」`);
      } catch (error) {
        logError('处理外部 BOM 文件失败', error, 'BOMScreen.useEffect');
        Alert.alert(
          '错误',
          `处理 BOM 文件失败: ${error.message || '请检查文件格式'}`
        );
      } finally {
        setIsImporting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImport]);

  // useFocusEffect 保留用于 turnOffCurrentLight
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        turnOffCurrentLight();
      };
    }, [])
  );

  /**
   * 将参数值字符串解析为电气参数类型
   * 支持复合值，如 "10uf/50V" 会同时识别为电容和电压
   * 分隔符支持：/ 、空格、逗号
   * @param {string} value - 参数值字符串，如 "10kΩ"、"10uf/50V"、"100nF 25V"
   * @returns {Object} 包含类型和对应参数值的对象
   */
  const parseValueToElectricalParams = (value) => {
    const empty = { type: '', resistance: '', voltage: '', capacitance: '', inductance: '', current: '', power: '', frequency: '' };
    if (!value) return empty;

    // 将复合值按分隔符拆分为多个子值
    const parts = value.split(/[/,，\s]+/).filter(p => p.trim());
    if (parts.length === 0) return empty;

    // 如果只有一个子值，直接匹配
    if (parts.length === 1) {
      return parseSingleValue(parts[0].trim(), empty);
    }

    // 多个子值时，逐个匹配并合并结果
    const result = { ...empty };
    let primaryType = '';
    for (const part of parts) {
      const parsed = parseSingleValue(part.trim(), empty);
      if (parsed.type && !primaryType) {
        primaryType = parsed.type;
      }
      if (parsed.resistance) result.resistance = parsed.resistance;
      if (parsed.voltage) result.voltage = parsed.voltage;
      if (parsed.capacitance) result.capacitance = parsed.capacitance;
      if (parsed.inductance) result.inductance = parsed.inductance;
      if (parsed.current) result.current = parsed.current;
      if (parsed.power) result.power = parsed.power;
      if (parsed.frequency) result.frequency = parsed.frequency;
    }
    result.type = primaryType;
    return result;
  };

  /**
   * 解析单个参数值字符串
   * @param {string} v - 单个参数值，如 "10kΩ"、"50V"
   * @param {Object} empty - 空模板对象
   * @returns {Object} 匹配结果
   */
  const parseSingleValue = (v, empty) => {
    // 电阻：如 10Ω、4.7kΩ、100R
    if (/^\d+\.?\d*\s*[kKMmμuGg]?\s*[ΩΩRr]$/i.test(v) || /^\d+\.?\d*\s*[kKMmμuGg]?\s*ohm$/i.test(v)) {
      return { ...empty, type: '电阻', resistance: v };
    }
    // 频率：如 16MHz、50Hz
    if (/^\d+\.?\d*\s*[kKMmGgT]?\s*[Hh]z$/i.test(v)) {
      return { ...empty, type: '频率', frequency: v };
    }
    // 电容：如 10μF、100nF、10uf
    if (/^\d+\.?\d*\s*[pPnNμuUmM]?\s*[Ff]$/i.test(v)) {
      return { ...empty, type: '电容', capacitance: v };
    }
    // 电感：如 10mH、1μH
    if (/^\d+\.?\d*\s*[nNμuUmM]?\s*[Hh]$/i.test(v)) {
      return { ...empty, type: '电感', inductance: v };
    }
    // 电压：如 5V、3.3V、50V
    if (/^\d+\.?\d*\s*[mMkK]?\s*[Vv]$/i.test(v)) {
      return { ...empty, type: '电压', voltage: v };
    }
    // 电流：如 1A、500mA
    if (/^\d+\.?\d*\s*[nNμuUmMkK]?\s*[Aa]$/i.test(v)) {
      return { ...empty, type: '电流', current: v };
    }
    // 功率：如 1W、500mW
    if (/^\d+\.?\d*\s*[mMkK]?\s*[Ww]$/i.test(v)) {
      return { ...empty, type: '功率', power: v };
    }
    return { ...empty };
  };

  /**
   * 解析BOM数据（CSV格式）
   * 自动识别表头列，提取器件信息，按序号排序后更新组件列表
   * @param {string} csvContent - CSV格式的BOM数据
   * @param {string} type - 数据类型标识
   */
  const parseBOMData = async (csvContent, type) => {
    try {
      const workbook = XLSX.read(csvContent, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (!jsonData || jsonData.length < 2) {
        Alert.alert('错误', '表格数据为空或格式不正确');
        return;
      }

      // 根据表头行构建列映射
      const headerRow = jsonData[0];
      const columnMapping = buildColumnMapping(headerRow);
      console.log('列映射结果:', columnMapping);

      const bomComponents = [];

      // 逐行解析数据（跳过表头行）
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        // 根据列映射提取各字段数据
        const packageType = row[columnMapping.package] ? String(row[columnMapping.package]).trim() : '';
        const bomPosition = row[columnMapping.position] ? String(row[columnMapping.position]).trim() : '';
        const supplierId = row[columnMapping.supplierId] ? String(row[columnMapping.supplierId]).trim() : '';
        const description = row[columnMapping.description] ? String(row[columnMapping.description]).trim() : '';
        const deviceName = row[columnMapping.deviceName] ? String(row[columnMapping.deviceName]).trim() : '';
        const category = row[columnMapping.category] ? String(row[columnMapping.category]).trim() : '';
        const value = row[columnMapping.value] ? String(row[columnMapping.value]).trim() : '';
        const sortOrder = columnMapping.sortOrder !== -1 && row[columnMapping.sortOrder] ? Number(row[columnMapping.sortOrder]) : 0;
        const quantity = columnMapping.quantity !== -1 && row[columnMapping.quantity] ? String(row[columnMapping.quantity]).trim() : '';

        // 尝试从参数值推断电气类型（如电阻、电容等）
        const electricalParams = parseValueToElectricalParams(value);
        const finalCategory = category || electricalParams.type;

        let componentName = deviceName || '';

        // 只要任意字段有数据就导入（允许名称/编号为空，导入后显示为 null）；
        // 仅当整行所有字段都为空时视为空行跳过
        const hasAnyData =
          componentName ||
          supplierId ||
          packageType ||
          bomPosition ||
          description ||
          category ||
          value ||
          (sortOrder && sortOrder > 0) ||
          quantity;
        if (hasAnyData) {
          bomComponents.push({
            name: componentName.trim() || '',
            supplierId: supplierId,
            package: packageType,
            position: bomPosition,
            description: description,
            category: finalCategory,
            value: value,
            sortOrder: sortOrder,
            quantity: quantity,         // 数量字段，仅用于BOM列表展示
            resistance: electricalParams.resistance || '',
            voltage: electricalParams.voltage || '',
            capacitance: electricalParams.capacitance || '',
            inductance: electricalParams.inductance || '',
            current: electricalParams.current || '',
            power: electricalParams.power || '',
            frequency: electricalParams.frequency || '',
            matchStatus: 'pending',
          });
        }
      }

      if (bomComponents.length > 0) {
        // 按序号排序，序号相同时按供应商编号排序
        const sortedComponents = bomComponents.sort((a, b) => {
          if (a.sortOrder && b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          } else if (a.sortOrder) {
            return -1;
          } else if (b.sortOrder) {
            return 1;
          } else if (a.supplierId && b.supplierId) {
            return a.supplierId.localeCompare(b.supplierId);
          } else if (a.supplierId) {
            return -1;
          } else if (b.supplierId) {
            return 1;
          } else {
            return a.name.localeCompare(b.name);
          }
        });
        setComponents(sortedComponents);

        // 统计匹配到的器件数量
        let matchedDeviceCount = 0;
        for (const component of sortedComponents) {
          const matchInfo = getDeviceMatchInfo(component);
          if (matchInfo.devices && matchInfo.devices.length > 0) {
            matchedDeviceCount += matchInfo.devices.length;
          }
        }

      } else {
        Alert.alert('错误', '未找到有效的器件数据');
      }
    } catch (error) {
      logError('解析BOM数据失败', error, 'BOMScreen.parseBOMData');
      Alert.alert('错误', '解析BOM数据失败，请检查文件格式');
    }
  };

  // ==================== 器件匹配逻辑 ====================

  /**
   * 获取BOM组件与器件架中器件的匹配信息
   * 匹配规则(按优先级,任一命中即视为匹配):
   * 1. 供应商编号匹配 (BOM 和库存都有编号时)
   * 2. 器件名称匹配
   * 注: 不再校验封装是否一致 — 扫码上架的器件经常没封装,
   *     强行要求封装一致会导致"其实在库"的器件被误判成"未入库"。
   * @param {Object} component - BOM组件对象
   * @returns {Object} 匹配结果,包含 exists(是否匹配)、devices(匹配到的器件列表)
   */
  const getDeviceMatchInfo = (component) => {
    console.log(`\n=== getDeviceMatchInfo 开始 ===`);
    console.log(`组件名称: ${component.name}`);
    console.log(`组件供应商编号: ${component.supplierId}`);
    console.log(`组件器件名称: ${component.deviceName}`);
    console.log(`组件封装: ${component.package}`);

    /**
     * 字符串归一化: trim + 大写, 处理空格和大小写差异
     */
    const normalize = (str) => {
      if (!str) return '';
      return String(str).trim().toUpperCase();
    };

    // 修复: BOM 匹配只看当前选中库存的器件, 而不是全部器件 (写死 '1' 的 bug)
    // 规则简化: 不再要求封装一致 (扫码上架常没封装, 强行要求封装会导致误判)
    // 只要 (编号匹配) 或 (名称匹配) 任一命中即视为匹配
    const matchedDevices = devices.filter((device, index) => {
      // 跳过非当前库存的器件
      if (device.shelfId !== currentShelfId) {
        if (index < 3) {
          console.log(
            `  [跳过] 器件[${index}] "${device.name}" shelfId="${device.shelfId}" ≠ currentShelfId="${currentShelfId}"`
          );
        }
        return false;
      }
      console.log(`\n检查器件[${index}]: ${device.name}`);
      console.log(`  器件供应商编号: ${device.supplierId}`);

      // 字符串归一化(trim + 大写)
      const compName = normalize(component.name || component.deviceName);
      const compSupplierId = normalize(component.supplierId);
      const devName = normalize(device.name);
      const devSupplierId = normalize(device.supplierId);

      // 规则1: 供应商编号匹配 (BOM 和库存都有编号)
      if (compSupplierId && devSupplierId && compSupplierId === devSupplierId) {
        console.log(`  ✓ 供应商编号匹配: ${devSupplierId}`);
        return true;
      }

      // 规则2: 器件名称匹配
      if (compName && devName && compName === devName) {
        console.log(`  ✓ 器件名称匹配: ${devName}`);
        return true;
      }

      return false;
    });

    if (matchedDevices.length > 0) {
      return {
        exists: true,
        devices: matchedDevices,
        matchedCount: matchedDevices.length,
      };
    }

    return {
      exists: false,
      devices: [],
      matchedCount: 0,
    };
  };

  /**
   * 判断BOM组件是否已在器件架中
   * @param {Object} component - BOM组件对象
   * @returns {boolean} 是否在器件架中
   */
  const isDeviceInShelf = (component) => {
    const matchInfo = getDeviceMatchInfo(component);
    return matchInfo.exists;
  };

  // ==================== 器件交互操作 ====================

  /**
   * 点击BOM列表项时的处理
   * 已连接蓝牙时，点击切换对应器件的亮灯/灭灯状态
   * 支持同时操作多个匹配的器件
   * @param {Object} component - 被点击的BOM组件
   */
  const handleComponentPress = async (component) => {
    // 检查蓝牙连接
    if (!global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      return;
    }

    // 操作锁，防止重复点击
    if (isOperatingRef.current) return;
    isOperatingRef.current = true;

    const matchInfo = getDeviceMatchInfo(component);
    if (!matchInfo.exists || !matchInfo.devices || matchInfo.devices.length === 0) {
      isOperatingRef.current = false;
      return;
    }

    // 判断当前组件的所有匹配器件是否都已亮灯
    const allLit = matchInfo.devices.every(d => litDeviceIds.includes(d.id));

    try {
      const { handler } = global.deviceConnection;

      if (allLit) {
        // 全部已亮灯 → 逐个熄灭
        for (const targetDevice of matchInfo.devices) {
          let hardwarePosition;
          if (targetDevice.location != null && targetDevice.location !== '') {
            const parsedLocation = parseInt(targetDevice.location, 10);
            hardwarePosition = isNaN(parsedLocation) ? (devices.findIndex((d) => d.id === targetDevice.id) + 1) : parsedLocation;
          } else {
            hardwarePosition = devices.findIndex((d) => d.id === targetDevice.id) + 1;
          }
          const response = await handler.sendCommand({
            type: 'lightOff',
            lightId: hardwarePosition,
          });
          if (response.success) {
            // 走 store 统一管理: 移除 + emit, 其他页面同步
            removeLitDevice(targetDevice.id);
            setLitDeviceIds(getLitDeviceIdsSnapshot());
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } else {
        // 未全部亮灯 → 逐个点亮
        for (const targetDevice of matchInfo.devices) {
          let hardwarePosition;
          if (targetDevice.location != null && targetDevice.location !== '') {
            const parsedLocation = parseInt(targetDevice.location, 10);
            hardwarePosition = isNaN(parsedLocation) ? (devices.findIndex((d) => d.id === targetDevice.id) + 1) : parsedLocation;
          } else {
            hardwarePosition = devices.findIndex((d) => d.id === targetDevice.id) + 1;
          }
          const response = await handler.sendCommand({
            type: 'lightOn',
            lightId: hardwarePosition,
          });
          if (response.success) {
            // 走 store 统一管理: 添加 + emit, 其他页面同步
            addLitDevice(targetDevice.id);
            setLitDeviceIds(getLitDeviceIdsSnapshot());
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch (error) {
      logError('器件操作失败', error, 'BOMScreen.handleComponentPress');
    } finally {
      isOperatingRef.current = false;
    }
  };

  // ==================== 位置选择器相关 ====================

  /**
   * 获取器件架中已占用的位置映射
   * @returns {Map} 位置编号 → 器件名称的映射
   */
  const getOccupiedPositions = () => {
    const occupied = new Map();
    // 用当前选中库存的 id 过滤, 而不是写死 '1'
    devices
      .filter((d) => d.shelfId === currentShelfId && d.location != null && d.location !== '')
      .forEach((d) => {
        const pos = parseInt(d.location, 10);
        if (!isNaN(pos)) {
          occupied.set(pos, d.name || '未知');
        }
      });
    return occupied;
  };

  /**
   * 获取所有位置信息（0-239，共240个位置，分8排）
   * @returns {Array} 位置信息数组，每项包含 position、isOccupied、deviceName
   */
  const getAllPositions = () => {
    const occupied = getOccupiedPositions();
    const positions = [];
    for (let i = 0; i < 240; i++) {
      positions.push({
        position: i,
        isOccupied: occupied.has(i),
        deviceName: occupied.get(i) || '',
      });
    }
    return positions;
  };

  /**
   * 点击"上架"按钮，打开位置选择器
   * 前置条件：必须已连接蓝牙设备
   * @param {Object} component - 待上架的BOM组件
   */
  const handleShelfDevice = (component) => {
    if (!global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      return;
    }
    setPendingComponent(component);
    setShowPositionPicker(true);
  };

  /**
   * 选择位置后，将器件上架到指定位置
   * 上架成功后自动点亮该位置的灯光，方便用户确认
   * @param {number} position - 选择的位置编号
   */
  const handleSelectPosition = async (position) => {
    if (!pendingComponent) return;

    try {
      // 构建新器件数据（器件名/编号可能为空，使用空字符串兜底避免 undefined）
      const newDevice = {
        name: pendingComponent.deviceName || pendingComponent.name || '',
        supplierId: pendingComponent.supplierId || '',
        package: pendingComponent.package || '',
        position: pendingComponent.position || '',
        category: pendingComponent.category || '',
        notes: pendingComponent.description || '',
        value: pendingComponent.value || '',
        resistance: pendingComponent.resistance || '',
        voltage: pendingComponent.voltage || '',
        capacitance: pendingComponent.capacitance || '',
        inductance: pendingComponent.inductance || '',
        current: pendingComponent.current || '',
        power: pendingComponent.power || '',
        frequency: pendingComponent.frequency || '',
        shelfId: currentShelfId, // 修复: 上架到当前选中库存, 而不是写死 '1'
        location: String(position),
      };

      // 保存到本地存储并刷新器件列表
      await StorageService.addDevice(newDevice);
      const updatedDevices = await StorageService.getDevices();
      setDevices(updatedDevices);

      // 熄灭之前的灯光，点亮新位置的灯光
      if (currentLitPosition.current !== null) {
        await sendLightCommand('lightOff', currentLitPosition.current);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      await sendLightCommand('lightOn', position);
      currentLitPosition.current = position;

      setShowPositionPicker(false);
      setPendingComponent(null);
    } catch (error) {
      logError('上架器件失败', error, 'BOMScreen.handleSelectPosition');
      Alert.alert('错误', `上架失败: ${error.message}`);
    }
  };

  /**
   * 自动点亮所有在器件架中匹配到的器件
   * 用于BOM导入后快速定位所有已有器件的位置
   * @param {Array} importedComponents - 要点亮的组件列表，默认为当前导入的所有组件
   */
  const autoLightAllSufficientDevices = async (
    importedComponents = components
  ) => {
    console.log('=== autoLightAllSufficientDevices 开始 ===');

    if (!global.deviceConnection) {
      console.log('未连接蓝牙设备，跳过自动点亮');
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      return;
    }

    console.log('蓝牙设备已连接');
    console.log(`导入的组件数量: ${importedComponents.length}`);
    console.log(`器件架中的器件数量: ${devices.length}`);

    console.log('=== 器件架中的所有器件 ===');
    devices.forEach((d, index) => {
      console.log(
        `索引: ${index}, ID: ${d.id}, 名称: ${d.name}, 供应商编号: ${d.supplierId}, 位置: ${d.position}`
      );
    });

    // 收集所有需要点亮的器件（去重）
    const devicesToLight = [];

    for (const component of importedComponents) {
      const matchInfo = getDeviceMatchInfo(component);
      if (matchInfo.devices && matchInfo.devices.length > 0) {
        matchInfo.devices.forEach((device) => {
          const alreadyExists = devicesToLight.some((d) => d.id === device.id);
          if (!alreadyExists) {
            devicesToLight.push({ device, component });
            console.log(`添加待点亮器件: ${device.name}, ID: ${device.id}`);
          }
        });
      }
    }

    console.log(`待点亮的器件数量: ${devicesToLight.length}`);

    if (devicesToLight.length === 0) {
      console.log('没有在架的器件');
      Alert.alert('提示', '没有在架的器件可以点亮');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    // 逐个发送点亮指令，每次间隔500ms避免指令冲突
    for (const { device, component } of devicesToLight) {
      console.log(`\n处理器件: ${device.name}`);
      console.log(`组件名称: ${component.name}`);
      console.log(`器件ID: ${device.id}, 位号: ${device.position}`);

      // 计算硬件位置：优先使用location字段，否则使用数组索引
      let hardwarePosition;
      if (device.location != null && device.location !== '') {
        const parsedLocation = parseInt(device.location, 10);
        hardwarePosition = isNaN(parsedLocation) ? (devices.findIndex((d) => d.id === device.id) + 1) : parsedLocation;
      } else {
        hardwarePosition = devices.findIndex((d) => d.id === device.id) + 1;
      }
      console.log(`器件位置: ${device.location}, 计算的硬件位置: ${hardwarePosition}`);

      try {
        const { handler } = global.deviceConnection;
        console.log('发送点亮指令...');
        const response = await handler.sendCommand({
          type: 'lightOn',
          lightId: hardwarePosition,
        });

        if (response && response.success) {
          console.log(`指令发送成功`);
          successCount++;
        } else {
          console.log(`指令发送失败: ${response?.message || '未知错误'}`);
          failCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`发送指令异常:`, error);
        failCount++;
      }
    }

    console.log(
      `=== 自动点亮完成 === 成功: ${successCount}, 失败: ${failCount}`
    );
  };

  // ==================== 界面渲染 ====================

  // 0 库存时顶部小黄条提示, 不阻挡用户操作
  const EmptyShelfBanner = !hasShelves ? (
    <View style={styles.bomEmptyShelfBanner}>
      <Text style={styles.bomEmptyShelfBannerText}>
        ⚠️ 当前无库存 — 导入 BOM 后无法与器件匹配, 请先到"设置"新建或导入库存
      </Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* 页面标题栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BOM 匹配</Text>
      </View>

      {EmptyShelfBanner}

      <ScrollView style={styles.content}>
        <View style={styles.componentsList}>
          {/* 标题栏：器件列表 + 右上角清空 + 导入按钮 */}
          <View style={styles.listHeader}>
            <Text style={styles.label}>器件列表</Text>
            <View style={styles.headerButtons}>
              {/* 蓝色「清空」按钮: 清空当前 BOM 匹配列表 + 熄灭已亮灯 */}
              <TouchableOpacity
                style={styles.clearButtonTop}
                onPress={handleClearBOM}
                disabled={isImporting}
                activeOpacity={0.7}
              >
                <Text style={styles.clearButtonText}>清空</Text>
              </TouchableOpacity>
              {/* 橘色「导入」按钮: 选择 / 接收 BOM Excel 文件 */}
              <TouchableOpacity
                style={styles.importButtonTop}
                onPress={handleImportBOM}
                disabled={isImporting}
                activeOpacity={0.7}
              >
                <Text style={styles.importButtonText}>
                  {isImporting ? '导入中...' : '导入'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 搜索输入框 */}
          <View style={styles.searchInputContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="搜索器件..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {filteredComponents.length > 0 && (
            filteredComponents.map((component, compIndex) => {
              const matchInfo = getDeviceMatchInfo(component);

              if (matchInfo.devices && matchInfo.devices.length > 0) {
                // ===== 已匹配器件：显示位置信息，可点击亮灯 =====
                const allLit = matchInfo.devices.every(d => litDeviceIds.includes(d.id));
                const anyLit = matchInfo.devices.some(d => litDeviceIds.includes(d.id));

                // 根据亮灯状态设置背景色和文字颜色
                let bgColor, textColor;
                if (allLit) {
                  bgColor = '#e8f5e9';    // 全部亮灯：绿色背景
                  textColor = '#2e7d32';
                } else if (anyLit) {
                  bgColor = '#fff8e1';    // 部分亮灯：黄色背景
                  textColor = '#f57f17';
                } else {
                  bgColor = '#ffffff';    // 未亮灯：白色背景
                  textColor = '#333';
                }

                // 拼接所有匹配器件的位置文本
                const positionsText = matchInfo.devices
                  .map(d => {
                    if (d.location != null && d.location !== '') {
                      const parsedLocation = parseInt(d.location, 10);
                      if (!isNaN(parsedLocation)) return String(parsedLocation);
                    }
                    const idx = devices.findIndex((dev) => dev.id === d.id);
                    return idx >= 0 ? String(idx) : 'N/A';
                  })
                  .join(', ');

                return (
                  <TouchableOpacity
                    key={compIndex}
                    style={[
                      styles.componentItem,
                      { backgroundColor: bgColor },
                    ]}
                    onPress={() => handleComponentPress(component)}
                    activeOpacity={1}
                  >
                    {/* 序号圆圈 */}
                    <View style={styles.seqCircle}>
                      <Text style={styles.seqText}>{compIndex + 1}</Text>
                    </View>
                    {/* 器件信息区域 */}
                    <View style={{ flex: 1 }}>
                      {/* 编号和名称（同一行） */}
                      <View style={styles.rowContainer}>
                        <View style={styles.rowItem}>
                          <Text style={styles.valueText}>{component.supplierId || 'null'}</Text>
                        </View>
                        <View style={styles.rowItem}>
                          <Text style={[styles.valueText, { color: '#1976d2', fontWeight: 'bold', fontSize: 16 }]}>{component.name || 'null'}</Text>
                        </View>
                      </View>
                      {/* 类目（名称下方，过长省略） */}
                      {component.category ? (
                        <Text style={styles.deviceInfo} numberOfLines={1} ellipsizeMode="tail">
                          <Text style={styles.valueText}>{component.category}</Text>
                        </Text>
                      ) : null}
                      {/* 封装（有值时显示） */}
                      {component.package && (
                        <Text style={styles.deviceInfo}>
                          <Text style={styles.valueText}>{component.package}</Text>
                        </Text>
                      )}
                      {/* 位号 */}
                      <Text style={styles.deviceInfo}>
                        <Text style={styles.valueText}>{component.position || '未设置'}</Text>
                      </Text>
                      {/* 底部行：左侧数量（始终显示），右侧位置信息（仅上架/匹配后才有） */}
                      <View style={styles.bottomRow}>
                        {component.quantity && (
                          <Text style={styles.quantityText}>
                            <Text style={styles.valueText}>{component.quantity}</Text>
                          </Text>
                        )}
                        <Text style={[styles.statusText, { color: textColor }]}>
                          <Text style={styles.valueText}>{positionsText}</Text>
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              } else {
                // ===== 未匹配器件：橙色背景，显示上架按钮 =====
                return (
                  <View
                    key={compIndex}
                    style={[
                      styles.componentItem,
                      { backgroundColor: '#fff3e0' },
                    ]}
                  >
                    {/* 序号圆圈 */}
                    <View style={styles.seqCircle}>
                      <Text style={styles.seqText}>{compIndex + 1}</Text>
                    </View>
                    {/* 器件信息区域 */}
                    <View style={{ flex: 1 }}>
                      {/* 编号和名称（同一行） */}
                      <View style={styles.rowContainer}>
                        <View style={styles.rowItem}>
                          <Text style={styles.valueText}>{component.supplierId || 'null'}</Text>
                        </View>
                        <View style={styles.rowItem}>
                          <Text style={[styles.valueText, { color: '#1976d2', fontWeight: 'bold', fontSize: 16 }]}>{component.name || 'null'}</Text>
                        </View>
                      </View>
                      {/* 类目（名称下方，过长省略） */}
                      {component.category ? (
                        <Text style={styles.deviceInfo} numberOfLines={1} ellipsizeMode="tail">
                          <Text style={styles.valueText}>{component.category}</Text>
                        </Text>
                      ) : null}
                      {/* 封装（有值时显示） */}
                      {component.package && (
                        <Text style={styles.deviceInfo}>
                          <Text style={styles.valueText}>{component.package}</Text>
                        </Text>
                      )}
                      {/* 位号 */}
                      <Text style={styles.deviceInfo}>
                        <Text style={styles.valueText}>{component.position || '未设置'}</Text>
                      </Text>
                      {/* 底部行：左侧数量（始终显示），未匹配时无位置 */}
                      <View style={styles.bottomRow}>
                        {component.quantity && (
                          <Text style={styles.quantityText}>
                            <Text style={styles.valueText}>{component.quantity}</Text>
                          </Text>
                        )}
                      </View>
                    </View>
                    {/* 上架按钮 */}
                    <TouchableOpacity
                      style={styles.shelfButton}
                      onPress={() => handleShelfDevice(component)}
                    >
                      <Text style={styles.shelfButtonText}>上架</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
            })
        )}

        {/* 0 器件空状态: 之前切库后页面"啥都没有", 用户以为卡了 */}
        {filteredComponents.length === 0 && components.length === 0 && (
          <View style={styles.bomEmptyState}>
            <Text style={styles.bomEmptyStateIcon}>📋</Text>
            <Text style={styles.bomEmptyStateTitle}>暂无 BOM 匹配</Text>
            <Text style={styles.bomEmptyStateText}>
              {hasShelves
                ? '点击右上角"导入"按钮, 选择 BOM 表格开始匹配'
                : '请先到"设置"新建或导入库存, 再导入 BOM 表格'}
            </Text>
            {hasShelves && (
              <TouchableOpacity
                style={styles.bomEmptyStateButton}
                onPress={handleImportBOM}
                disabled={isImporting}
                activeOpacity={0.7}
              >
                <Text style={styles.bomEmptyStateButtonText}>
                  {isImporting ? '导入中...' : '导入 BOM 表格'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {/* 搜索无结果: 列表有数据但搜索没匹配 */}
        {filteredComponents.length === 0 && components.length > 0 && (
          <View style={styles.bomEmptyState}>
            <Text style={styles.bomEmptyStateIcon}>🔍</Text>
            <Text style={styles.bomEmptyStateTitle}>没有匹配的器件</Text>
            <Text style={styles.bomEmptyStateText}>
              试试别的关键词, 或点"清空"重新搜索
            </Text>
          </View>
        )}
        </View>
      </ScrollView>

      {/* 位置选择弹窗：用于上架器件时选择物理位置 */}
      <Modal
        visible={showPositionPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPositionPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择物理位置</Text>
            {/* 显示待上架器件名称 */}
            {pendingComponent && (
              <Text style={styles.modalSubtitle}>
                {pendingComponent.deviceName || pendingComponent.name}
              </Text>
            )}
            {/* 位置网格，分8排展示，每排30个位置 */}
            <ScrollView style={styles.positionGrid}>
              {Array.from({ length: 8 }, (_, bankIndex) => (
                <View key={bankIndex}>
                  {/* 排号标题，可折叠展开 */}
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
                  {/* 展开后显示该排的所有位置格子 */}
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
                              if (posInfo.isOccupied) return;  // 已占用的位置不可选择
                              handleSelectPosition(posInfo.position);
                            }}
                            onLongPress={async () => {
                              if (posInfo.isOccupied) return;
                              if (global.deviceConnection && global.deviceConnection.handler) {
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
                              }
                            }}
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
                            {/* 已占用的位置不显示器件名称（与编辑器件页保持一致） */}
                          </TouchableOpacity>
                        ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
            {/* 取消按钮：关闭弹窗并熄灭灯光 */}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => {
                turnOffCurrentLight();
                setShowPositionPicker(false);
                setPendingComponent(null);
              }}
            >
              <Text style={styles.modalCancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ==================== 样式定义 ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    paddingTop: 60,
  },
  header: {
    backgroundColor: '#e0e0e0',
    padding: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginTop: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  // ========== 0 库存小黄条样式 (提示但不阻挡操作) ==========
  bomEmptyShelfBanner: {
    backgroundColor: '#fff3cd',
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 4,
  },
  bomEmptyShelfBannerText: {
    color: '#856404',
    fontSize: 13,
    lineHeight: 18,
  },
  // ========== BOM 0 数据空状态 (替换之前的"啥也没有") ==========
  bomEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  bomEmptyStateIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  bomEmptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  bomEmptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  bomEmptyStateButton: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  bomEmptyStateButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 标题栏：器件列表 + 右上角「清空」「导入」按钮
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  // 标题栏右侧两个按钮的容器
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 标题栏右侧的「清空」按钮 (蓝色, 紧凑尺寸, 在「导入」左侧)
  clearButtonTop: {
    backgroundColor: '#2196f3',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // 标题栏右侧的「导入」按钮（橘色，紧凑尺寸）
  importButtonTop: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  componentsList: {
    marginBottom: 20,
  },
  /* 列表项容器：水平排列，左侧序号+信息，右侧操作按钮 */
  componentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 8,
  },
  /* 序号圆圈 */
  seqCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  seqText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  componentText: {
    fontSize: 16,
    fontWeight: '500',
  },
  /* 信息行容器：编号和名称并排显示 */
  rowContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /* 标签文字（如"编号:"、"名称:"） */
  labelText: {
    fontSize: 12,
    color: '#888',
    marginRight: 4,
  },
  /* 值文字（如具体编号、名称值） */
  valueText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  /* 器件信息行（封装、位号等） */
  deviceInfo: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  /* 状态文字（位置、亮灯状态等） */
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  /* 底部行：左侧位置/状态，右侧数量 */
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  /* 数量文字样式（蓝色突出显示） */
  quantityText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1976d2',
  },
  /* 空列表提示文字 */
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  /* 上架按钮（蓝色） */
  shelfButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
    alignSelf: 'center',
  },
  shelfButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  /* ===== 位置选择弹窗样式 ===== */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  positionGrid: {
    maxHeight: 350,
  },
  /* 排号折叠标题 */
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
  /* 位置格子容器 */
  positionGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  /* 单个位置格子 */
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
  /* 空位置（蓝色） */
  positionItemEmpty: {
    backgroundColor: '#e3f2fd',
    borderColor: '#bbdefb',
  },
  /* 已占用位置（绿色） */
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
  /* 已占用位置下方显示的器件名称 */
  positionItemDeviceName: {
    fontSize: 8,
    color: '#4caf50',
    marginTop: 1,
  },
  /* 弹窗取消按钮 */
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
  /* 搜索输入框 */
  searchInputContainer: {
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
});

export default BOMScreen;
