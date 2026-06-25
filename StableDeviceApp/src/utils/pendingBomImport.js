/**
 * BOM 文件跨页面传递的 emitter + React hook
 *
 * 问题分析（之前所有方案都失败的原因）：
 *   - 旧版：模块级单例 + useFocusEffect
 *     → useFocusEffect 在"已 focus 的 tab"上不重跑（核心 bug）
 *     → React Navigation 6/7 中 navigate(target) 当 target === current 时不重 mount
 *   - 上一版：useNavigationState
 *     → 同样问题，target === current 时 state 不变，useEffect 不重跑
 *
 * 最终方案：emitter + React useState hook
 *   - 模块维护一个 _state 和 _listeners 数组
 *   - 提供 set(uri, name)：写入 _state 并通知所有订阅者
 *   - 提供 usePendingBomImport() hook：订阅 emitter，set 时触发 setVersion
 *     → BOMScreen re-render → useEffect 看到 pending → take() 处理
 *   - 不依赖 navigation state、不依赖 useFocusEffect、不依赖 module-level ref
 *   - 无论 BOMScreen 是否已 mount、是否已 focus，都能可靠工作
 *
 * 冷启动时序：
 *   1. App 启动 → handleIncomingUrl → 弹窗
 *   2. 用户点确定 → set() 触发，但 BOMScreen 还没 mount
 *   3. _state 保留数据
 *   4. navigate('BOM') → BOMScreen mount → usePendingBomImport() 注册
 *   5. 注册时检查 _state 有值 → 立即 setVersion → re-render → useEffect 跑 → take() 处理
 *
 * 热启动时序：
 *   1. App 在后台，BOMScreen 已 mount
 *   2. 微信分享 → 弹窗 → 用户点确定 → set()
 *   3. set() 通知订阅者 → BOMScreen re-render → useEffect 跑 → take() 处理
 *   4. navigate('BOM') 是 noop（已经在 BOM tab）
 */

import { useState, useEffect } from 'react';

let _state = {
  uri: null,
  fileName: null,
};

let _listeners = new Set();

const notify = () => {
  _listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      // ignore
    }
  });
};

export const set = (uri, fileName) => {
  _state = { uri, fileName: fileName || null };
  notify();
};

export const take = () => {
  const snapshot = _state.uri
    ? { uri: _state.uri, fileName: _state.fileName || 'imported_bom.xlsx' }
    : null;
  _state = { uri: null, fileName: null };
  return snapshot;
};

export const peek = () => {
  return _state.uri
    ? { uri: _state.uri, fileName: _state.fileName || 'imported_bom.xlsx' }
    : null;
};

export const clear = () => {
  _state = { uri: null, fileName: null };
  notify();
};

/**
 * React hook：订阅 pending BOM 导入事件
 * 每次 set() 触发时返回新的对象引用，组件 re-render
 * 拿到对象后用 take() 取出并清空
 */
export const usePendingBomImport = () => {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    _listeners.add(listener);
    // 兜底：订阅时如果 _state 有值，触发一次以确保组件拿到数据
    if (_state.uri) {
      listener();
    }
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  return peek();
};
