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
  FlatList,
  SafeAreaView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import StorageService from '../services/StorageService';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import * as pendingBomImport from '../utils/pendingBomImport';
import { usePendingBomImport } from '../utils/pendingBomImport';

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
  const previewTimeout = useRef(null);                         // 预览灯自动熄灭定时器
  const isOperatingRef = useRef(false);                        // 操作锁，防止重复点击

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

  // ==================== 页面生命周期 ====================

  /**
   * 页面获得焦点时加载器件数据，离开时熄灭灯光
   */
  useFocusEffect(
    React.useCallback(() => {
      loadDevices();
      return () => {
        turnOffCurrentLight();
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
      const query = searchQuery.toLowerCase();
      const filtered = components.filter(
        (component) =>
          component.name && component.name.toLowerCase().includes(query)
      );
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
    const deviceNameKeywords = ['name', '器件名称', '名称', '器件', 'component', 'part', '型号'];
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
    try {
      setIsImporting(true);

      // 打开文件选择器，仅允许选择xlsx文件
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
   * 匹配规则（按优先级）：
   * 1. 供应商编号 + 器件名称 + 封装 都匹配
   * 2. 仅供应商编号 + 封装匹配（无器件名称时）
   * 3. 仅器件名称 + 封装匹配（无供应商编号时）
   * 4. 编号都为空时，仅按器件名称 + 封装匹配
   * @param {Object} component - BOM组件对象
   * @returns {Object} 匹配结果，包含 exists（是否匹配）、devices（匹配到的器件列表）
   */
  const getDeviceMatchInfo = (component) => {
    console.log(`\n=== getDeviceMatchInfo 开始 ===`);
    console.log(`组件名称: ${component.name}`);
    console.log(`组件供应商编号: ${component.supplierId}`);
    console.log(`组件器件名称: ${component.deviceName}`);
    console.log(`组件封装: ${component.package}`);

    /**
     * 检查封装是否匹配
     * 比较时会去除前导零，如 "0805" 和 "805" 视为匹配
     */
    const checkPackageMatch = (devicePackage, componentPackage) => {
      if (!componentPackage || !devicePackage) return true;
      const normalizedDevicePackage = devicePackage.replace(/^0+/, '');
      const normalizedComponentPackage = componentPackage.replace(/^0+/, '');
      return (
        normalizedDevicePackage === normalizedComponentPackage ||
        devicePackage === componentPackage
      );
    };

    const matchedDevices = devices.filter((device, index) => {
      console.log(`\n检查器件[${index}]: ${device.name}`);
      console.log(`  器件供应商编号: ${device.supplierId}`);
      console.log(`  器件封装: ${device.package}`);

      const compName = component.name || component.deviceName || '';
      const compSupplierId = component.supplierId || '';
      const devName = device.name || '';
      const devSupplierId = device.supplierId || '';

      // 规则1：供应商编号 + 器件名称 + 封装 都匹配
      if (compSupplierId && devSupplierId && compName && devName) {
        const supplierMatch = devSupplierId === compSupplierId;
        const nameMatch = devName === compName;
        console.log(
          `  供应商编号匹配: ${supplierMatch}, 器件名称匹配: ${nameMatch}`
        );
        if (supplierMatch && nameMatch) {
          const packageMatch = checkPackageMatch(
            device.package,
            component.package
          );
          console.log(`  封装匹配: ${packageMatch}`);
          if (packageMatch) return true;
        }
      }

      // 规则2：仅供应商编号 + 封装匹配（BOM组件无器件名称时）
      if (compSupplierId && devSupplierId && !compName) {
        if (devSupplierId === compSupplierId) {
          const packageMatch = checkPackageMatch(
            device.package,
            component.package
          );
          console.log(`  仅供应商编号匹配: true, 封装匹配: ${packageMatch}`);
          if (packageMatch) return true;
        }
      }

      // 规则3：仅器件名称 + 封装匹配（BOM组件无供应商编号时）
      if (compName && devName && !compSupplierId) {
        if (devName === compName) {
          const packageMatch = checkPackageMatch(
            device.package,
            component.package
          );
          console.log(`  仅器件名称匹配: true, 封装匹配: ${packageMatch}`);
          if (packageMatch) return true;
        }
      }

      // 规则4：编号都为空时，仅按器件名称 + 封装匹配
      if (!compSupplierId && !devSupplierId && compName && devName) {
        if (devName === compName) {
          const packageMatch = checkPackageMatch(
            device.package,
            component.package
          );
          console.log(`  编号都为空，名称匹配: true, 封装匹配: ${packageMatch}`);
          if (packageMatch) return true;
        }
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
            setLitDeviceIds(prev => prev.filter(id => id !== targetDevice.id));
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
            setLitDeviceIds(prev => [...prev, targetDevice.id]);
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
    devices
      .filter((d) => d.shelfId === '1' && d.location != null && d.location !== '')
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
        shelfId: '1',
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

  return (
    <SafeAreaView style={styles.container}>
      {/* 页面标题栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BOM 匹配</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.componentsList}>
          {/* 标题栏：器件列表 + 导入按钮（右上角） */}
          <View style={styles.listHeader}>
            <Text style={styles.label}>器件列表</Text>
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
                      {/* 底部行：左侧位置信息，右侧数量 */}
                      <View style={styles.bottomRow}>
                        <Text style={[styles.statusText, { color: textColor }]}>
                          <Text style={styles.valueText}>{positionsText}</Text>
                        </Text>
                        {component.quantity && (
                          <Text style={styles.quantityText}>
                            <Text style={styles.valueText}>{component.quantity}</Text>
                          </Text>
                        )}
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
                      {/* 底部行：右侧数量（左侧的状态提示已移除，橘色背景已足够辨识） */}
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
  content: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 标题栏：器件列表 + 右上角「导入」按钮
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
