/**
 * 器件列表页面组件
 *
 * 功能说明：
 * - 显示器件架中的所有器件
 * - 支持按类目筛选器件
 * - 支持搜索器件（按名称、编号、封装、分类等）
 * - 支持蓝牙亮灯定位器件位置
 * - 支持左滑器件显示编辑/删除按钮（QQ 风格）
 * - 支持从Excel导入器件数据
 * - 支持扫码添加器件
 */
import React, {
  useEffect,
  useMemo,
  useCallback,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  ScrollView,
  Animated,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import StorageService from '../services/StorageService';
import BluetoothHandler from '../services/BluetoothHandler';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import { generateSearchSuggestions, filterDevices } from '../utils/SearchUtils';
import { MaterialIcons } from '@expo/vector-icons';
import { getCategories, DEVICE_CATEGORIES } from '../services/DeviceCategoryService';

const DeviceListScreen = ({ navigation, route, isAdmin = false }) => {
  /**
   * 状态管理初始值
   * 
   * devices: 所有器件列表
   * filteredDevices: 筛选后的器件列表
   * searchQuery: 搜索关键词
   * selectedDevices: 批量选择模式下选中的器件ID列表
   * isSelectionMode: 是否处于批量选择模式
   * searchHistory: 搜索历史记录
   * showSearchHistory: 是否显示搜索历史
   * searchSuggestions: 搜索建议列表
   * showSuggestions: 是否显示搜索建议
   * successMessage: 操作成功提示消息
   * isConnected: 蓝牙连接状态
   * isLoading: 是否正在加载数据
   * litDeviceIds: 当前亮灯的器件ID列表
   * selectedCategory: 当前筛选的子类目（null表示全部器件）
   * showCategoryFilter: 是否显示类目筛选弹窗
   * categoryFilterList: 类目筛选弹窗中的大类数据
   * expandedCategoryFilterIndex: 当前展开的大类索引
   * categorySearchQuery: 类目搜索关键词
   */
  const initialState = {
    devices: [],
    filteredDevices: [],
    searchQuery: '',
    searchHistory: [],
    showSearchHistory: false,
    searchSuggestions: [],
    showSuggestions: false,
    successMessage: '',
    isConnected: false,
    isLoading: false,
    litDeviceIds: [],
    selectedCategory: null,           // null = 全部器件；否则为子类名称（如 "贴片电阻"）
    showCategoryFilter: false,        // 类目筛选弹窗显示状态
    categoryFilterList: [],           // 类目筛选弹窗中的大类数据
    expandedCategoryFilterIndex: null, // 类目筛选弹窗中展开的大类索引
    categorySearchQuery: '',          // 类目搜索关键词
  };

  /**
   * Reducer函数：处理状态更新
   * 
   * 支持的action类型：
   * - SET_DEVICES: 设置器件列表（同时更新筛选后的列表）
   * - SET_FILTERED_DEVICES: 设置筛选后的器件列表
   * - SET_SEARCH_QUERY: 设置搜索关键词
   * - SET_SELECTED_DEVICES: 设置选中的器件列表
   * - SET_SELECTION_MODE: 设置批量选择模式（会清空已选列表）
   * - SET_SEARCH_HISTORY: 设置搜索历史
   * - SET_SHOW_SEARCH_HISTORY: 设置是否显示搜索历史
   * - SET_SEARCH_SUGGESTIONS: 设置搜索建议
   * - SET_SHOW_SUGGESTIONS: 设置是否显示搜索建议
   * - SET_SUCCESS_MESSAGE: 设置成功提示消息
   * - SET_CONNECTED: 设置蓝牙连接状态
   * - TOGGLE_DEVICE_SELECTION: 切换单个器件的选中状态
   * - CLEAR_SEARCH_HISTORY: 清除搜索历史
   * - SET_LOADING: 设置加载状态
   * - SET_LIT_DEVICE_IDS: 设置亮灯的器件ID列表
   * - TOGGLE_LIT_DEVICE: 切换单个器件的亮灯状态
   * - SET_SELECTED_CATEGORY: 设置当前筛选的子类目
   * - SET_SHOW_CATEGORY_FILTER: 设置类目筛选弹窗显示状态
   * - SET_CATEGORY_FILTER_LIST: 设置类目筛选弹窗中的大类数据
   * - SET_EXPANDED_CATEGORY_FILTER_INDEX: 设置类目筛选弹窗中展开的大类索引
   * - SET_CATEGORY_SEARCH_QUERY: 设置类目搜索关键词
   */
  const reducer = (state, action) => {
    switch (action.type) {
      case 'SET_DEVICES':
        return {
          ...state,
          devices: action.payload,
          filteredDevices: action.payload,  // 同时更新筛选列表
        };
      case 'SET_FILTERED_DEVICES':
        return { ...state, filteredDevices: action.payload };
      case 'SET_SEARCH_QUERY':
        return { ...state, searchQuery: action.payload };
      case 'SET_SEARCH_HISTORY':
        return { ...state, searchHistory: action.payload };
      case 'SET_SHOW_SEARCH_HISTORY':
        return { ...state, showSearchHistory: action.payload };
      case 'SET_SEARCH_SUGGESTIONS':
        return { ...state, searchSuggestions: action.payload };
      case 'SET_SHOW_SUGGESTIONS':
        return { ...state, showSuggestions: action.payload };
      case 'SET_SUCCESS_MESSAGE':
        return { ...state, successMessage: action.payload };
      case 'SET_CONNECTED':
        return { ...state, isConnected: action.payload };
      case 'CLEAR_SEARCH_HISTORY':
        return { ...state, searchHistory: [] };
      case 'SET_LOADING':
        return { ...state, isLoading: action.payload };
      case 'SET_LIT_DEVICE_IDS':
        return { ...state, litDeviceIds: action.payload };
      case 'TOGGLE_LIT_DEVICE':
        // 切换单个器件的亮灯状态
        const isLit = state.litDeviceIds.includes(action.payload);
        return {
          ...state,
          litDeviceIds: isLit
            ? state.litDeviceIds.filter((id) => id !== action.payload)
            : [...state.litDeviceIds, action.payload],
        };
      case 'SET_SELECTED_CATEGORY':
        // 设置当前筛选的子分类
        return { ...state, selectedCategory: action.payload };
      case 'SET_SHOW_CATEGORY_FILTER':
        return { ...state, showCategoryFilter: action.payload };
      case 'SET_CATEGORY_FILTER_LIST':
        return { ...state, categoryFilterList: action.payload };
      case 'SET_EXPANDED_CATEGORY_FILTER_INDEX':
        return { ...state, expandedCategoryFilterIndex: action.payload };
      case 'SET_CATEGORY_SEARCH_QUERY':
        return { ...state, categorySearchQuery: action.payload };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(reducer, initialState);
  const successAnimation = useMemo(() => new Animated.Value(0), []);
  const lastConnectedStatus = useRef(false);

  // 解构状态
  const {
    devices,
    filteredDevices,
    searchQuery,
    searchHistory,
    showSearchHistory,
    searchSuggestions,
    showSuggestions,
    successMessage,
    isConnected,
    isLoading,
    litDeviceIds,
    selectedCategory,
    showCategoryFilter,
    categoryFilterList,
    expandedCategoryFilterIndex,
    categorySearchQuery,
  } = state;

  useEffect(() => {
    loadDevices();
    loadSearchHistory();
    checkConnectionStatus();

    // 注册蓝牙断开回调（使用命名函数便于清理）
    const handleBluetoothDisconnected = () => {
      console.log('收到蓝牙断开通知，更新连接状态');
      dispatch({ type: 'SET_CONNECTED', payload: false });
    };

    // 保存旧的回调（如果有）
    const previousCallback = global.onBluetoothDisconnected;
    global.onBluetoothDisconnected = handleBluetoothDisconnected;

    // 清理回调
    return () => {
      // 恢复之前的回调（如果有的话）
      if (previousCallback) {
        global.onBluetoothDisconnected = previousCallback;
      } else {
        delete global.onBluetoothDisconnected;
      }
    };
  }, []);

  // 当页面获得焦点时重新加载设备数据，并保留搜索状态
  useFocusEffect(
    useCallback(() => {
      console.log('DeviceListScreen获得焦点，重新加载数据');
      
      const currentSearchQuery = searchQuery;
      
      loadDevices();
      
      setTimeout(() => {
        if (currentSearchQuery.trim() !== '') {
          const filtered = filterDevices(devices, currentSearchQuery, '');
          dispatch({ type: 'SET_FILTERED_DEVICES', payload: filtered });
        }
      }, 100);
    }, [searchQuery, loadDevices, dispatch])
  );

  // 定期检查连接状态，确保指示器实时更新
  const checkConnectionStatusRef = useRef(checkConnectionStatus);

  useEffect(() => {
    checkConnectionStatusRef.current = checkConnectionStatus;
  }, [checkConnectionStatus]);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      checkConnectionStatusRef.current();
    }, 1000); // 每秒检查一次

    return () => {
      clearInterval(checkInterval);
    };
  }, []);

  // 尝试重新连接上次的蓝牙设备
  const handleReconnect = useCallback(async () => {
    try {
      const lastDevice = await StorageService.getLastConnectedDevice();
      if (!lastDevice || !lastDevice.deviceId) {
        Alert.alert('提示', '没有找到上次连接的设备，请先在连接页面连接蓝牙设备');
        return;
      }

      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_CONNECTED', payload: false });

      const bluetoothHandler = new BluetoothHandler();
      await bluetoothHandler.initialize();

      console.log('尝试重新连接蓝牙设备:', lastDevice.deviceName);
      
      const connectWithTimeout = Promise.race([
        bluetoothHandler.connectToDevice(lastDevice.deviceId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('连接超时')), 10000)
        ),
      ]);

      await connectWithTimeout;
      
      global.deviceConnection = {
        type: 'bluetooth',
        device: { id: lastDevice.deviceId, name: lastDevice.deviceName },
        handler: bluetoothHandler,
      };

      dispatch({ type: 'SET_CONNECTED', payload: true });
      showSuccessMessage(`已连接到设备: ${lastDevice.deviceName}`);
    } catch (error) {
      console.log('蓝牙重连失败:', error.message);
      dispatch({ type: 'SET_CONNECTED', payload: false });
      Alert.alert('连接失败', `无法连接到上次的设备: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, showSuccessMessage]);

  // 检查连接状态（优先检查全局连接对象，再检测蓝牙设备真实状态）
  const checkConnectionStatus = useCallback(async () => {
    let connected = false;
    let statusMessage = '';

    // 首先检查全局连接对象是否存在（蓝牙断开时会被清除）
    if (global.deviceConnection && global.deviceConnection.handler) {
      const handler = global.deviceConnection.handler;
      // 检查设备对象是否存在且已连接
      if (handler.connectedDevice) {
        try {
          // 直接调用设备的isConnected方法检测真实连接状态
          const isDeviceConnected = await handler.connectedDevice.isConnected();
          connected = isDeviceConnected;
          statusMessage = connected
            ? '已连接（设备在线）'
            : '已断开（设备离线）';
        } catch (error) {
          connected = false;
          statusMessage = '已断开（检测失败）';
        }
      }
    } else {
      // 全局连接对象已被清除，说明连接已断开
      connected = false;
      statusMessage = '已断开（全局连接对象已清除）';
    }

    // 只在连接状态发生变化时输出日志
    if (connected !== lastConnectedStatus.current) {
      console.log('蓝牙连接状态:', statusMessage);
      lastConnectedStatus.current = connected;
    }

    dispatch({ type: 'SET_CONNECTED', payload: connected });
  }, [dispatch]);

  const loadSearchHistory = useCallback(async () => {
    try {
      const storedHistory = await StorageService.getSearchHistory();
      if (storedHistory.length > 0) {
        dispatch({ type: 'SET_SEARCH_HISTORY', payload: storedHistory });
      }
    } catch (error) {
      logError('加载搜索历史失败', error, 'DeviceListScreen.loadSearchHistory');
    }
  }, [dispatch]);

  const saveSearchHistory = useCallback(
    async (query) => {
      if (!query.trim()) return;

      try {
        let updatedHistory = searchHistory.filter((item) => item !== query);
        updatedHistory.unshift(query);
        updatedHistory = updatedHistory.slice(0, 10); // 只保留最近10条
        dispatch({ type: 'SET_SEARCH_HISTORY', payload: updatedHistory });
        await StorageService.saveSearchHistory(updatedHistory);
      } catch (error) {
        logError(
          '保存搜索历史失败',
          error,
          'DeviceListScreen.saveSearchHistory'
        );
      }
    },
    [searchHistory, dispatch]
  );

  const clearSearchHistory = useCallback(async () => {
    try {
      dispatch({ type: 'CLEAR_SEARCH_HISTORY' });
      await StorageService.clearSearchHistory();
    } catch (error) {
      logError(
        '清除搜索历史失败',
        error,
        'DeviceListScreen.clearSearchHistory'
      );
    }
  }, [dispatch]);

  const handleGenerateSearchSuggestionsRef = useRef(
    handleGenerateSearchSuggestions
  );

  useEffect(() => {
    handleGenerateSearchSuggestionsRef.current =
      handleGenerateSearchSuggestions;
  }, [handleGenerateSearchSuggestions]);

  useEffect(() => {
    if (searchQuery && searchQuery.trim() !== '') {
      handleGenerateSearchSuggestionsRef.current(searchQuery);
    } else {
      dispatch({ type: 'SET_SHOW_SUGGESTIONS', payload: false });
    }
  }, [searchQuery, dispatch]);

  const handleGenerateSearchSuggestions = useCallback(
    (query) => {
      if (!query || !query.trim()) {
        dispatch({ type: 'SET_SEARCH_SUGGESTIONS', payload: [] });
        dispatch({ type: 'SET_SHOW_SUGGESTIONS', payload: false });
        return;
      }

      const suggestions = generateSearchSuggestions(
        query,
        devices,
        searchHistory,
        5
      );
      dispatch({ type: 'SET_SEARCH_SUGGESTIONS', payload: suggestions });
      dispatch({
        type: 'SET_SHOW_SUGGESTIONS',
        payload: suggestions.length > 0,
      });
    },
    [devices, searchHistory, dispatch]
  );

  const handleSearch = useCallback(
    (query) => {
      dispatch({ type: 'SET_SEARCH_QUERY', payload: query });
      saveSearchHistory(query);
      dispatch({ type: 'SET_SHOW_SEARCH_HISTORY', payload: false });
      dispatch({ type: 'SET_SHOW_SUGGESTIONS', payload: false });
    },
    [saveSearchHistory, dispatch]
  );

  const loadDevices = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      // 先尝试从存储中读取数据
      const storedDevices = await StorageService.getDevices();

      if (storedDevices.length > 0) {
        // 检查是否是旧的默认数据，如果是则清除
        const isOldDefaultData =
          storedDevices.length >= 10 && storedDevices[0]?.name?.includes('10Ω');
        if (isOldDefaultData) {
          console.log('检测到旧的默认数据，正在清除...');
          await StorageService.saveDevices([]);
          dispatch({ type: 'SET_DEVICES', payload: [] });
        } else {
          // 如果存储中有数据，使用存储的数据
          console.log('从存储加载器件数据，共', storedDevices.length, '个器件');
          const sortedDevices = [...storedDevices].sort((a, b) => {
            const posA = (a.location != null && a.location !== '') ? parseInt(a.location, 10) : 9999;
            const posB = (b.location != null && b.location !== '') ? parseInt(b.location, 10) : 9999;
            if (isNaN(posA) && isNaN(posB)) return 0;
            if (isNaN(posA)) return 1;
            if (isNaN(posB)) return -1;
            return posA - posB;
          });
          dispatch({ type: 'SET_DEVICES', payload: sortedDevices });
        }
      }
    } catch (error) {
      logError('加载器件数据失败', error, 'DeviceListScreen.loadDevices');
      const errorMessage = `加载器件数据失败: ${formatErrorMessage(error)}`;
      Alert.alert('错误', errorMessage);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch]);

  const handleDeviceTagPress = useCallback(
    async (device, hardwarePosition) => {
      try {
        if (!isConnected || !global.deviceConnection) {
          Alert.alert('提示', '请先在连接页面连接蓝牙设备');
          dispatch({ type: 'SET_CONNECTED', payload: false });
          return;
        }

        const { handler } = global.deviceConnection;
        const isLit = litDeviceIds.includes(device.id);

        if (isLit) {
          const response = await handler.sendCommand({
            type: 'lightOff',
            lightId: hardwarePosition,
          });

          if (response.success) {
            dispatch({
              type: 'SET_LIT_DEVICE_IDS',
              payload: litDeviceIds.filter((id) => id !== device.id),
            });
            showSuccessMessage(`已熄灯: ${device.name}`);
          } else {
            Alert.alert('错误', `熄灯失败: ${response.message}`);
          }
        } else {
          const response = await handler.sendCommand({
            type: 'lightOn',
            lightId: hardwarePosition,
          });

          if (response.success) {
            dispatch({ type: 'TOGGLE_LIT_DEVICE', payload: device.id });
            showSuccessMessage(`已亮灯: ${device.name} (位置: ${hardwarePosition})`);
          } else {
            Alert.alert('错误', `亮灯失败: ${response.message}`);
          }
        }
      } catch (error) {
        logError('器件操作失败', error, 'DeviceListScreen.handleDeviceTagPress');
        Alert.alert('错误', `操作失败: ${formatErrorMessage(error)}`);
      }
    },
    [isConnected, litDeviceIds, devices, showSuccessMessage]
  );

  // 使用 useMemo 缓存过滤后的设备列表
  // 过滤规则：先按类目筛选（如果已选），再按搜索关键字筛选
  const memoizedFilteredDevices = useMemo(() => {
    let result = devices;
    // 1. 按类目筛选
    if (selectedCategory) {
      result = result.filter(
        (device) => device.category === selectedCategory
      );
    }
    // 2. 按搜索关键字筛选
    result = filterDevices(result, searchQuery, '');
    return result;
  }, [devices, searchQuery, selectedCategory]);

  // 使用 useMemo 缓存搜索建议
  const memoizedSearchSuggestions = useMemo(() => {
    return generateSearchSuggestions(searchQuery, devices, searchHistory, 5);
  }, [devices, searchHistory, searchQuery]);

  // 【类目筛选】打开下拉弹窗：重新加载类目，默认展开当前已选类目所在的大类
  const handleOpenCategoryFilter = useCallback(async () => {
    // 立即打开弹窗（避免数据未就绪时弹窗不显示）
    dispatch({ type: 'SET_SHOW_CATEGORY_FILTER', payload: true });
    try {
      let list = await getCategories();
      // 防御性兜底：万一 getCategories 返回空（极端情况），用默认类目
      if (!Array.isArray(list) || list.length === 0) {
        console.warn('[类目筛选] getCategories 返回空，使用 DEVICE_CATEGORIES 兜底');
        list = DEVICE_CATEGORIES;
      }
      console.log('[类目筛选] 加载了', list.length, '个大类');
      dispatch({ type: 'SET_CATEGORY_FILTER_LIST', payload: list });
      // 尝试定位当前已选子分类所在的大类索引
      let matchedIndex = null;
      if (selectedCategory) {
        matchedIndex = list.findIndex(
          (c) =>
            c.name === selectedCategory ||
            (c.subCategories || []).includes(selectedCategory)
        );
      }
      dispatch({
        type: 'SET_EXPANDED_CATEGORY_FILTER_INDEX',
        payload: matchedIndex != null && matchedIndex >= 0 ? matchedIndex : null,
      });
    } catch (error) {
      logError(
        '打开类目筛选下拉失败',
        error,
        'DeviceListScreen.handleOpenCategoryFilter'
      );
      // 即使出错也给一个非空列表，保证弹窗能用
      dispatch({ type: 'SET_CATEGORY_FILTER_LIST', payload: DEVICE_CATEGORIES });
      Alert.alert('错误', '加载类目失败：' + formatErrorMessage(error));
    }
  }, [selectedCategory, dispatch]);

  // 【类目筛选】关闭下拉弹窗
  const handleCloseCategoryFilter = useCallback(() => {
    dispatch({ type: 'SET_SHOW_CATEGORY_FILTER', payload: false });
    dispatch({ type: 'SET_EXPANDED_CATEGORY_FILTER_INDEX', payload: null });
    dispatch({ type: 'SET_CATEGORY_SEARCH_QUERY', payload: '' });
  }, [dispatch]);

  // 【类目筛选】选择某个子类目进行筛选
  const handleSelectFilterCategory = useCallback(
    (subCategory) => {
      dispatch({ type: 'SET_SELECTED_CATEGORY', payload: subCategory });
      handleCloseCategoryFilter();
    },
    [handleCloseCategoryFilter]
  );

  // 【类目筛选】清除筛选，回到全部器件
  const handleClearFilterCategory = useCallback(() => {
    dispatch({ type: 'SET_SELECTED_CATEGORY', payload: null });
    handleCloseCategoryFilter();
  }, [handleCloseCategoryFilter]);

  // 【类目筛选】点击标题的快捷清除（不打开弹窗）
  const handleQuickClearCategory = useCallback(() => {
    dispatch({ type: 'SET_SELECTED_CATEGORY', payload: null });
  }, [dispatch]);

  // 点亮所有灯
  const handleControlAllLightsOn = useCallback(async () => {
    if (!isConnected || !global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      dispatch({ type: 'SET_CONNECTED', payload: false });
      return;
    }

    try {
      const { handler } = global.deviceConnection;
      const response = await handler.sendCommand({
        type: 'controlAll',
        state: true,
      });

      if (response.success) {
        showSuccessMessage('已点亮所有灯');
        const currentDevices = await StorageService.getDevices();
        const allDeviceIds = currentDevices.map(d => d.id);
        dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: allDeviceIds });
      } else {
        Alert.alert('错误', `操作失败: ${response.message}`);
      }
    } catch (error) {
      logError(
        '控制所有灯失败',
        error,
        'DeviceListScreen.handleControlAllLightsOn'
      );
      Alert.alert('错误', '发送命令失败，请检查设备连接');
    }
  }, [isConnected, showSuccessMessage]);

  // 熄灭所有灯
  const handleControlAllLightsOff = useCallback(async () => {
    if (!isConnected || !global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      dispatch({ type: 'SET_CONNECTED', payload: false });
      return;
    }

    try {
      const { handler } = global.deviceConnection;
      const response = await handler.sendCommand({
        type: 'controlAll',
        state: false,
      });

      if (response.success) {
        showSuccessMessage('已熄灭所有灯');
        dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: [] });
      } else {
        Alert.alert('错误', `操作失败: ${response.message}`);
      }
    } catch (error) {
      logError(
        '控制所有灯失败',
        error,
        'DeviceListScreen.handleControlAllLightsOff'
      );
      Alert.alert('错误', '发送命令失败，请检查设备连接');
    }
  }, [isConnected, showSuccessMessage]);

  // 单个器件删除
  const handleDeleteDevice = useCallback(
    async (device) => {
      Alert.alert('确认删除', `确定要删除器件 "${device.name}" 吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedDevices = devices.filter((d) => d.id !== device.id);
              await StorageService.saveDevices(updatedDevices);
              dispatch({ type: 'SET_DEVICES', payload: updatedDevices });
              // 灭灯：无论该位置灯当前是亮还是灭，都发送一次 lightOff 给下位机
              await turnOffLightForPosition(device.location);
              showSuccessMessage('器件已删除');
              Alert.alert('成功', '器件已删除');
            } catch (error) {
              logError(
                '删除器件失败',
                error,
                'DeviceListScreen.handleDeleteDevice'
              );
              Alert.alert('错误', '删除器件失败');
            }
          },
        },
      ]);
    },
    [devices, dispatch, showSuccessMessage, turnOffLightForPosition]
  );

  // 发送 lightOff 指令给下位机，使指定位置的灯熄灭
  // 无论该位置灯当前是亮还是灭，都会发送一次（要求硬件幂等处理）
  // - 蓝牙未连接时直接跳过（删除操作依然成功）
  // - 位置为空/无效时跳过
  const turnOffLightForPosition = useCallback(async (position) => {
    if (position == null || position === '') return;
    if (!global.deviceConnection || !global.deviceConnection.handler) return;
    try {
      await global.deviceConnection.handler.sendCommand({
        type: 'lightOff',
        lightId: position,
      });
    } catch (error) {
      console.log(`[删除灭灯] 位置 ${position} 灭灯指令发送失败:`, error);
    }
  }, []);


  const showSuccessMessage = useCallback(
    (message) => {
      dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: message });

      // 动画显示
      Animated.sequence([
        Animated.timing(successAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(successAnimation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: '' });
      });
    },
    [dispatch, successAnimation]
  );

  const renderDeviceItem = useCallback(
    ({ item, index }) => {
      const isLit = litDeviceIds.includes(item.id);
      let hardwarePosition;
      if (item.location != null && item.location !== '') {
        const parsedLocation = parseInt(item.location, 10);
        hardwarePosition = isNaN(parsedLocation) ? (devices.findIndex((d) => d.id === item.id) + 1) : parsedLocation;
      } else {
        hardwarePosition = devices.findIndex((d) => d.id === item.id) + 1;
      }

      const handlePress = () => {
        handleDeviceTagPress(item, hardwarePosition);
      };

      const handleEdit = () => {
        navigation.navigate('AdminEdit', {
          device: item,
          isNew: false,
          onSave: loadDevices,
        });
      };

      return (
        <SwipeableRow
          key={item.id}
          onEdit={handleEdit}
          onDelete={() => handleDeleteDevice(item)}
        >
          <TouchableOpacity
            style={[
              styles.deviceTag,
              isLit && styles.litDeviceTag,
            ]}
            onPress={handlePress}
          >
          {/* 顶部行：编号 + 类目 */}
          <View style={styles.deviceTagTopRow}>
            {/* 编号 */}
            <View style={styles.deviceTagTopLeft}>
              <Text style={styles.deviceTagValueTop} numberOfLines={1}>
                {item.supplierId || '-'}
              </Text>
            </View>
            {/* 类目 */}
            <View style={styles.deviceTagTopRight}>
              <Text style={styles.deviceTagCategory} numberOfLines={1}>
                {item.category || '-'}
              </Text>
            </View>
          </View>

          {/* 中间：名称（大字蓝色，最突出） */}
          <View style={styles.deviceTagCenter}>
            <Text style={styles.deviceTagName} numberOfLines={1}>
              {item.name || '未命名'}
            </Text>
          </View>

          {/* 底部行：位置 + 数量 */}
          <View style={styles.deviceTagBottomRow}>
            {/* 位置 */}
            <View style={styles.deviceTagBottomLeft}>
              <Text style={styles.deviceTagValueBottom} numberOfLines={1}>
                {hardwarePosition != null ? hardwarePosition : '-'}
              </Text>
            </View>
            {/* 数量 */}
            <View style={styles.deviceTagBottomRight}>
              <Text style={styles.deviceTagQuantity} numberOfLines={1}>
                {item.quantity || 1}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
        </SwipeableRow>
      );
    },
    [
      litDeviceIds,
      handleDeviceTagPress,
      navigation,
      loadDevices,
      devices,
    ]
  );

  // 从Excel导入器件 - 已废弃，改用扫码或"新建器件"入库
  // 保留此注释说明历史代码已清理（2026-06-25）

  return (
    <SafeAreaView style={styles.container}>
      {/* 标题和蓝牙连接状态 */}
      <View style={styles.shelfSelectorContainer}>
        {/* 左上角：可点击的类目筛选器 */}
        <TouchableOpacity
          style={styles.shelfSelectorButton}
          onPress={handleOpenCategoryFilter}
          activeOpacity={0.7}
        >
          {selectedCategory ? (
            <View style={styles.shelfSelectorTextWithClear}>
              <Text style={styles.shelfSelectorText} numberOfLines={1}>
                类目：{selectedCategory}
              </Text>
              {/* 清除筛选的 ✕ 按钮（再次点击这里 = 回到全部器件） */}
              <TouchableOpacity
                style={styles.shelfSelectorClearButton}
                onPress={handleQuickClearCategory}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.shelfSelectorClearButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.shelfSelectorTextWithArrow}>
              <Text style={styles.shelfSelectorText}>全部器件</Text>
              <Text style={styles.shelfSelectorArrow}>▼</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* 蓝牙连接状态指示器 */}
        <View style={styles.connectionStatusContainer}>
          {isConnected ? (
            <View style={[styles.statusIndicator, styles.connectedIndicator]}>
              <Text style={styles.statusIcon}>🔵</Text>
              <Text style={styles.statusText}>已连接</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.statusIndicator, styles.disconnectedIndicator]}
              onPress={handleReconnect}
              activeOpacity={0.7}
            >
              <Text style={styles.statusIcon}>⚪</Text>
              <Text style={styles.statusText}>未连接</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 搜索容器 */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索名称、编号、封装、分类..."
            value={searchQuery}
            onChangeText={(text) =>
              dispatch({ type: 'SET_SEARCH_QUERY', payload: text })
            }
            onFocus={() =>
              dispatch({ type: 'SET_SHOW_SEARCH_HISTORY', payload: true })
            }
          />
          {searchQuery && (
            <TouchableOpacity
              style={styles.clearSearchButton}
              onPress={() => {
                dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
              }}
            >
              <Text style={styles.clearSearchButtonText}>清除</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 搜索历史 */}
        {showSearchHistory && searchHistory.length > 0 && (
          <View style={styles.searchHistoryContainer}>
            <View style={styles.searchHistoryHeader}>
              <Text style={styles.searchHistoryTitle}>搜索历史</Text>
              <TouchableOpacity onPress={clearSearchHistory}>
                <Text style={styles.clearHistoryButton}>清除</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {searchHistory.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.historyTag}
                  onPress={() => handleSearch(item)}
                >
                  <Text style={styles.historyTagText}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 搜索建议 */}
        {showSuggestions && memoizedSearchSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {memoizedSearchSuggestions.map((suggestion, index) => (
              <TouchableOpacity
                key={index}
                style={styles.suggestionItem}
                onPress={() => handleSearch(suggestion)}
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* 第一行：扫码 + 新建器件 */}
      <View style={styles.controlAllButtonsContainer}>
        <TouchableOpacity
          style={[styles.controlAllButton, styles.controlAllScanButton]}
          onPress={() => navigation.navigate('ScanScreen')}
        >
          <Text style={styles.controlAllButtonText}>扫码</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlAllButton, styles.addButton]}
          onPress={() =>
            navigation.navigate('NewDevice', { onSave: loadDevices })
          }
        >
          <Text style={styles.addButtonText}>新建器件</Text>
        </TouchableOpacity>
      </View>

      {/* 第二行：点亮所有 + 熄灭所有（1:1 等宽） */}
      <View style={styles.controlAllLightsContainer}>
        <TouchableOpacity
          style={[styles.controlAllLightButton, styles.controlAllOnButton]}
          onPress={handleControlAllLightsOn}
        >
          <Text style={styles.controlAllButtonText}>点亮所有</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlAllLightButton, styles.controlAllOffButton]}
          onPress={handleControlAllLightsOff}
        >
          <Text style={styles.controlAllButtonText}>熄灭所有</Text>
        </TouchableOpacity>
      </View>

      {/* 设备标签列表 */}
      <ScrollView
        style={styles.tagsContainer}
        showsVerticalScrollIndicator={true}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1976d2" />
            <Text style={styles.loadingText}>加载器件数据中...</Text>
          </View>
        ) : memoizedFilteredDevices.length > 0 ? (
          <View style={styles.tagsGrid}>
            {memoizedFilteredDevices.map((item, index) => {
              return (
                <View
                  key={item.id}
                  style={styles.tagWrapper}
                >
                  {renderDeviceItem({ item, index })}
                </View>
              );
            })}
            {/* 添加一个底部空白，确保最后一行标签完全可见 */}
            <View style={{ height: 20 }} />
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Text style={styles.emptyIcon}>🔍</Text>
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery.trim() ? '未找到匹配的器件' : '暂无器件数据'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery.trim()
                ? '请尝试使用其他关键词搜索，或检查拼写是否正确'
                : '请点击"新建器件"或"扫码"按钮添加器件'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* 成功反馈提示 */}
      {successMessage && (
        <Animated.View
          style={[
            styles.successMessageContainer,
            {
              transform: [
                {
                  translateY: successAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-100, 0],
                  }),
                },
              ],
              opacity: successAnimation,
            },
          ]}
        >
          <Text style={styles.successMessageIcon}>✅</Text>
          <Text style={styles.successMessageText}>{successMessage}</Text>
        </Animated.View>
      )}

      {/* 类目筛选下拉弹窗：仿类目选择器，大类可展开/折叠，点子类目筛选 */}
      <Modal
        visible={showCategoryFilter}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCloseCategoryFilter}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择类目筛选</Text>
            {/* 搜索框 */}
            <TextInput
              style={styles.categorySearchInput}
              placeholder="搜索类目..."
              value={categorySearchQuery}
              onChangeText={(text) =>
                dispatch({ type: 'SET_CATEGORY_SEARCH_QUERY', payload: text })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* 显示当前已选类目 */}
            {selectedCategory ? (
              <Text style={styles.categoryCurrentLabel}>
                当前：{selectedCategory}
              </Text>
            ) : null}
            {/* 类目树：所有大类，点击展开/折叠显示小类目 */}
            <ScrollView style={styles.positionGrid}>
              {(() => {
                if (categorySearchQuery.trim()) {
                  const query = categorySearchQuery.toLowerCase().trim();
                  const matchedSubs = [];
                  categoryFilterList.forEach((cat) => {
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
                            style={[
                              styles.subCategoryItem,
                              selectedCategory === item.sub &&
                                styles.subCategoryItemActive,
                            ]}
                            onPress={() => handleSelectFilterCategory(item.sub)}
                          >
                            <Text
                              style={[
                                styles.subCategoryItemText,
                                selectedCategory === item.sub &&
                                  styles.subCategoryItemTextActive,
                              ]}
                            >
                              {item.sub}
                            </Text>
                            <Text style={styles.subCategoryItemBig}>
                              {item.big}
                            </Text>
                            {selectedCategory === item.sub && (
                              <Text style={styles.subCategoryItemCheck}>✓</Text>
                            )}
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
                return (
                  <>
                    {/* 全部器件按钮（清除筛选） */}
                    <TouchableOpacity
                      style={[
                        styles.filterAllRow,
                        !selectedCategory && styles.filterAllRowActive,
                      ]}
                      onPress={handleClearFilterCategory}
                    >
                      <Text
                        style={[
                          styles.filterAllText,
                          !selectedCategory && styles.filterAllTextActive,
                        ]}
                      >
                        📋 全部器件
                      </Text>
                    </TouchableOpacity>
                    {categoryFilterList.map((cat, idx) => (
                      <View key={cat.name}>
                        <TouchableOpacity
                          style={styles.positionBankHeader}
                          onPress={() =>
                            dispatch({
                              type: 'SET_EXPANDED_CATEGORY_FILTER_INDEX',
                              payload:
                                expandedCategoryFilterIndex === idx ? null : idx,
                            })
                          }
                        >
                          <Text style={styles.positionBankHeaderText}>
                            {cat.name}（{cat.subCategories.length}项）
                          </Text>
                          <Text style={styles.positionBankHeaderArrow}>
                            {expandedCategoryFilterIndex === idx ? '▲' : '▼'}
                          </Text>
                        </TouchableOpacity>
                        {expandedCategoryFilterIndex === idx && (
                          <View style={styles.subCategoryList}>
                            {cat.subCategories.map((sub) => (
                              <TouchableOpacity
                                key={sub}
                                style={[
                                  styles.subCategoryItem,
                                  selectedCategory === sub &&
                                    styles.subCategoryItemActive,
                                ]}
                                onPress={() => handleSelectFilterCategory(sub)}
                              >
                                <Text
                                  style={[
                                    styles.subCategoryItemText,
                                    selectedCategory === sub &&
                                      styles.subCategoryItemTextActive,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {sub}
                                </Text>
                                {selectedCategory === sub && (
                                  <Text style={styles.subCategoryItemCheck}>✓</Text>
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </>
                );
              })()}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={handleCloseCategoryFilter}
            >
              <Text style={styles.modalCancelButtonText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  // 器件架选择器样式
  shelfSelectorContainer: {
    paddingHorizontal: 16,
    paddingTop: 56,
    position: 'relative',
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shelfSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    flex: 1,
    marginRight: 12,
  },
  // 连接状态指示器样式
  connectionStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectedIndicator: {
    backgroundColor: '#e8f5e8',
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  disconnectedIndicator: {
    backgroundColor: '#ffebee',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  statusIcon: {
    fontSize: 14,
  },
  shelfSelectorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  // 左上角标题的可点击按钮
  shelfSelectorButton: {
    flex: 1,
    paddingVertical: 4,
    paddingRight: 8,
  },
  // "全部器件 ▼" 横排布局
  shelfSelectorTextWithArrow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // "类目：xxx ✕" 横排布局
  shelfSelectorTextWithClear: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shelfSelectorArrow: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
  // 清除筛选的 ✕ 按钮
  shelfSelectorClearButton: {
    marginLeft: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ff5252',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shelfSelectorClearButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 16,
  },
  // 【类目筛选弹窗】相关样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '80%',
    // 关键：必须加 flex: 1，否则内部 ScrollView 的 flex: 1 拿不到高度，会坍缩为 0
    // （修复：标题/全部器件/关闭都显示了，但中间大类列表是空白的）
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 12,
  },
  categoryCurrentLabel: {
    fontSize: 13,
    color: '#1976d2',
    textAlign: 'center',
    marginBottom: 8,
  },
  // "全部器件" 行（顶部清除筛选的快捷项）
  filterAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 10,
  },
  filterAllRowActive: {
    backgroundColor: '#e3f2fd',
    borderWidth: 1,
    borderColor: '#1976d2',
  },
  filterAllText: {
    fontSize: 15,
    color: '#555',
  },
  filterAllTextActive: {
    color: '#1976d2',
    fontWeight: '600',
  },
  // 类目树
  positionGrid: {
    flex: 1,
    marginBottom: 12,
  },
  positionBankHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fafafa',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginBottom: 4,
  },
  positionBankHeaderText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  positionBankHeaderArrow: {
    fontSize: 12,
    color: '#666',
  },
  subCategoryList: {
    paddingLeft: 12,
    marginBottom: 6,
  },
  subCategoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 4,
    marginBottom: 2,
  },
  subCategoryItemActive: {
    backgroundColor: '#e3f2fd',
  },
  subCategoryItemText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  subCategoryItemTextActive: {
    color: '#1976d2',
    fontWeight: '600',
  },
  subCategoryItemCheck: {
    fontSize: 14,
    color: '#1976d2',
    fontWeight: 'bold',
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
  modalCancelButton: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 15,
    color: '#555',
    fontWeight: '500',
  },
  shelfDropdown: {
    position: 'absolute',
    top: '100%',
    left: 16,
    right: 16,
    marginTop: 8,
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 200,
  },
  shelfDropdownItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  shelfDropdownItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  shelfDropdownItemText: {
    fontSize: 16,
    color: '#333',
  },
  shelfDropdownItemTextSelected: {
    color: '#1976d2',
    fontWeight: '700',
  },
  // 搜索容器样式
  searchContainer: {
    padding: 16,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 16,
    marginRight: 10,
  },
  clearSearchButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  clearSearchButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  searchHistoryContainer: {
    marginTop: 8,
  },
  searchHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  searchHistoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  clearHistoryButton: {
    fontSize: 14,
    color: '#1976d2',
  },
  historyTag: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  historyTagText: {
    fontSize: 14,
    color: '#1976d2',
  },
  suggestionsContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 8,
  },
  suggestionItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  suggestionText: {
    fontSize: 16,
    color: '#333',
  },
  // 设备标签样式
  tagsContainer: {
    flex: 1,
    padding: 16,
  },
  tagsGrid: {
    flexDirection: 'column',
  },
  tagWrapper: {
    marginBottom: 12,
  },
  deviceTag: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    flexDirection: 'column',
    height: 90,
  },
  litDeviceTag: {
    backgroundColor: '#98ee9cff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  // 顶部行：编号 + 类目
  deviceTagTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  // 顶部左侧：编号
  deviceTagTopLeft: {
    flexShrink: 0,
    paddingRight: 12,
  },
  // 顶部右侧：类目（可向左扩展）
  deviceTagTopRight: {
    flex: 1,
    paddingRight: 24,
  },
  // 中间：名称
  deviceTagCenter: {
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  // 底部行：位置 + 数量
  deviceTagBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  // 底部左侧：位置
  deviceTagBottomLeft: {
    flexShrink: 0,
  },
  // 底部右侧：数量
  deviceTagBottomRight: {
    flexShrink: 0,
  },
  // 顶部值（编号）
  deviceTagValueTop: {
    fontSize: 12,
    color: '#666',
    flexShrink: 1,
    textAlign: 'left',
    marginTop: -4,
  },
  // 类目（右对齐，过长时从右侧省略）
  deviceTagCategory: {
    fontSize: 12,
    color: '#666',
    flexShrink: 1,
    textAlign: 'right',
    ellipsizeMode: 'tail',
    marginTop: -4,
  },
  // 底部值（位置）
  deviceTagValueBottom: {
    fontSize: 12,
    color: '#666',
    flexShrink: 1,
    textAlign: 'left',
    marginBottom: -4,
  },
  // 数量（右对齐）
  deviceTagQuantity: {
    fontSize: 12,
    color: '#666',
    flexShrink: 1,
    textAlign: 'right',
    marginBottom: -4,
  },
  deviceTagName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1976d2',
    textAlign: 'center',
    numberOfLines: 1,
  },
  addButton: {
    backgroundColor: '#007AFF',
    flex: 1,
    marginRight: 8,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // 复选框样式
  checkboxContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
  },
  checkboxSelected: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  checkmark: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 空状态样式
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    minHeight: 300,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  // 成功消息样式
  successMessageContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#4CD964',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  successMessageIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  successMessageText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 控制所有灯按钮样式
  controlAllButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  controlAllButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  controlAllOnButton: {
    backgroundColor: '#4caf50',
  },
  controlAllOffButton: {
    backgroundColor: '#f44336',
  },
  controlAllScanButton: {
    backgroundColor: '#1976d2',
  },
  controlAllButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default DeviceListScreen;
