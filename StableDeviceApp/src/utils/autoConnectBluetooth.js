/**
 * 共享蓝牙自动连接工具
 *
 * 用途:
 * - 库存页 (DeviceListScreen) 导入数据后, 后台自动连绑定的蓝牙
 * - 切库后 (DeviceListScreen.handleSwitchShelfFromSheet) 后台自动连
 * - 其他需要"在当前页内自动连、不跳连接页"的场景
 *
 * 区别于 ConnectionScreen 内的 connectToBluetoothDevice:
 * - 不弹 Alert 错误 (后台静默, 失败只 console.warn)
 * - 不 setAvailableDevices / setConnectedDevice (那些是 ConnectionScreen 的本地 state)
 * - 仍然更新 global.deviceConnection + ShelfService.setShelfBluetooth
 *
 * 关键: 不依赖 React Navigation, 不导航, 调用方保持在原页面
 */

import { Alert, Platform, PermissionsAndroid } from 'react-native';
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
 * 等 BluetoothHandler 全局单例就绪
 * ConnectionScreen 里会先 setBluetoothHandler, 别的页面调用时可能还没就绪
 * @param {number} maxAttempts
 * @returns {Promise<object|null>}
 */
async function waitForHandler(maxAttempts) {
  const max = maxAttempts || 20;
  for (let i = 0; i < max; i++) {
    const handler = BluetoothHandler && (BluetoothHandler.instance || BluetoothHandler);
    if (handler && typeof handler.connectToDevice === 'function') {
      return handler;
    }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  return null;
}

/**
 * 静默自动连接指定 MAC 的蓝牙设备
 * - 不弹任何 Alert 错误
 * - 不导航
 * - 失败仅 console.warn
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

  // 1) 权限检查
  const hasPerm = await ensureBluetoothPermissions();
  if (!hasPerm) {
    console.warn('[autoConnectBluetooth] 权限未授予, 放弃');
    return { ok: false, reason: 'permission_denied' };
  }

  // 2) 等 handler 就绪
  const handler = await waitForHandler(20);
  if (!handler) {
    console.warn('[autoConnectBluetooth] BluetoothHandler 4s 内未就绪');
    return { ok: false, reason: 'handler_not_ready' };
  }

  // 3) 调用底层连接
  try {
    await handler.connectToDevice(mac);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.warn('[autoConnectBluetooth] 连接失败:', msg);
    return { ok: false, reason: 'connect_failed' };
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
  return { ok: true };
}
