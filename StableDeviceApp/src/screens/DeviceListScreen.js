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
  Pressable,
  StyleSheet,
  Alert,
  TextInput,
  ScrollView,
  Animated,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  Image,
  StatusBar,
} from 'react-native';
// ⚠️ FlatList 必须用 react-native-gesture-handler 的!
// 这是 Android 上 Swipeable 工作的关键: gesture-handler 的 FlatList
// 内部把 ScrollView 换成自己的 createNativeWrapper 版本, native scroll view
// 不会"吞掉"所有触摸, PanGestureHandler 才能正常检测到水平 pan.
import { FlatList } from 'react-native-gesture-handler';
import StorageService from '../services/StorageService';
import BluetoothHandler from '../services/BluetoothHandler';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import { generateSearchSuggestions, filterDevices } from '../utils/SearchUtils';
import { MaterialIcons } from '@expo/vector-icons';
import { getCategories, DEVICE_CATEGORIES } from '../services/DeviceCategoryService';
import ShelfService from '../services/ShelfService';
import SwipeableRow from '../components/SwipeableRow';
import { consumePendingAutoConnect } from '../utils/pendingAutoConnect';
import { autoConnectBluetooth } from '../utils/autoConnectBluetooth';
import { subscribe as subscribeLight, emitLightAllOff } from '../utils/lightEvents';
import {
  subscribeLightStatus,
  getLitDeviceIdsSnapshot,
  addLitDevice,
  removeLitDevice,
  setLitDevices,
  clearAllLitDevices,
} from '../utils/lightStatusStore';

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
    shelves: [],                       // 所有库存
    currentShelfId: null,             // 当前选中的库存 id
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
      case 'SET_SHELVES':
        return { ...state, shelves: action.payload };
      case 'SET_CURRENT_SHELF_ID':
        return { ...state, currentShelfId: action.payload };
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
    shelves,
    currentShelfId,
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

  // 订阅全局灯光状态 (集中式 store) — 解决"emit 错过 / mount 时拿旧 state"的竞态
  // 场景: BOM 页"清空" / "失焦" / "切库" → clearAllLitDevices() / emitLightAllOff
  //       → 这里收到事件 → 同步清空本地 litDeviceIds → 标签绿底消失
  // 三重保险:
  //   1) 订阅 store 事件 (其他页面触发时立刻收到)
  //   2) 页面 mount/focus 时主动拉 snapshot (兜底 emit 错过的情况)
  //   3) 自己点亮的灯直接 add/remove 到 store (统一权威源)
  useEffect(() => {
    const unsubscribe = subscribeLightStatus((event) => {
      // 不管什么 type, 全部以 store 为准, 重新同步本地 state
      const snap = getLitDeviceIdsSnapshot();
      dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: snap });
    });
    return unsubscribe;
  }, []);

  // 当页面获得焦点时重新加载设备数据，并保留搜索状态
  useFocusEffect(
    useCallback(() => {
      console.log('DeviceListScreen获得焦点，重新加载数据');

      // 关键: 检查是否有"待自动连"的 pending (导入数据后)
      // 有则在**当前页面后台自动连**, 不跳转到连接页
      // 用户通过右上角的"未连接/已连接"状态胶囊观察连接结果
      const pending = consumePendingAutoConnect();
      if (pending.mac) {
        console.log('[DeviceListScreen] 检测到待自动连, 后台连接:', pending.mac);
        // 后台静默连, 5s 内连不上视为"目标蓝牙不在范围"
        autoConnectBluetooth(pending.mac, pending.name).then((result) => {
          if (result.ok) {
            console.log('[DeviceListScreen] 后台自动连成功, 刷新连接状态');
            // 立即更新本组件的 status badge 为"已连接" (右上角胶囊)
            dispatch({ type: 'SET_CONNECTED', payload: true });
          } else {
            console.warn('[DeviceListScreen] 后台自动连失败:', result.reason);
            // 5s 仍未连上 (一般是"目标蓝牙不在范围"), 在首页弹提示让用户去手动连
            // 关键: 不要在没有 pending.mac 的普通 focus 触发弹窗, 只在导入触发的这次失败才弹
            Alert.alert(
              '蓝牙不在范围',
              `目标蓝牙「${pending.name || pending.mac}」不在范围内或未开启, 请到"连接"页手动扫描连接。`,
              [
                {
                  text: '稍后',
                  style: 'cancel',
                  onPress: () => { /* 留在首页, 用户可继续浏览器件 */ },
                },
                {
                  text: '去连接',
                  onPress: () => {
                    // 跳到连接页, 用户可手动扫描附近蓝牙
                    navigation.navigate('Connection', {
                      autoConnectMac: pending.mac,
                      autoConnectName: pending.name,
                    });
                  },
                },
              ]
            );
          }
        });
      }

      const currentSearchQuery = searchQuery;

      // 每次焦点都重新加载当前库存和库存列表 (用户在设置页可能切了/改了库存)
      // 关键: 先 await 拿到最新 currentId, 再用它调 loadDevices ——
      // 因为 dispatch 是异步的, 同步紧跟的 loadDevices(state) 拿到的还是旧 shelfId
      // 用 override 参数把最新值直接传进去, 避免导入后第一帧就查到错库
      ;(async () => {
        try {
          const [shelves, currentId] = await Promise.all([
            ShelfService.getShelves(),
            ShelfService.getCurrentShelfId(),
          ]);
          dispatch({ type: 'SET_SHELVES', payload: shelves });
          dispatch({ type: 'SET_CURRENT_SHELF_ID', payload: currentId });
          // 1.4 阶段 2 修复: 关键 — 用刚拿到的 currentId 同步重载器件
          // (之前用 state.currentShelfId 是旧的, 切库后第一帧会查错库, 看不到刚导入的)
          await loadDevices(currentId);
        } catch (err) {
          console.warn('加载库存列表失败', err);
          // 失败也要至少重载, 否则"导入后切到新库"会显示空
          loadDevices();
        }
      })();

      // 关键: 页面 focus 时主动拉一次 litStatusStore 的 snapshot 同步本地 state
      // 兜底 emit 错过 / 跨页面 mount 时机竞态 (问题 1 的根因)
      const snap = getLitDeviceIdsSnapshot();
      dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: snap });

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

      // 关键: 重新连接成功时, 也要把设备绑定到"当前库存" —
      // 实现"库存-蓝牙记忆", 导出时取的就是这个 last-connected MAC
      try {
        const currentShelfId = await ShelfService.getCurrentShelfId();
        if (currentShelfId) {
          await ShelfService.setShelfBluetooth(currentShelfId, lastDevice.deviceId, lastDevice.deviceName);
          console.log('[蓝牙记忆] handleReconnect 已绑定到库存', currentShelfId, '->', lastDevice.deviceName);
        }
      } catch (bindErr) {
        console.warn('[蓝牙记忆] handleReconnect 绑定失败:', bindErr);
      }

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

  // loadDevices 接收可选 shelfId 参数, 调用方可在拿到"最新 currentShelfId"后直接传进来
  // 不传则用 state.currentShelfId (注意: state 是异步更新, 同一 render 里 dispatch 后立刻读还是旧值)
  const loadDevices = useCallback(async (overrideShelfId) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      // 1.4 阶段 1+: 优先按当前库存走 SQL 查 (只返回该 shelf 的器件, 不全读)
      // 1.4 阶段 2: 流式导入后器件在 SQLite, 走 SQL 一定能看到; 老路径 (无 currentShelfId) 走 getDevices
      const shelfId = overrideShelfId || currentShelfId;
      let storedDevices = [];
      if (shelfId) {
        storedDevices = await StorageService.getDevicesByShelf(shelfId);
      } else {
        storedDevices = await StorageService.getDevices();
      }

      if (storedDevices.length > 0) {
        // 1.6.3: 删除"老默认数据"自动清除逻辑
        // 原因: 老检查 `length >= 10 && first.name.includes('10Ω')` 太松,
        //   真实数据只要第一个器件是 10Ω 电阻就误判, 触发 deleteDevicesByShelf 全删
        //   用户反馈: 3 个库存连蓝牙后器件全部消失就是这个 bug
        // 老默认数据是 v0.x 的 demo, 现在所有真实用户都是从老版本升上来, 不可能还有 demo
        // 如果真有 demo 数据, 让用户手动删; 不要再替用户做删除决定
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
      } else {
        // 没有任何器件 (刚切到空库 / 刚导入但还没 SQL 同步), 显式置空
        dispatch({ type: 'SET_DEVICES', payload: [] });
      }
    } catch (error) {
      logError('加载器件数据失败', error, 'DeviceListScreen.loadDevices');
      const errorMessage = `加载器件数据失败: ${formatErrorMessage(error)}`;
      Alert.alert('错误', errorMessage);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, currentShelfId]);

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
            // 通过 store 统一管理: 移除 + emit, 其他页面同步
            removeLitDevice(device.id);
            dispatch({
              type: 'SET_LIT_DEVICE_IDS',
              payload: getLitDeviceIdsSnapshot(),
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
            // 通过 store 统一管理: 添加 + emit, 其他页面同步
            addLitDevice(device.id);
            dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: getLitDeviceIdsSnapshot() });
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
  // 过滤规则：先按当前库存, 再按类目, 再按搜索关键字
  const memoizedFilteredDevices = useMemo(() => {
    let result = devices;
    // 0. 按当前库存过滤 (多库存功能)
    if (currentShelfId) {
      result = result.filter((device) => device.shelfId === currentShelfId);
    }
    // 1. 按类目筛选
    if (selectedCategory) {
      result = result.filter(
        (device) => device.category === selectedCategory
      );
    }
    // 2. 按搜索关键字筛选
    result = filterDevices(result, searchQuery, '');
    return result;
  }, [devices, searchQuery, selectedCategory, currentShelfId]);

  // 使用 useMemo 缓存搜索建议
  const memoizedSearchSuggestions = useMemo(() => {
    return generateSearchSuggestions(searchQuery, devices, searchHistory, 5);
  }, [devices, searchHistory, searchQuery]);

  // 当前库存名 (用于顶部小标签显示, 只读)
  const currentShelfName = useMemo(() => {
    if (!currentShelfId) return null;
    const s = shelves.find((x) => x.id === currentShelfId);
    return s ? s.name : null;
  }, [shelves, currentShelfId]);

  // ========== 库存切换 BottomSheet 相关（仅切换, 不含增删改） ==========
  const [showShelfSheet, setShowShelfSheet] = useState(false);
  const [shelfSheetList, setShelfSheetList] = useState([]); // [{id, name, deviceCount}]

  // ========== 器件图片点击放大 (与 ImageUploadField 同 Modal 模式) ==========
  // null = 关闭; 非空 = 当前放大的图片 uri
  const [zoomedImageUri, setZoomedImageUri] = useState(null);

  const handleOpenShelfSheet = useCallback(async () => {
    try {
      const [list, devices] = await Promise.all([
        ShelfService.getShelves(),
        StorageService.getDevices(),
      ]);
      const enriched = list.map((s) => ({
        ...s,
        deviceCount: devices.filter((d) => d.shelfId === s.id).length,
      }));
      setShelfSheetList(enriched);
      setShowShelfSheet(true);
    } catch (err) {
      Alert.alert('错误', '加载库存列表失败');
    }
  }, []);

  const handleCloseShelfSheet = useCallback(() => {
    setShowShelfSheet(false);
  }, []);

  const handleSwitchShelfFromSheet = useCallback(
    async (shelf) => {
      try {
        // 修复: 误触当前库存时直接关闭弹窗, 不应触发"断蓝牙/重新连"的弹窗
        if (shelf.id === currentShelfId) {
          setShowShelfSheet(false);
          return;
        }
        // 方案 A+D: 库存绑定蓝牙, 切库时优先自动连回该库存的 MAC
        const handler = global.deviceConnection?.handler;
        const currentMac = handler?.getCurrentMac ? handler.getCurrentMac() : null;
        const isCurrentlyConnected = !!currentMac;
        // 读取目标库存是否已绑定蓝牙
        const targetBluetooth = await ShelfService.getShelfBluetooth(shelf.id);

        // 切库 (无蓝牙动作)
        const doSwitch = async () => {
          await ShelfService.setCurrentShelfId(shelf.id);
          dispatch({ type: 'SET_CURRENT_SHELF_ID', payload: shelf.id });
          setShowShelfSheet(false);
          // 【修复 v1.6.5】必须把 shelf.id 显式传给 loadDevices,
          // 否则内部用 state.currentShelfId, 而 dispatch 是异步的,
          // loadDevices 立即读 state 拿到的是旧值 → filter 旧值 → 0 个器件
          loadDevices(shelf.id);
        };

        // 路径 1: 目标库存已绑定蓝牙 → 默认自动连, 失败才弹 [取消 / 手动选择] 弹窗
        if (targetBluetooth) {
          const label = targetBluetooth.name || targetBluetooth.mac;

          // 1) 如果当前还连着别的蓝牙, 先静默断开 + 清全局, 避免连接冲突
          //    (用户不再被"当前蓝牙将被断开"打扰, 一切自动)
          if (isCurrentlyConnected && handler && typeof handler.disconnect === 'function') {
            try {
              await handler.disconnect();
              if (global.deviceConnection) delete global.deviceConnection;
            } catch (e) { /* 忽略, 继续 */ }
          }

          // 2) 切库 (currentShelfId + 重新加载器件)
          await doSwitch();

          // 3) 后台自动连绑定的蓝牙 (不弹 Alert, 静默 Toast / console)
          const result = await autoConnectBluetooth(targetBluetooth.mac, targetBluetooth.name);

          // 4) 自动连失败 → 给用户两个选择: 取消 / 手动扫描
          //    注意: shelf 已经切到目标, "取消" 仅是放弃连接, 不回退 shelf
          if (!result || !result.ok) {
            Alert.alert(
              '蓝牙不在范围',
              `无法自动连接蓝牙 "${label}", 请手动扫描或取消。`,
              [
                {
                  text: '取消',
                  style: 'cancel',
                  // 什么都不做, 库存已切但蓝牙未连, 顶部胶囊显示"未连接"
                },
                {
                  text: '手动选择',
                  onPress: () => {
                    navigation.navigate('Connection', {
                      action: 'switchShelf',
                      targetShelfId: shelf.id,
                      autoScan: true,
                      autoScanAt: Date.now(),
                    });
                  },
                },
              ]
            );
          }
          return;
        }

        // 路径 2: 目标库存未绑定蓝牙 -> 切库 + (如有连) 断开 + 跳扫描页
        const doSwitchAndGoScan = async () => {
          try {
            if (isCurrentlyConnected && handler && typeof handler.disconnect === 'function') {
              await handler.disconnect();
              // 关键: handler.disconnect() 只是断开 BLE 链路, 不会清 global.deviceConnection.
              // 如果不清, ConnectionScreen 进来后 read global 看到 stale "已连接" -> 误以为新库存自动连上了
              // 同时 DeviceListScreen 的连接胶囊也仍是 "已连接" -> 视觉欺骗
              if (global.deviceConnection) {
                delete global.deviceConnection;
              }
              console.log('[切库-路径2] 已断开并清空全局连接状态, 切到未绑定蓝牙的库存', shelf.name);
            }
          } catch (e) {
            console.warn('断开蓝牙失败, 继续切库:', e);
            // 仍然尝试清全局, 避免 stale state
            if (global.deviceConnection) delete global.deviceConnection;
          }
          await doSwitch();
          navigation.navigate('Connection', {
            action: 'switchShelf',
            targetShelfId: shelf.id,
            autoScan: true,
            autoScanAt: Date.now(),
          });
        };

        if (isCurrentlyConnected) {
          Alert.alert(
            '切换库存',
            `切换到 "${shelf.name}" 将断开当前蓝牙连接，需要重新扫描选择蓝牙模块。\n\n是否继续？`,
            [
              { text: '取消', style: 'cancel' },
              {
                text: '确认',
                onPress: () => {
                  doSwitchAndGoScan().catch((err) => Alert.alert('切库失败', err.message || '请重试'));
                },
              },
            ]
          );
        } else {
          await doSwitchAndGoScan();
        }
      } catch (err) {
        Alert.alert('切换失败', err.message);
      }
    },
    [dispatch, loadDevices, navigation, currentShelfId]
  );


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
  // 【关键】物理 controlAll: true 协议 + store 一次性 setLitDevices + 本地 dispatch
  // 失败时不修改 store (避免"没真亮但 UI 全绿"假状态)
  const handleControlAllLightsOn = useCallback(async () => {
    if (!isConnected || !global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      dispatch({ type: 'SET_CONNECTED', payload: false });
      return;
    }

    try {
      const { handler } = global.deviceConnection;
      // 优先 fastControlAll (不等 ACK + 1.5s 超时), 失败再 sendCommand
      let ok = false;
      if (typeof handler.fastControlAll === 'function') {
        const r = await handler.fastControlAll(true);
        if (r && r.success) ok = true;
      }
      if (!ok) {
        const response = await handler.sendCommand({
          type: 'controlAll',
          state: true,
        });
        ok = response.success;
      }

      if (ok) {
        showSuccessMessage('已点亮所有灯');
        const currentDevices = await StorageService.getDevices();
        const allDeviceIds = currentDevices.map(d => d.id);
        // 走 store: 一次性 set, emit, 所有页面同步
        setLitDevices(allDeviceIds);
        dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: getLitDeviceIdsSnapshot() });
      } else {
        Alert.alert('错误', '操作失败');
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
  // 【关键 bug 修复】之前只 dispatch 本地 state, 没走 store 集中清空。
  // 后果: 用户"点亮所有" → store = allDeviceIds → "熄灭所有" → 本地 [] 但 store 残留
  //       → 之后任意 addLitDevice/snapshot 同步 → 残留 ids 全部回到本地 → 全部器件标签变绿
  // 修复: 走 clearAllLitDevices() + emitLightAllOff() + 本地 dispatch, 三个一起清
  const handleControlAllLightsOff = useCallback(async () => {
    if (!isConnected || !global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      dispatch({ type: 'SET_CONNECTED', payload: false });
      return;
    }

    try {
      const { handler } = global.deviceConnection;
      // 优先 fastControlAll (不等 ACK + 1.5s 超时), 失败再 sendCommand
      let ok = false;
      if (typeof handler.fastControlAll === 'function') {
        const r = await handler.fastControlAll(false);
        if (r && r.success) ok = true;
      }
      if (!ok) {
        const response = await handler.sendCommand({
          type: 'controlAll',
          state: false,
        });
        ok = response.success;
      }

      if (ok) {
        showSuccessMessage('已熄灭所有灯');
        // 【核心修复】走 store 集中清空 — 不然 store 残留, 之后会被 snapshot 拉回
        clearAllLitDevices();
        // 兼容老 listener (subscribeLight)
        emitLightAllOff();
        // 本地 state 也清
        dispatch({ type: 'SET_LIT_DEVICE_IDS', payload: [] });
      } else {
        Alert.alert('错误', '操作失败');
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
          <Pressable
            style={[styles.deviceTag, isLit && styles.litDeviceTag]}
            onPress={handlePress}
            delayPressIn={150}
          >
            {/* 左侧方图（方角）：用户上传图 / 默认占位
                点击图片直接全屏放大查看, 不必进入编辑页 */}
            <View style={styles.deviceTagImageWrap}>
              {item.image ? (
                <Pressable
                  style={styles.deviceTagImagePressable}
                  onPress={() => setZoomedImageUri(item.image)}
                  hitSlop={4}
                >
                  <Image
                    source={{ uri: item.image }}
                    style={styles.deviceTagImage}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : (
                // 默认占位图: assets/device-default.png
                // （用户已放入, 这里用 require 直接打包进 APK）
                <Image
                  source={require('../../assets/device-default.png')}
                  style={styles.deviceTagImage}
                  resizeMode="contain"
                />
              )}
            </View>

            {/* 右侧字段堆叠:
                1. 编号(左) + 类目(右)
                2. 器件名称(居中)
                3. 位置(左) + 数量(右, 带 x 前缀) */ }
            <View style={styles.deviceTagContent}>
              {/* 1. 编号 + 类目
                  - 编号 flexShrink:0 永远完整, 优先级最高
                  - 类目 flex:1 强制占据剩余空间 + textAlign:'right' 始终贴右
                  - 类目 marginLeft:24 = 距编号 2 字符宽 (12px 字号 × 2)
                  - ellipsizeMode:'tail' 长时从右省略(省略号也在右) */ }
              <View style={styles.deviceTagRowTop}>
                <Text
                  style={[styles.deviceTagMeta, { flexShrink: 0 }]}
                  numberOfLines={1}
                >
                  {item.supplierId || '无编号'}
                </Text>
                <Text
                  style={[
                    styles.deviceTagMeta,
                    {
                      flex: 1,              // 强制占据剩余空间(关键)
                      marginLeft: 24,        // 2 字符宽度间距
                      textAlign: 'right',    // 内容在自身宽度内始终靠右
                    },
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"      // 长时从右省略
                >
                  {item.category || '未分类'}
                </Text>
              </View>
              {/* 2. 器件名称（居中, 蓝色, 大字号） */}
              <View style={styles.deviceTagNameCenter}>
                <Text
                  style={[
                    styles.deviceTagName,
                    isLit && styles.deviceTagNameLit,
                  ]}
                  numberOfLines={1}
                >
                  {item.name || '未命名'}
                </Text>
              </View>
              {/* 3. 位置 + 数量(带 × 前缀)
                  - 位置 flexShrink:0 永远完整
                  - 数量 flex:1 强制占据剩余空间, 始终贴右
                  - 数量 marginLeft:24 = 距位置 2 字符宽
                  - 长时省略号也在右 */ }
              <View style={styles.deviceTagRowBottom}>
                <Text
                  style={[styles.deviceTagMeta, { flexShrink: 0 }]}
                  numberOfLines={1}
                >
                  {hardwarePosition != null ? `位置 ${hardwarePosition}` : ''}
                </Text>
                <Text
                  style={[
                    styles.deviceTagMeta,
                    {
                      flex: 1,
                      marginLeft: 24,
                      textAlign: 'right',
                    },
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  ×{item.quantity || 1}
                </Text>
              </View>
            </View>
          </Pressable>
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
        {/* 左上角：类目筛选 (恢复原样) */}
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
              {/* 清除筛选的 ✕ 按钮 */}
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

      {/* 第一行：扫码 + 新建器件（与第二行完全一致, 4 个按钮等高等宽） */}
      {/* 关键: 无库存时, 扫码/新建/控制所有 都不可用, 全部隐藏 */}
      {shelves.length > 0 && (
        <>
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
              <Text style={styles.controlAllButtonText}>新建器件</Text>
            </TouchableOpacity>
          </View>

          {/* 第二行：点亮所有 + 熄灭所有（1:1 等宽,与第一行完全一致） */}
          <View style={styles.controlAllButtonsContainer}>
            <TouchableOpacity
              style={[styles.controlAllButton, styles.controlAllOnButton]}
              onPress={handleControlAllLightsOn}
            >
              <Text style={styles.controlAllButtonText}>点亮所有</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlAllButton, styles.controlAllOffButton]}
              onPress={handleControlAllLightsOff}
            >
              <Text style={styles.controlAllButtonText}>熄灭所有</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 设备标签列表 - 必须用 FlatList（参考 settings.tsx）
          原因: react-native-gesture-handler 的 Swipeable (横向 pan 手势)
          不能放在普通 ScrollView 里, 会和纵向滚动手势冲突导致左滑失效.
          FlatList 内部对 gesture-handler 做了集成, 左滑才能正常工作. */}
      <FlatList
        style={styles.tagsContainer}
        data={memoizedFilteredDevices}
        keyExtractor={(item) => item.id}
        renderItem={renderDeviceItem}
        ItemSeparatorComponent={() => <View style={styles.tagDivider} />}
        contentContainerStyle={styles.tagsList}
        showsVerticalScrollIndicator={true}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#1976d2" />
              <Text style={styles.loadingText}>加载器件数据中...</Text>
            </View>
          ) : shelves.length === 0 ? (
            // ========== 关键: 新装用户零库存时的空状态 ==========
            // 引导用户从"设置 → 库存管理"创建第一个库存
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Text style={styles.emptyIcon}>📦</Text>
              </View>
              <Text style={styles.emptyTitle}>还没有库存</Text>
              <Text style={styles.emptySubtitle}>
                请先创建一个库存, 再开始添加器件
              </Text>
              <TouchableOpacity
                style={styles.emptyPrimaryButton}
                onPress={() => navigation.navigate('ShelfManager')}
                activeOpacity={0.8}
              >
                <Text style={styles.emptyPrimaryButtonText}>+ 新建库存</Text>
              </TouchableOpacity>
              <Text style={styles.emptyHint}>
                也可以从微信/QQ 导入他人分享的库存数据
              </Text>
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
          )
        }
        ListFooterComponent={<View style={{ height: 20 }} />}
      />

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

      {/* 库存切换 FAB: 左下角圆形 + 按钮 (绝对定位, 不影响列表滚动) */}
      <TouchableOpacity
        style={styles.shelfFab}
        onPress={handleOpenShelfSheet}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.shelfFabIcon}>⇄</Text>
      </TouchableOpacity>

      {/* 库存切换 BottomSheet: 从屏幕下方上滑弹出, 最大占屏幕一半高度 (仅切换) */}
      {showShelfSheet && (
        <View style={styles.bottomSheetBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleCloseShelfSheet}
          />
          <View style={styles.bottomSheetContent}>
            <View style={styles.bottomSheetHandle} />
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>切换库存</Text>
              <TouchableOpacity onPress={handleCloseShelfSheet}>
                <Text style={styles.bottomSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 库存列表（仅切换） */}
            <ScrollView style={styles.bottomSheetList} keyboardShouldPersistTaps="handled">
              {shelfSheetList.map((shelf) => {
                const isCurrent = shelf.id === currentShelfId;
                return (
                  <TouchableOpacity
                    key={shelf.id}
                    style={[styles.bottomSheetItem, isCurrent && styles.bottomSheetItemActive]}
                    onPress={() => handleSwitchShelfFromSheet(shelf)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.bottomSheetRadio,
                        isCurrent && styles.bottomSheetRadioActive,
                      ]}
                    >
                      {isCurrent && <View style={styles.bottomSheetRadioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.bottomSheetItemName,
                          isCurrent && styles.bottomSheetItemNameActive,
                        ]}
                        numberOfLines={1}
                      >
                        {shelf.name}
                      </Text>
                      <Text style={styles.bottomSheetItemMeta}>
                        {shelf.deviceCount} 个器件
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ========== 器件图片全屏放大 Modal ==========
          与 ImageUploadField 同模式: 单击背景/图片/关闭按钮都能退出 */}
      <Modal
        visible={!!zoomedImageUri}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedImageUri(null)}
        statusBarTranslucent
      >
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Pressable
          style={styles.imageZoomBackdrop}
          onPress={() => setZoomedImageUri(null)}
        >
          {zoomedImageUri ? (
            <Image
              source={{ uri: zoomedImageUri }}
              style={styles.imageZoomImage}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            style={styles.imageZoomClose}
            onPress={() => setZoomedImageUri(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.imageZoomCloseText}>×</Text>
          </TouchableOpacity>
          <Text style={styles.imageZoomHint}>点击任意位置返回</Text>
        </Pressable>
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

  // ===== 库存切换 FAB + BottomSheet =====
  shelfFab: {
    position: 'absolute',
    right: 20, // 平移到右下角 (用户反馈: 左下角会遮挡器件图片)
    bottom: 18, // 紧贴底部 tab 栏上方 (避免误触, 视觉上与"库存"tab 对齐)
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976d2',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  shelfFabIcon: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '500',
    lineHeight: 30,
  },
  bottomSheetBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheetContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '50%', // 关键: 最大屏幕一半
    paddingBottom: 16,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  bottomSheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  bottomSheetClose: {
    fontSize: 18,
    color: '#999',
    paddingHorizontal: 8,
  },
  bottomSheetList: {
    maxHeight: 280, // 列表区最大高度, 超出滚动
  },
  bottomSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  bottomSheetItemActive: {
    backgroundColor: '#e3f2fd',
  },
  bottomSheetRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bottomSheetRadioActive: {
    borderColor: '#1976d2',
  },
  bottomSheetRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1976d2',
  },
  bottomSheetItemName: {
    fontSize: 15,
    color: '#333',
  },
  bottomSheetItemNameActive: {
    color: '#1976d2',
    fontWeight: '600',
  },
  bottomSheetItemMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
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
    // 微信风格: item 直接连接屏幕左右边缘, 不要 padding
  },
  // FlatList contentContainerStyle
  // 关键: 底部预留 220px, 约等于 2-3 个器件标签 (含 8px 分隔) 高度的滚动空间,
  // 这样滑到最后一个器件时还能继续往上滑, 用户能看到"已到底"的呼吸感,
  // 而不会"卡死"在最后一条
  tagsList: {
    paddingTop: 12,
    paddingHorizontal: 8,   // 标签左右也留点空, 视觉更轻
    paddingBottom: 220,
  },
  // 标签之间留白: 8px 浅灰分隔, 视觉上「隔开」而不是「切线」
  tagDivider: {
    height: 8,
  },
  deviceTag: {
    backgroundColor: 'white',
    // 微信风格: 无圆角, 无阴影
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',  // 与图片顶端对齐, 后续 space-between 才能精确贴顶/贴底
    minHeight: 94,  // 70 (方图) + 12*2 (padding)
    position: 'relative',
  },
  litDeviceTag: {
    backgroundColor: '#98ee9cff',
    // 微信风格: 无圆角, 无阴影
  },
  // 左侧方图(圆角, 固定 70x70)
  deviceTagImageWrap: {
    width: 70,
    height: 70,
    borderRadius: 10,  // 圆角
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 图片点击放大区: 充满 70x70 wrap, 没有可见样式, 仅做点击事件透传
  deviceTagImagePressable: {
    width: '100%',
    height: '100%',
  },
  deviceTagImage: {
    width: '100%',
    height: '100%',
  },
  // ========== 器件图片全屏放大 Modal 样式 (与 ImageUploadField 保持一致) ==========
  imageZoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageZoomImage: {
    width: '95%',
    height: '85%',
  },
  imageZoomClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageZoomCloseText: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 24,
  },
  imageZoomHint: {
    position: 'absolute',
    bottom: 36,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
  // 默认占位（用户未上传图片时显示）
  deviceTagImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  deviceTagImagePlaceholderIcon: {
    fontSize: 22,
    opacity: 0.6,
  },
  deviceTagImagePlaceholderText: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  // 右侧字段堆叠容器(3 行: 编号+类目 / 名称 / 位置+数量)
  // 高度显式 = 70 (与图片同高), space-between 让首行贴顶/末行贴底/名称居中
  deviceTagContent: {
    flex: 1,
    height: 70,
    justifyContent: 'space-between',
  },
  // 普通字段(小字号)
  deviceTagMeta: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
  // 第一行: 编号 + 类目(flex 同行, 编号不被挤, 类目允许被压, y 中心对齐)
  deviceTagRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 器件名称: 比其他字段"大两号" (12 -> 18, 差 3 档)
  deviceTagName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1976d2',
    lineHeight: 22,
  },
  // 名称居中容器
  deviceTagNameCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  // 亮灯时名称高亮
  deviceTagNameLit: {
    color: '#0d47a1',
  },
  // 第三行: 位置 + 数量(flex 同行, 位置不被挤, 数量允许被压, y 中心对齐)
  deviceTagRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 数量(第三行右, 带 × 前缀, 短时靠右/长时右省略)
  deviceTagQuantityCorner: {
    marginLeft: 24,  // 2 字符宽度间距
  },
  addButton: {
    backgroundColor: '#1976d2',  // 跟扫码按钮颜色一致
    // 不再覆盖 flex/padding/borderRadius/alignItems, 让 controlAllButton 决定布局
    // → 4 个按钮完全等高 / 等宽 / 同圆角
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
  emptyPrimaryButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 4,
    marginBottom: 16,
  },
  emptyPrimaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
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
  // 控制所有灯/扫码/新建按钮样式 - 4 个按钮完全一致(高度/宽度/圆角/padding 都一样)
  controlAllButtonsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 8,
  },
  controlAllButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
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
