/**
 * 全局灯光事件发射器
 *
 * 问题背景:
 * - DeviceListScreen 和 BOMScreen 各自维护一份 litDeviceIds (本地 state)
 * - 用户在 BOM 页"清空"或切库时调了 controlAll: false (物理灭灯)
 * - 但 DeviceListScreen 的 litDeviceIds 不会跟着清, 切回去还会看到"亮着"的绿底
 * - 反之, DeviceListScreen 的"点亮全部"也只更新自己的 state, BOM 那边不知道
 *
 * 设计:
 * - 模块级 emitter + 简单 set 事件
 * - 提供 subscribeLightAllOff / emitLightAllOff (主要场景: 任何地方全灭灯)
 * - 提供 subscribeLightChange / emitLightChange (细粒度: 单个灯亮/灭)
 * - 任何页面都可以 emit, 任何页面都可以 subscribe
 *
 * 设计原则: 简单的"广播", 不做去重/防抖, 听众自己决定要不要处理
 *          不持久化, 纯运行时
 */

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

/**
 * 订阅所有灯光事件
 * @param {(event: {type: string, payload?: any}) => void} cb
 * @returns {() => void} unsubscribe
 */
export const subscribe = (cb) => {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
};

/**
 * 触发"全部灯熄灭"事件
 * 用途: 切库 / 清空 BOM / 断开蓝牙 / 任何需要全灭灯的场景
 *       听众应清空自己的 litDeviceIds
 */
export const emitLightAllOff = () => {
  _emit({ type: 'allOff' });
};

/**
 * 触发"单个灯状态变化"事件 (细粒度, 一般用于 B 页面同步 A 页面的单个灯操作)
 * @param {string} action - 'on' | 'off'
 * @param {number} lightId - 硬件位置
 * @param {number} deviceId - 器件 id (用于 litDeviceIds 同步)
 */
export const emitLightChange = (action, lightId, deviceId) => {
  _emit({ type: 'change', action, lightId, deviceId });
};
