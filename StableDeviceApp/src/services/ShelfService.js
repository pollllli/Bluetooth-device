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
import { emitLightAllOff } from '../utils/lightEvents';
import { clearAllLitDevices } from '../utils/lightStatusStore';

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

// ========== 当前库存切换订阅 (用于 BOMScreen 自动清空导入的 BOM) ==========
const _currentShelfListeners = new Set();
function _emitCurrentShelfChange(id) {
  for (const cb of _currentShelfListeners) {
    try { cb(id); } catch (e) { /* ignore */ }
  }
}
/**
 * 订阅当前选中库存 id 的变化 (用户切库时触发)
 * 首次调用会立即用当前 id 触发一次 callback
 * @param {(id: string) => void} cb
 * @returns {() => void} 取消订阅
 */
export function subscribeCurrentShelf(cb) {  
  _currentShelfListeners.add(cb);
  getCurrentShelfId().then((id) => {
    if (_currentShelfListeners.has(cb)) cb(id);
  }).catch(() => {});
  return () => { _currentShelfListeners.delete(cb); };
}

/**
 * 外部直接通知当前库存变了 (用于绕过 ShelfService API 的写入路径)
 * @param {string} id - 新的当前库存 id
 */
export function notifyCurrentShelfChanged(id) {
  if (id) _emitCurrentShelfChange(id);
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

  // 1. 删除该库存下所有器件 (SQLite + AsyncStorage 双清, 见 StorageService.deleteDevicesByShelf)
  //    之前用 saveDevices(remainingDevices) 只清 AsyncStorage, SQLite 里的器件没删,
  //    导致"库存页已空, 库存首页还能看到器件"的鬼影 bug
  const { deletedCount: deletedDeviceCount } = await StorageService.deleteDevicesByShelf(id);

  // 2. 从库存列表里移除
  const next = list.filter((s) => s.id !== id);
  _shelvesCache = next;
  await saveData(SHELVES_KEY, next);
  _emitShelfChange(next);

  // 3. 如果删的是当前选中, 切到第一个
  //    【关键】next 可能为空 (用户删掉了最后一个库存), 此时不要调 setCurrentShelfId,
  //    否则 next[0]=undefined, setCurrentShelfId 内部 next[0].id 抛 TypeError
  //    修复前: 删最后一个库 → 弹 "Cannot read property 'id' of undefined"
  //    修复后: 删最后一个库 → 静默清掉 currentShelfId, 库存页显示 0 库存
  const current = await getCurrentShelfId();
  if (current === id) {
    if (next.length > 0) {
      await setCurrentShelfId(next[0].id);
    } else {
      // 0 库存: 清掉当前选中 (不传 id, 直接清)
      try { await removeData(CURRENT_SHELF_KEY); } catch (e) { /* ignore */ }
      _currentShelfIdCache = null;
    }
  }

  return { deletedDeviceCount, name: target.name };
}

/**
 * 同步读取当前选中库存 ID (仅返回 cache, 不会触发 AsyncStorage 读取)
 * 用于页面初始化时立即拿到值, 避免首次 render 用错默认值
 * @returns {string|null} cache 里的当前库存 ID, 没有就是 null
 */
export function getCurrentShelfIdSync() {
  return _currentShelfIdCache;
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
    // 【修复】AsyncStorage 不接受 null/undefined 作为 value
    // 之前 first=undefined 时 (0 库存场景), saveData 内部 JSON.stringify(undefined)=undefined,
    // AsyncStorage 内部 checkValidInput 拒绝, 抛 "Passing null/undefined as value is not supported"
    // → 弹 "上次运行出现错误"
    if (first == null) {
      // 0 库存时清掉旧记录, 等用户新建库存后下次 getCurrentShelfId 会写入
      await removeData(CURRENT_SHELF_KEY);
    } else {
      await saveData(CURRENT_SHELF_KEY, first);
    }
    return first;
  } catch (err) {
    logError('读取当前库存失败', err, 'ShelfService.getCurrentShelfId');
    const shelves = await getShelves();
    return shelves[0]?.id;
  }
}

/**
 * 设置当前选中的库存 ID
 *
 * 【切库即灭灯】 这里是切库的唯一入口, 不管用户当时停留在哪个页面,
 * 只要发生 setCurrentShelfId 就一定走这里, 物理上"全灭灯"必然会被执行。
 * 之前把这逻辑放在 BOMScreen 的 useEffect 里, 切库时如果用户不在 BOM 页
 * (更常见的情况: 在库存页或设置页切库), 那个 useEffect 已被 cleanup 释放,
 * 监听器不在线, controlAll: false 永远发不出去 → 灯残留。
 *
 * 顺序:
 *   1) 校验库存存在
 *   2) 写 AsyncStorage + 更新缓存
 *   3) 物理灭所有灯 (蓝牙在就发, 不在就跳过, 不阻塞切库主流程)
 *   4) emit 'currentShelfChange' (BOMScreen 等页面会自动清空自己的状态)
 */
export async function setCurrentShelfId(id) {
  const list = await getShelves();
  if (!list.some((s) => s.id === id)) {
    throw new Error('库存不存在');
  }
  const prev = _currentShelfIdCache;
  _currentShelfIdCache = id;
  await saveData(CURRENT_SHELF_KEY, id);

  // 【切库即灭灯】 物理上熄灭所有灯 — 不依赖任何页面, 只要蓝牙在就发
  // 必须放在 emit 之前, 这样订阅者收到的"旧 prev" = 真实的前一库存, 不会混乱
  if (prev !== id) {
    try {
      const conn = global.deviceConnection;
      const handler = conn && conn.handler;
      if (handler) {
        // 优先用 fastControlAll: 不等 ACK + 1.5s 超时, 不会卡住切库
        if (typeof handler.fastControlAll === 'function') {
          const r = await handler.fastControlAll(false);
          console.log('[ShelfService] 切库 fastControlAll 结果:', r && r.success ? 'OK' : ('FAIL ' + (r && r.reason)));
          if (!r || !r.success) {
            // 兜底: fastControlAll 失败时再试一次 sendCommand (有 ACK 但可能更可靠)
            try {
              await handler.sendCommand({ type: 'controlAll', state: false });
            } catch (e) {
              console.warn('[ShelfService] 兜底 sendCommand 也失败:', e?.message);
            }
          }
        } else if (typeof handler.sendCommand === 'function') {
          await handler.sendCommand({ type: 'controlAll', state: false });
          console.log('[ShelfService] 切库, 物理灭所有灯完成 (sendCommand)');
        }
      }
    } catch (e) {
      // 蓝牙断/超时/协议错 都不要阻塞切库 — 切库是更核心的流程
      console.warn('[ShelfService] 切库灭灯失败 (蓝牙可能已断, 不影响切库):', e?.message);
    }
    // 通知所有页面 (BOMScreen / DeviceListScreen 等) 清空自己的 litDeviceIds,
    // 否则库存首页的"已亮"绿底还显示着但物理灯已灭 — UI/物理不一致
    // 走 lightStatusStore 集中清空 + emit, 不依赖 listener 数量
    try { clearAllLitDevices(); } catch (e) { /* ignore */ }
  }

  // 通知订阅者 (BOMScreen 会监听并自动清空已导入的 BOM 等)
  if (prev !== id) {
    _emitCurrentShelfChange(id);
  }
}

/**
 * 清空当前导入的 BOM + 熄灭所有灯
 *
 * 用途: 任何"会改变库存/会触发现状废弃"的操作前, 都应调一下.
 *   - 切库(已在 setCurrentShelfId 内部处理)
 *   - 导入新库存数据 (ProfileScreen.handleImportData)
 *   - 外部 intent 触发导入 (App.tsx processIntent)
 *
 * 设计:
 *   - 物理灭灯: 走 controlAll: false 一帧, 与"熄灭所有"按钮同协议
 *   - UI 同步: emitLightAllOff → DeviceListScreen 清 litDeviceIds
 *   - BOM 清空: emit 'currentShelfChange'(可空) → BOMScreen 的 subscribeCurrentShelf
 *               会收到事件, 清空 components / search / positionModal
 *   - 失败兜底: try/catch 包裹, 任何一步失败不阻塞主流程
 */
export async function clearBomAndLights() {
  console.log('[ShelfService] clearBomAndLights: 物理灭灯 + UI 同步 + BOM 清空');
  try {
    const conn = global.deviceConnection;
    const handler = conn && conn.handler;
    if (handler) {
      if (typeof handler.fastControlAll === 'function') {
        const r = await handler.fastControlAll(false);
        if (!r || !r.success) {
          try { await handler.sendCommand({ type: 'controlAll', state: false }); } catch (e) { /* ignore */ }
        }
      } else if (typeof handler.sendCommand === 'function') {
        await handler.sendCommand({ type: 'controlAll', state: false });
      }
    }
  } catch (e) {
    console.warn('[ShelfService] clearBomAndLights 物理灭灯失败:', e?.message);
  }
  try { emitLightAllOff(); } catch (e) { /* ignore */ }
  // 通知 BOMScreen 清空本地 state (用 notifyCurrentShelfChanged, id 仍传当前)
  // BOMScreen 收到后会清空 components / litDeviceIds / 搜索词 / 位置选择器
  try {
    const cur = _currentShelfIdCache || await getCurrentShelfId().catch(() => null);
    if (cur) _emitCurrentShelfChange(cur);
  } catch (e) { /* ignore */ }
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
 * 统计指定库存下的器件数 (1.4 阶段 1: 走 SQL COUNT)
 * @param {string} id
 */
export async function getShelfDeviceCount(id) {
  if (!id) return 0;
  // 优先走 SQL, 失败/不可用时回退老逻辑
  try {
    const StorageService = require('./StorageService');
    if (StorageService && typeof StorageService.getShelfDeviceCount === 'function') {
      return await StorageService.getShelfDeviceCount(id);
    }
  } catch (e) {
    console.warn('[ShelfService] getShelfDeviceCount SQL 失败, 降级:', e?.message);
  }
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
  getCurrentShelfIdSync,
  setCurrentShelfId,
  getCurrentShelf,
  getShelfDeviceCount,
  setShelfBluetooth,
  getShelfBluetooth,
  clearShelvesCache,
  subscribeShelves, // 命名导出, 同时挂到 default export, 让 ShelfService.subscribeShelves(cb) 可用
  notifyShelfChanged,
  subscribeCurrentShelf, // 切库事件订阅 (BOMScreen 自动清空 BOM)
  notifyCurrentShelfChanged,
  clearBomAndLights, // 清空当前 BOM + 熄灭所有灯 (导入数据前调用)
};
