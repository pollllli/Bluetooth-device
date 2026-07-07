/**
 * 全局亮灯状态管理 (集中式)
 *
 * 之前问题:
 *   - DeviceListScreen 和 BOMScreen 各自维护一份 litDeviceIds (useReducer state)
 *   - BOM 切到 DeviceList 时, emitLightAllOff 事件偶尔不触发 / 触发晚于渲染,
 *     导致 DeviceList 的绿底还在 (UI/物理灯不同步)
 *   - 库存切库时也偶发绿底残留
 *
 * 设计:
 *   - 用模块级 Set 存储当前已亮灯的器件 id (一次亮灯加进去, 一次灭灯移除)
 *   - emit 同步触发所有 listener
 *   - 提供 getSnapshot() 让任何页面在 useFocusEffect 里同步拉一次最新值,
 *     避免 "emit 错过 → mount 时拿旧 state" 的竞态
 *   - 提供 clearAll() 一键清空 (切库/失焦)
 *
 * 原则: 单一权威源 + 事件广播 + mount 时主动拉取 (3 重保险)
 */

const _litDeviceIds = new Set();
const _listeners = new Set();

const _emit = (event) => {
  _listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (e) {
      // ignore - 单个 listener 出错不影响其他
    }
  });
};

export const subscribeLightStatus = (cb) => {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
};

/**
 * 取当前亮灯的器件 id 数组 (snapshot, 用于页面 mount/focus 时主动同步)
 */
export const getLitDeviceIdsSnapshot = () => {
  return Array.from(_litDeviceIds);
};

/**
 * 添加亮灯器件 (单灯位)
 */
export const addLitDevice = (deviceId) => {
  if (!deviceId) return;
  if (_litDeviceIds.has(deviceId)) return;
  _litDeviceIds.add(deviceId);
  _emit({ type: 'change', action: 'add', deviceId });
};

/**
 * 移除亮灯器件 (单灯位)
 */
export const removeLitDevice = (deviceId) => {
  if (!deviceId) return;
  if (!_litDeviceIds.has(deviceId)) return;
  _litDeviceIds.delete(deviceId);
  _emit({ type: 'change', action: 'remove', deviceId });
};

/**
 * 设置为指定数组 (替换全部)
 */
export const setLitDevices = (ids) => {
  const arr = Array.isArray(ids) ? ids : [];
  _litDeviceIds.clear();
  arr.forEach((id) => _litDeviceIds.add(id));
  _emit({ type: 'replace', ids: Array.from(_litDeviceIds) });
};

/**
 * 清空所有亮灯 (切库 / 失焦 / 导入新数据)
 */
export const clearAllLitDevices = () => {
  if (_litDeviceIds.size === 0) return;
  _litDeviceIds.clear();
  _emit({ type: 'allOff' });
};

/**
 * 兼容老 API (lightEvents.js 仍保留, 这里重新导出以便统一)
 */
export { subscribeLightStatus as subscribe };
