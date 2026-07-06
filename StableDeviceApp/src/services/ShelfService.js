/**
 * 库存（器件架）管理服务
 *
 * 功能：
 * - 增删改查库存（shelves）
 * - 当前选中的库存（currentShelfId）持久化
 * - 删除库存时连带删除该库存下的所有器件
 *
 * 数据结构:
 *   shelves: [{ id: '1', name: '主库存' }, { id: '2', name: '仓库B' }, ...]
 *   currentShelfId: '1'  (单独存)
 *
 * 兼容老版本:
 *   老版本没有 shelves 数据, 默认初始化为 [{ id: '1', name: '主库存' }]
 */

import { saveData, getData, removeData } from '../utils/StorageUtils';
import { logError } from '../utils/ErrorHandler';
import StorageService from './StorageService';

const SHELVES_KEY = 'shelves';
const CURRENT_SHELF_KEY = 'currentShelfId';

let _shelvesCache = null;
let _currentShelfIdCache = null;

// 新装默认: 零库存, 由用户主动创建
// (不写示例库存"库存（一）", 老用户已存的数据不受影响 — storage 检查在前)
const DEFAULT_SHELVES = [];

// ========== 库存变化订阅 (用于 AppNavigator 实时显隐 "连接" / "BOM匹配" 标签) ==========
const _shelfListeners = new Set();
function _emitShelfChange(list) {
  for (const cb of _shelfListeners) {
    try { cb(list); } catch (e) { /* ignore */ }
  }
}
/**
 * 订阅库存列表变化 (新增/删除/导入后触发)
 * 首次调用会立即用当前列表触发一次 callback
 * @param {(shelves: Array) => void} cb
 * @returns {() => void} 取消订阅
 */
export function subscribeShelves(cb) {
  _shelfListeners.add(cb);
  // 异步拿当前列表, 触发一次
  getShelves().then((list) => {
    if (_shelfListeners.has(cb)) cb(list);
  }).catch(() => {});
  return () => { _shelfListeners.delete(cb); };
}

/**
 * 外部直接通知 shelves 变了 (用于绕过 ShelfService API 的写入路径, 如 StorageService.importShelfFromFile)
 * @param {Array} list - 最新的 shelves 数组
 */
export function notifyShelfChanged(list) {
  if (Array.isArray(list)) _emitShelfChange(list);
}

/**
 * 生成新的库存 ID（基于时间戳 + 随机数, 保证唯一）
 */
const generateShelfId = () => {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * 读取所有库存
 * @returns {Promise<Array<{id:string, name:string}>>}
 */
export async function getShelves() {
  try {
    if (_shelvesCache) return _shelvesCache;
    const list = await getData(SHELVES_KEY, null);
    if (Array.isArray(list) && list.length > 0) {
      _shelvesCache = list;
      return list;
    }
    // 老版本: 没存过, 初始化默认
    _shelvesCache = DEFAULT_SHELVES;
    await saveData(SHELVES_KEY, _shelvesCache);
    return _shelvesCache;
  } catch (err) {
    logError('读取库存列表失败', err, 'ShelfService.getShelves');
    return DEFAULT_SHELVES;
  }
}

/**
 * 添加新库存
 * @param {string} name
 * @returns {Promise<{id:string, name:string}>}
 */
export async function addShelf(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('库存名称不能为空');

  const list = await getShelves();
  if (list.some((s) => s.name === trimmed)) {
    throw new Error(`库存名称 "${trimmed}" 已存在`);
  }
  // 关键: 手动新建的库存**不携带任何蓝牙绑定**。
  // 蓝牙绑定仅由以下两条路径写入, 其它路径都不应注入:
  //   1. importShelfFromFile (导入数据时按文件名覆盖/新增, 文件里带了蓝牙就带)
  //   2. 任意连接成功路径 (ConnectionScreen / handleReconnect / autoConnectBluetooth) 写入"最后一次连接"
  // 这里显式置 null, 防止任何下游 `shelf.bluetoothMac` 拿到 undefined 而误判
  const newShelf = {
    id: generateShelfId(),
    name: trimmed,
    bluetoothMac: null,
    bluetoothName: null,
  };
  const next = [...list, newShelf];
  _shelvesCache = next;
  await saveData(SHELVES_KEY, next);
  _emitShelfChange(next);
  return newShelf;
}

/**
 * 重命名库存
 * @param {string} id
 * @param {string} newName
 */
export async function renameShelf(id, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('库存名称不能为空');

  const list = await getShelves();
  if (list.some((s) => s.name === trimmed && s.id !== id)) {
    throw new Error(`库存名称 "${trimmed}" 已存在`);
  }
  const target = list.find((s) => s.id === id);
  if (!target) throw new Error('库存不存在');
  const oldName = target.name;
  target.name = trimmed;
  _shelvesCache = [...list];
  await saveData(SHELVES_KEY, _shelvesCache);
  _emitShelfChange(_shelvesCache);
  return { oldName, newName: trimmed };
}

/**
 * 删除库存: 默认连带删除该库存下所有器件
 * @param {string} id
 * @returns {Promise<{deletedDeviceCount: number}>}
 */
export async function deleteShelf(id) {
  const list = await getShelves();
  // 关键: 允许删到 0 库存 — 新装用户默认就是 0
  // (之前写死"至少保留 1 个"是历史包袱, 现在是用户主动创建才存在, 删完不报错)
  if (list.length === 0) {
    throw new Error('没有可删除的库存');
  }
  const target = list.find((s) => s.id === id);
  if (!target) throw new Error('库存不存在');

  // 1. 删除该库存下所有器件
  const allDevices = await StorageService.getDevices();
  const remainingDevices = allDevices.filter((d) => d.shelfId !== id);
  const deletedDeviceCount = allDevices.length - remainingDevices.length;
  await StorageService.saveDevices(remainingDevices);

  // 2. 从库存列表里移除
  const next = list.filter((s) => s.id !== id);
  _shelvesCache = next;
  await saveData(SHELVES_KEY, next);
  _emitShelfChange(next);

  // 3. 如果删的是当前选中, 切到第一个
  const current = await getCurrentShelfId();
  if (current === id) {
    await setCurrentShelfId(next[0].id);
  }

  return { deletedDeviceCount, name: target.name };
}

/**
 * 读取当前选中的库存 ID
 */
export async function getCurrentShelfId() {
  try {
    if (_currentShelfIdCache) return _currentShelfIdCache;
    const id = await getData(CURRENT_SHELF_KEY, null);
    if (id) {
      // 校验: 库存是否还存在
      const shelves = await getShelves();
      if (shelves.some((s) => s.id === id)) {
        _currentShelfIdCache = id;
        return id;
      }
    }
    // 老版本/无效: 默认第一个库存
    const shelves = await getShelves();
    const first = shelves[0]?.id;
    _currentShelfIdCache = first;
    await saveData(CURRENT_SHELF_KEY, first);
    return first;
  } catch (err) {
    logError('读取当前库存失败', err, 'ShelfService.getCurrentShelfId');
    const shelves = await getShelves();
    return shelves[0]?.id;
  }
}

/**
 * 设置当前选中的库存 ID
 */
export async function setCurrentShelfId(id) {
  const list = await getShelves();
  if (!list.some((s) => s.id === id)) {
    throw new Error('库存不存在');
  }
  _currentShelfIdCache = id;
  await saveData(CURRENT_SHELF_KEY, id);
}

/**
 * 读取当前选中的库存完整对象
 */
export async function getCurrentShelf() {
  const id = await getCurrentShelfId();
  const list = await getShelves();
  return list.find((s) => s.id === id) || list[0];
}

/**
 * 统计指定库存下的器件数
 * @param {string} id
 */
export async function getShelfDeviceCount(id) {
  const allDevices = await StorageService.getDevices();
  return allDevices.filter((d) => d.shelfId === id).length;
}

/**
 * 设置/更新库存绑定的蓝牙模块
 * 连接成功后调用, 记录 "库存 X 配对 w02_Y"
 * @param {string} shelfId
 * @param {string} mac - 蓝牙 MAC 地址
 * @param {string} [name] - 蓝牙名称 (可选, 仅展示用)
 */
export async function setShelfBluetooth(shelfId, mac, name) {
  if (!shelfId || !mac) {
    throw new Error('shelfId 和 mac 不能为空');
  }
  const list = await getShelves();
  const target = list.find((s) => s.id === shelfId);
  if (!target) throw new Error('库存不存在');
  target.bluetoothMac = mac;
  if (name) target.bluetoothName = name;
  _shelvesCache = [...list];
  await saveData(SHELVES_KEY, _shelvesCache);
  return { mac, name: name || target.bluetoothName };
}

/**
 * 读取指定库存的蓝牙绑定
 * @param {string} shelfId
 * @returns {{mac:string, name:string} | null}
 */
export async function getShelfBluetooth(shelfId) {
  if (!shelfId) return null;
  const list = await getShelves();
  const target = list.find((s) => s.id === shelfId);
  if (!target) return null;
  if (!target.bluetoothMac) return null;
  return { mac: target.bluetoothMac, name: target.bluetoothName || '' };
}

/**
 * 清空内存缓存 (供外部在导入数据后调用, 强制重新加载)
 */
export function clearShelvesCache() {
  _shelvesCache = null;
  _currentShelfIdCache = null;
}

export default {
  getShelves,
  addShelf,
  renameShelf,
  deleteShelf,
  getCurrentShelfId,
  setCurrentShelfId,
  getCurrentShelf,
  getShelfDeviceCount,
  setShelfBluetooth,
  getShelfBluetooth,
  clearShelvesCache,
  subscribeShelves, // 命名导出, 同时挂到 default export, 让 ShelfService.subscribeShelves(cb) 可用
  notifyShelfChanged,
};
