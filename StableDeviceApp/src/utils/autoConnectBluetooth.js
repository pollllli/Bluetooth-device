/**
 * 共享蓝牙自动连接工具
 *
 * 用途:
 * - 库存页 (DeviceListScreen) 导入数据后, 后台自动连绑定的蓝牙
 * - 切库后 (DeviceListScreen.handleSwitchShelfFromSheet) 后台自动连
 * - 其他需要"在当前页内自动连、不跳连接页"的场景
 *
 * 区别于 ConnectionScreen 内的 connectToBluetoothDevice:
 * - 不弹 Alert 错误 (后台静默, 失败只 Toast / console.warn)
 * - 不 setAvailableDevices / setConnectedDevice (那些是 ConnectionScreen 的本地 state)
 * - 仍然更新 global.deviceConnection + ShelfService.setShelfBluetooth
 *
 * 关键: 不依赖 React Navigation, 不导航, 调用方保持在原页面
 *
 * 关键: 之前 `waitForHandler` 假设全局已有 BluetoothHandler 实例, 但
 * ConnectionScreen 里的 handler 是 useState 本地变量, 离开页面就丢;
 * 导入流程 (用户从来没见过 ConnectionScreen) 时根本没有 handler,
 * 自动连一定失败。现改为: 没有 handler 时自己 new + initialize 一个
 * (和 DeviceListScreen.handleReconnect / UserContext.tryAutoConnectBluetooth 同模式)
 */

import { Platform, PermissionsAndroid, ToastAndroid } from 'react-native';
import BluetoothHandler from '../services/BluetoothHandler';
import ShelfService from '../services/ShelfService';

/**
 * 请求蓝牙相关权限 (Android 12+: SCAN + CONNECT; 老版本: 位置权限)
 * @returns {Promise<boolean>}
 */
async function ensureBluetoothPermissions() {
  if (Platform.OS !== 'android') return true;
  try {
    const perms = [];
    const PA = PermissionsAndroid.PERMISSIONS || {};
    if (PA.BLUETOOTH_SCAN) perms.push(PA.BLUETOOTH_SCAN);
    if (PA.BLUETOOTH_CONNECT) perms.push(PA.BLUETOOTH_CONNECT);
    if (PA.ACCESS_FINE_LOCATION) perms.push(PA.ACCESS_FINE_LOCATION);
    if (perms.length === 0) return true;
    const results = await PermissionsAndroid.requestMultiple(perms);
    const granted = (v) => v === PermissionsAndroid.RESULTS.GRANTED;
    const scanOk = !perms.includes(PA.BLUETOOTH_SCAN) || granted(results[PA.BLUETOOTH_SCAN]);
    const connectOk = !perms.includes(PA.BLUETOOTH_CONNECT) || granted(results[PA.BLUETOOTH_CONNECT]);
    return scanOk && connectOk;
  } catch (e) {
    console.warn('[autoConnectBluetooth] 请求权限异常:', e);
    return false;
  }
}

/**
 * 拿到一个可用的 BluetoothHandler 实例
 *
 * 优先级:
 * 1. 已有全局连接 (global.deviceConnection.handler) → 直接用, 避免重复创建 BleManager
 * 2. 上次应用启动时 UserContext 缓存到 global.deviceConnection 的 handler → 复用
 * 3. 都没有 → 自己 new + initialize 一个临时实例
 *
 * @returns {Promise<{handler: object, createdNew: boolean}|null>}
 */
async function getOrCreateHandler() {
  // 1) 全局已有连接
  if (global.deviceConnection && global.deviceConnection.handler
      && typeof global.deviceConnection.handler.connectToDevice === 'function') {
    return { handler: global.deviceConnection.handler, createdNew: false };
  }

  // 2) 全局已有 handler 但没连接 (极少, 但兼容)
  if (global._bluetoothHandlerInstance
      && typeof global._bluetoothHandlerInstance.connectToDevice === 'function') {
    return { handler: global._bluetoothHandlerInstance, createdNew: false };
  }

  // 3) 都没有, 自己创建
  try {
    console.log('[autoConnectBluetooth] 未发现可用 handler, 自创建...');
    const handler = new BluetoothHandler();
    const initRes = await handler.initialize();
    if (!initRes || initRes.success === false) {
      console.warn('[autoConnectBluetooth] 蓝牙管理器初始化失败:', initRes && initRes.message);
      return null;
    }
    // 缓存到 global, 下次自动连 / 其他场景可复用
    global._bluetoothHandlerInstance = handler;
    return { handler, createdNew: true };
  } catch (e) {
    console.warn('[autoConnectBluetooth] 创建 handler 失败:', e && e.message);
    return null;
  }
}

/**
 * 弹一个简短的 Android Toast 提示用户
 * iOS / Web 平台静默忽略
 */
function showToast(text) {
  if (Platform.OS === 'android' && ToastAndroid && typeof ToastAndroid.show === 'function') {
    try {
      ToastAndroid.show(text, ToastAndroid.SHORT);
    } catch (e) {
      // ignore
    }
  } else {
    console.log('[autoConnectBluetooth][toast]', text);
  }
}

/**
 * 静默自动连接指定 MAC 的蓝牙设备
 * - 不弹任何 Alert 错误
 * - 不导航
 * - 失败用 ToastAndroid 短提示, 同时 console.warn
 * - 成功会更新 global.deviceConnection + 绑定到当前 shelf
 *
 * @param {string} mac - 设备 MAC
 * @param {string} [name] - 设备名称 (可选, 用于绑定到 shelf)
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function autoConnectBluetooth(mac, name) {
  if (!mac) {
    return { ok: false, reason: 'mac 为空' };
  }
  console.log('[autoConnectBluetooth] 开始后台自动连, mac=', mac, 'name=', name);
  showToast(`正在连接蓝牙...`);

  // 1) 权限检查
  const hasPerm = await ensureBluetoothPermissions();
  if (!hasPerm) {
    console.warn('[autoConnectBluetooth] 权限未授予, 放弃');
    showToast('蓝牙权限未授予, 自动连接取消');
    return { ok: false, reason: 'permission_denied' };
  }

  // 2) 拿到/创建 handler
  const got = await getOrCreateHandler();
  if (!got) {
    console.warn('[autoConnectBluetooth] 无法获取蓝牙管理器实例');
    showToast('蓝牙初始化失败, 自动连接取消');
    return { ok: false, reason: 'handler_not_ready' };
  }
  const handler = got.handler;
  if (got.createdNew) {
    console.log('[autoConnectBluetooth] 已自创建 BluetoothHandler 实例');
  }

  // 3) 连接前先确认 BleManager 完全就绪 (state = PoweredOn)
  //    修复: 之前直接 race 5s 超时, 但 Android BLE 栈刚初始化需要 1-3 秒"热机"
  //          加上 BLE GATT 连接 2-3 秒 + discoverAllServicesAndCharacteristics 2-3 秒,
  //          总共 6-9 秒, 5s 必超时 → "目标蓝牙不在范围"误报
  try {
    if (handler && handler.manager && typeof handler.manager.state === 'function') {
      const state = await handler.manager.state();
      console.log('[autoConnectBluetooth] BleManager state =', state);
      if (state !== 'PoweredOn') {
        // 等最多 3 秒, 每 200ms 轮询一次, 看到 PoweredOn 就继续
        const startWait = Date.now();
        while (Date.now() - startWait < 3000) {
          await new Promise(r => setTimeout(r, 200));
          const s = await handler.manager.state();
          if (s === 'PoweredOn') {
            console.log('[autoConnectBluetooth] BleManager 已就绪 (等待', Date.now() - startWait, 'ms)');
            break;
          }
          if (s === 'PoweredOff' || s === 'Unauthorized') {
            console.warn('[autoConnectBluetooth] 蓝牙未开启或未授权, state=', s);
            showToast('蓝牙未开启, 自动连接取消');
            return { ok: false, reason: 'adapter_not_ready' };
          }
        }
      }
    }
  } catch (stateErr) {
    // state 查询失败不阻塞主流程, 继续尝试连接
    console.warn('[autoConnectBluetooth] 查询 BleManager state 异常:', stateErr && stateErr.message);
  }

  // 4) 调用底层连接 (带超时 10s, 和 ConnectionScreen 保持一致)
  //    修复: 之前是 5s 太短, 微信接收文件 → App 后台刚唤起 → BLE 栈需要 6-9 秒
  try {
    const connectWithTimeout = Promise.race([
      handler.connectToDevice(mac),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('连接超时 (10s)')); }, 10000);
      }),
    ]);
    await connectWithTimeout;
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.warn('[autoConnectBluetooth] 连接失败:', msg);
    showToast('目标蓝牙不在范围内');
    return { ok: false, reason: 'connect_failed', message: msg };
  }

  // 4) 成功: 构造 device 对象 (ConnectionScreen 内也是这样处理)
  const device = { id: mac, name: name || '未知设备' };

  // 5) 更新全局连接状态 (其他页面/库存页 status badge 读这个)
  global.deviceConnection = {
    type: 'bluetooth',
    device: device,
    handler: handler,
  };

  // 6) 绑定到当前库存 (库存-蓝牙记忆)
  try {
    const currentShelfId = await ShelfService.getCurrentShelfId();
    if (currentShelfId) {
      await ShelfService.setShelfBluetooth(currentShelfId, mac, device.name);
      console.log('[autoConnectBluetooth] 已绑定到当前库存', currentShelfId, '->', device.name);
    }
  } catch (e) {
    console.warn('[autoConnectBluetooth] 绑定当前库存失败:', e);
  }

  console.log('[autoConnectBluetooth] 自动连成功, mac=', mac);
  showToast(`已自动连接: ${device.name}`);
  return { ok: true };
}
