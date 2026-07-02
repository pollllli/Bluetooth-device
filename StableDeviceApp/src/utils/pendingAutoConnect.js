/**
 * 待执行的连接动作
 *
 * 场景: 数据导入成功后, 用户期望"跳到库存首页"而不是停在连接页
 * 但如果当前库存有绑定蓝牙, 仍然要自动连上
 *
 * 流程:
 * 1. ProfileScreen.handleImportData 导入成功 → setPendingAutoConnect(mac, name)
 * 2. navigation.reset 跳到 MainTabs → DeviceListTab (库存首页)
 * 3. DeviceListScreen mount / focus → consumePendingAutoConnect() → navigation.navigate('Connection', {autoConnectMac, ...})
 * 4. ConnectionScreen 收到 autoConnectMac → 走自动连分支
 *
 * 关键: 这是模块级单例, 不会因为 ProfileScreen 卸载而丢失
 *      consume 后会清空, 防止下次进入库存页时重复触发
 */

let _pendingMac = null;
let _pendingName = null;

export function setPendingAutoConnect(mac, name) {
  _pendingMac = mac || null;
  _pendingName = name || null;
  console.log('[pendingAutoConnect] set:', _pendingMac, _pendingName);
}

export function consumePendingAutoConnect() {
  const result = { mac: _pendingMac, name: _pendingName };
  _pendingMac = null;
  _pendingName = null;
  if (result.mac) {
    console.log('[pendingAutoConnect] consume:', result.mac, result.name);
  }
  return result;
}

export function peekPendingAutoConnect() {
  return { mac: _pendingMac, name: _pendingName };
}

export function clearPendingAutoConnect() {
  _pendingMac = null;
  _pendingName = null;
}
