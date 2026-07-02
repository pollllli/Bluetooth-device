/**
 * 蓝牙连接页面组件
 * 
 * 功能说明：
 * - 蓝牙设备扫描与连接管理
 * - 自动连接上次连接的设备
 * - 支持手动选择设备进行连接
 * - 显示设备信号强度（RSSI）
 * - 设备连接状态实时监测
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  SafeAreaView,
} from 'react-native';
import BluetoothHandler from '../services/BluetoothHandler';
import StorageService from '../services/StorageService';
import ShelfService from '../services/ShelfService';

/**
 * 按信号强度（RSSI）降序排序设备列表
 * 
 * 排序规则：
 * - 信号越强（RSSI值越接近0）的设备越靠前
 * - 无RSSI字段（null/undefined）或为0的设备排到末尾
 * 
 * @param {Array} devices - 扫描到的蓝牙设备列表
 * @returns {Array} 排序后的设备列表（不修改原数组）
 */
function sortDevicesByRssi(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return devices || [];
  return [...devices].sort((a, b) => {
    const rA = typeof a?.rssi === 'number' && a.rssi < 0 ? a.rssi : -999;
    const rB = typeof b?.rssi === 'number' && b.rssi < 0 ? b.rssi : -999;
    return rB - rA; // 降序排序：RSSI值大的排前面
  });
}

const ConnectionScreen = ({ navigation, route }) => {
  // 蓝牙扫描相关状态
  const [isScanning, setIsScanning] = useState(false);           // 是否正在扫描设备
  const [availableDevices, setAvailableDevices] = useState([]);   // 扫描到的可用设备列表
  
  // 连接状态相关
  const [isConnected, setIsConnected] = useState(false);          // 是否已连接
  const [connectedDevice, setConnectedDevice] = useState(null);   // 当前连接的设备信息
  const [connectionStatus, setConnectionStatus] = useState('未连接'); // 连接状态文本
  
  // 蓝牙处理器相关
  const [bluetoothHandler, setBluetoothHandler] = useState(null); // 蓝牙处理器实例
  const [baudRate, setBaudRate] = useState(null);                 // 检测到的波特率
  
  // 自动连接相关
  const [isAutoConnecting, setIsAutoConnecting] = useState(false); // 是否正在自动连接
  const [canManualConnect, setCanManualConnect] = useState(false); // 是否允许手动连接
  
  // 自动连接超时定时器引用
  const autoConnectTimeoutRef = useRef(null);

  /**
   * 组件挂载时的初始化逻辑
   * 
   * 初始化步骤：
   * 1. 创建并初始化蓝牙处理器
   * 2. 检查全局连接状态（处理热启动等场景）
   * 3. 尝试自动连接上次连接的设备
   * 4. 注册蓝牙断开回调监听
   * 5. 设置定时检查连接状态
   */
  useEffect(() => {
    const initHandlers = async () => {
      try {
        // 创建蓝牙处理器实例并初始化
        const bluetooth = new BluetoothHandler();
        await bluetooth.initialize();
        setBluetoothHandler(bluetooth);

        // 检查全局连接状态（处理应用热启动等场景）
        checkGlobalConnectionStatus();

        // 尝试自动连接上次连接的设备
        await tryAutoConnect(bluetooth);
      } catch (error) {
        console.error('初始化蓝牙处理器失败:', error);
      }
    };

    initHandlers();

    // 设置定时检查连接状态（每2秒检查一次）
    const checkInterval = setInterval(() => {
      checkGlobalConnectionStatus();
    }, 2000);

    // 注册蓝牙断开全局回调
    global.onBluetoothDisconnected = () => {
      console.log('ConnectionScreen收到蓝牙断开通知');
      setIsConnected(false);
      setConnectedDevice(null);
      setConnectionStatus('未连接');
      setCanManualConnect(true);
    };

    // 清理函数：组件卸载时执行
    return () => {
      clearInterval(checkInterval);                          // 清除定时检查
      if (autoConnectTimeoutRef.current) {                  // 清除自动连接超时定时器
        clearTimeout(autoConnectTimeoutRef.current);
      }
      if (bluetoothHandler) {                              // 断开蓝牙连接
        bluetoothHandler.disconnect();
      }
      delete global.onBluetoothDisconnected;                // 删除全局断开回调
    };
  }, []);

  // ========== 切库后: 自动连 / 自动扫 ==========
  useFocusEffect(
    useCallback(() => {
      const params = route?.params;
      const action = params?.action;
      console.log('[ConnectionScreen] focus, params=', JSON.stringify(params));

      if (action !== 'switchShelf') return;

      // 清除路由参数, 避免下次重新进入再次触发
      navigation.setParams({
        action: undefined,
        targetShelfId: undefined,
        autoScan: undefined,
        autoScanAt: undefined,
        autoConnectMac: undefined,
        autoConnectName: undefined,
      });

      // 路径 A: 切库到已绑定的蓝牙, 直接连接
      const autoMac = params?.autoConnectMac;
      if (autoMac) {
        const tryAutoConnect = async (attempt = 0) => {
          if (typeof connectToBluetoothDevice === 'function' && bluetoothHandler) {
            console.log('[ConnectionScreen] 自动连接 MAC=', autoMac, 'attempt=', attempt);
            try {
              // 关键: 自动连前先确保权限已授予 (App.tsx 启动时已请求过, 这里再补一道兜底)
              // 否则 Android 12+ 会因为没授权直接拒绝连接 → 弹"自动连接失败"
              try {
                if (typeof requestBluetoothPermissions === 'function') {
                  const hasPerm = await requestBluetoothPermissions();
                  if (!hasPerm) {
                    console.warn('[ConnectionScreen] 自动连接: 权限未授予, 降级到扫描');
                    if (typeof scanForBluetoothDevices === 'function') {
                      scanForBluetoothDevices();
                    }
                    return;
                  }
                }
              } catch (permErr) {
                console.warn('[ConnectionScreen] 自动连接: 请求权限异常, 继续尝试连接', permErr);
              }
              await connectToBluetoothDevice(autoMac);
            } catch (err) {
              console.warn('[ConnectionScreen] 自动连接失败:', err);
              // 失败降级到扫描
              if (typeof scanForBluetoothDevices === 'function') {
                scanForBluetoothDevices();
              }
            }
          } else if (attempt < 20) {
            setTimeout(() => tryAutoConnect(attempt + 1), 200);
          } else {
            Alert.alert('提示', '切库成功, 请点击"扫描蓝牙设备"按钮手动重连');
          }
        };
        tryAutoConnect();
        return;
      }

      // 路径 B: 切库后正常扫描
      let cancelled = false;
      const tryScan = (attempt = 0) => {
        if (cancelled) return;
        if (typeof scanForBluetoothDevices === 'function' && bluetoothHandler) {
          console.log('[ConnectionScreen] 自动触发扫描, attempt=', attempt);
          scanForBluetoothDevices();
        } else if (attempt < 20) {
          setTimeout(() => tryScan(attempt + 1), 200);
        } else {
          console.warn('[ConnectionScreen] 蓝牙处理器 4s 内未就绪, 放弃自动扫描');
          Alert.alert('提示', '切库成功, 请点击"扫描蓝牙设备"按钮手动重连');
        }
      };
      tryScan();

      return () => {
        cancelled = true;
      };
    }, [route?.params, navigation])
  );

  const checkGlobalConnectionStatus = () => {
    if (global.deviceConnection && global.deviceConnection.device) {
      if (!isConnected) {
        console.log('检测到全局连接状态，更新界面:', global.deviceConnection);
        setIsConnected(true);
        setConnectedDevice(global.deviceConnection.device);
        setConnectionStatus('已连接到蓝牙设备');
      }
    } else {
      if (isConnected) {
        console.log('检测到连接已断开，更新界面');
        setIsConnected(false);
        setConnectedDevice(null);
        setConnectionStatus('未连接');
      }
    }
  };

  const tryAutoConnect = async (bluetooth) => {
    try {
      const lastDevice = await StorageService.getLastConnectedDevice();
      if (!lastDevice || !lastDevice.deviceId) {
        console.log('没有找到上次连接的蓝牙设备信息');
        setCanManualConnect(true);
        return;
      }

      console.log('尝试自动连接上次的蓝牙设备:', lastDevice.deviceName);
      setIsAutoConnecting(true);
      setConnectionStatus('正在自动连接...');

      autoConnectTimeoutRef.current = setTimeout(() => {
        if (!isConnected) {
          console.log('自动连接超时，允许手动连接');
          setCanManualConnect(true);
          setConnectionStatus('自动连接超时，请手动选择设备');
        }
      }, 10000);

      const result = await bluetooth.connectToDevice(lastDevice.deviceId);
      if (result.success) {
        if (autoConnectTimeoutRef.current) {
          clearTimeout(autoConnectTimeoutRef.current);
        }
        console.log('自动连接成功:', lastDevice.deviceName);
        setIsConnected(true);
        setConnectedDevice({ id: lastDevice.deviceId, name: lastDevice.deviceName });
        setConnectionStatus('已连接到蓝牙设备');
        setCanManualConnect(false);
        
        // 获取检测到的波特率
        const detectedBaud = bluetooth.getCurrentBaudRate();
        setBaudRate(detectedBaud);
        console.log('检测到的波特率:', detectedBaud);

        global.deviceConnection = {
          type: 'bluetooth',
          device: { id: lastDevice.deviceId, name: lastDevice.deviceName },
          handler: bluetooth,
        };

        // 自动连接成功: 记录到当前库存
        try {
          const currentShelfId = await ShelfService.getCurrentShelfId();
          if (currentShelfId) {
            await ShelfService.setShelfBluetooth(currentShelfId, lastDevice.deviceId, lastDevice.deviceName);
            console.log('[蓝牙记忆] 自动连接已绑定到库存', currentShelfId, '->', lastDevice.deviceName, lastDevice.deviceId);
          }
        } catch (e) {
          console.warn('[蓝牙记忆] 自动连接保存失败:', e);
        }
      }
    } catch (error) {
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
      }
      // 心跳验证失败的友好提示
      if (error.message && error.message.includes('心跳')) {
        console.log('自动连接失败：设备未响应心跳（不是我们的设备）:', error.message);
        setConnectionStatus('该设备未响应心跳，请手动选择其他设备');
        setCanManualConnect(true);
      } else {
        console.log('自动连接失败，需要手动选择设备:', error.message);
        setConnectionStatus('自动连接失败，请手动选择');
        setCanManualConnect(true);
      }
    } finally {
      setIsAutoConnecting(false);
    }
  };

  const requestBluetoothPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const locationGranted =
          (await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: '位置权限',
              message: '应用需要位置权限才能扫描蓝牙设备',
              buttonNeutral: '稍后询问',
              buttonNegative: '拒绝',
              buttonPositive: '允许',
            }
          )) === PermissionsAndroid.RESULTS.GRANTED;

        const scanGranted =
          (await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            {
              title: '蓝牙扫描权限',
              message: '应用需要蓝牙扫描权限才能发现附近的蓝牙设备',
              buttonNeutral: '稍后询问',
              buttonNegative: '拒绝',
              buttonPositive: '允许',
            }
          )) === PermissionsAndroid.RESULTS.GRANTED;

        const connectGranted =
          (await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            {
              title: '蓝牙连接权限',
              message: '应用需要蓝牙连接权限才能连接到蓝牙设备',
              buttonNeutral: '稍后询问',
              buttonNegative: '拒绝',
              buttonPositive: '允许',
            }
          )) === PermissionsAndroid.RESULTS.GRANTED;

        console.log('蓝牙权限请求结果:', {
          locationGranted,
          scanGranted,
          connectGranted,
        });

        return locationGranted && scanGranted && connectGranted;
      } catch (error) {
        console.error('请求蓝牙权限失败:', error);
        return false;
      }
    } else {
      return true;
    }
  };

  const scanForBluetoothDevices = async () => {
    if (!bluetoothHandler) {
      Alert.alert('错误', '蓝牙处理器未初始化');
      return;
    }

    const hasPermissions = await requestBluetoothPermissions();
    if (!hasPermissions) {
      Alert.alert('权限错误', '需要蓝牙权限才能扫描设备');
      return;
    }

    setIsScanning(true);
    setAvailableDevices([]); // 扫描开始立即清空列表, 避免显示上次的旧设备
    try {
      const devices = await bluetoothHandler.scanForDevices();
      // 按信号强度降序排：RSSI 越大（越接近 0）= 信号越强 = 越靠前
      // 无 RSSI 字段的设备排到最后
      const sorted = sortDevicesByRssi(devices);
      setAvailableDevices(sorted);
      if (sorted.length === 0) {
        // 2 秒未扫到任何信号强度 ≥ -80dBm 的设备，提供重扫选项
        // (-80dBm = 强信号, 加快扫描速度, 过滤掉远距离/穿墙的弱信号设备)
        Alert.alert(
          '未发现蓝牙设备',
          '2 秒内未扫描到信号强度足够的设备（RSSI ≥ -80dBm）。\n请确保设备已开启且距离较近。',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '重新扫描',
              onPress: () => {
                // 用户主动重扫：再次调用扫描
                scanForBluetoothDevices();
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error('扫描蓝牙设备失败:', error);
      Alert.alert('错误', `扫描蓝牙设备失败: ${error.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const connectToBluetoothDevice = async (deviceId) => {
    if (!bluetoothHandler) {
      Alert.alert('错误', '蓝牙处理器未初始化');
      return;
    }

    try {
      await bluetoothHandler.connectToDevice(deviceId);
      const device = availableDevices.find((d) => d.id === deviceId);
      setConnectedDevice(device);
      setIsConnected(true);
      setConnectionStatus(`已连接到: ${device.name}`);
      setCanManualConnect(false);

      // 获取检测到的波特率
      const detectedBaud = bluetoothHandler.getCurrentBaudRate();
      setBaudRate(detectedBaud);
      console.log('检测到的波特率:', detectedBaud);

      global.deviceConnection = {
        type: 'bluetooth',
        device: device,
        handler: bluetoothHandler,
      };

      // 手动连接成功: 绑定到当前库存 (实现库存-蓝牙记忆)
      try {
        const currentShelfId = await ShelfService.getCurrentShelfId();
        if (currentShelfId) {
          await ShelfService.setShelfBluetooth(currentShelfId, deviceId, device.name);
          console.log('[蓝牙记忆] 手动连接已绑定到库存', currentShelfId, '->', device.name, deviceId);
        }
      } catch (e) {
        console.warn('[蓝牙记忆] 手动连接保存失败:', e);
      }
    } catch (error) {
      console.error('连接蓝牙设备失败:', error);
      // 获取连接日志
      const logs = bluetoothHandler ? bluetoothHandler.getConnectionLog() : [];
      
      // 提取发送和接收的信息
      let sendInfo = '无';
      let receiveInfo = '无';
      let sendCount = 0;
      let receiveCount = 0;
      
      logs.forEach(log => {
        if (log.type === 'send') {
          sendCount++;
          if (log.details && log.details.hex) {
            sendInfo = `发送 ${sendCount}: ${log.details.hex}`;
          }
        } else if (log.type === 'receive') {
          receiveCount++;
          if (log.details && log.details.hex) {
            receiveInfo = `接收 ${receiveCount}: ${log.details.hex}`;
          }
        }
      });
      
      // 心跳验证失败的友好提示
      if (error.message && error.message.includes('心跳')) {
        const message = `连接失败：设备未响应心跳指令
        
【通信详情】
发送: ${sendInfo}
接收: ${receiveInfo}

【可能原因】
1. 设备不是本公司配套蓝牙模块
2. 设备固件版本不兼容
3. 蓝牙模块与下位机MCU的串口波特率不一致
4. 下位机未正确连接或未上电

【建议】
- 检查蓝牙模块与MCU的连接
- 确认MCU已上电并正常工作
- 检查串口波特率设置（当前检测: ${baudRate || '未知'}）`;
        
        Alert.alert('连接失败', message);
      } else {
        Alert.alert('错误', `连接蓝牙设备失败: ${error.message}`);
      }
    }
  };

  const disconnect = async () => {
    try {
      if (bluetoothHandler) {
        await bluetoothHandler.disconnect();
      }
      setIsConnected(false);
      setConnectedDevice(null);
      setConnectionStatus('未连接');
      delete global.deviceConnection;
      Alert.alert('成功', '已断开连接');
    } catch (error) {
      console.error('断开连接失败:', error);
      Alert.alert('错误', '断开连接失败');
    }
  };

  const renderDeviceItem = ({ item }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => connectToBluetoothDevice(item.id)}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName} numberOfLines={1}>
          {item.name || '(未知设备)'}
        </Text>
        <Text style={styles.deviceId} numberOfLines={1}>{item.id}</Text>
        <Text style={styles.deviceRssi}>信号强度: {item.rssi} dBm</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>蓝牙连接</Text>
      </View>

      <View style={styles.connectionStatus}>
        <View style={styles.statusRow}>
          <View style={[
            styles.statusDot,
            isConnected ? styles.statusDotConnected : styles.statusDotDisconnected
          ]} />
          <Text style={styles.statusText}>
            {isAutoConnecting
              ? '正在自动连接...'
              : isConnected
                ? `已连接: ${connectedDevice?.name || '设备'}`
                : connectionStatus}
          </Text>
        </View>
        {isConnected && (
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={disconnect}
          >
            <Text style={styles.disconnectButtonText}>断开连接</Text>
          </TouchableOpacity>
        )}
      </View>

      

      {!isConnected && (
        <>
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
            onPress={scanForBluetoothDevices}
            disabled={isScanning}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? '扫描中...' : '扫描蓝牙设备'}
            </Text>
          </TouchableOpacity>

          <FlatList
            data={availableDevices}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={renderDeviceItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {isScanning ? '正在扫描...' : isAutoConnecting ? '正在自动连接中...' : '点击上方按钮扫描蓝牙设备'}
              </Text>
            }
            style={styles.deviceList}
          />
        </>
      )}
    </SafeAreaView>
  );
};

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
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  connectionStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white',
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusDotConnected: {
    backgroundColor: '#4caf50',
  },
  statusDotDisconnected: {
    backgroundColor: '#f44336',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  disconnectButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 10,
  },
  disconnectButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  scanButton: {
    backgroundColor: '#1976d2',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  scanButtonDisabled: {
    backgroundColor: '#8e8e93',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceList: {
    flex: 1,
    marginHorizontal: 20,
  },
  deviceItem: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  deviceId: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  deviceRssi: {
    fontSize: 14,
    color: '#666',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 30,
    color: '#666',
    fontSize: 16,
  },
});

export default ConnectionScreen;
