/**
 * 位置工具函数
 *
 * 共享给 ScanScreen 和 NewDeviceScreen,用于"找器件架第一个空位置"
 */

/**
 * 在给定的器件列表中,找到 shelfId='1' 上第一个空位置
 * @param {Array} devices - 全部器件
 * @param {number} [maxPosition=90] - 搜索范围上限(不包含),ScanScreen 默认 90,NewDeviceScreen 用 90 保持一致
 * @returns {string|null} 第一个空位置(字符串,与保存时一致),满架返回 null
 */
export const findFirstEmptyPosition = (devices, maxPosition = 90) => {
  if (!Array.isArray(devices)) return null;
  const occupied = new Set();
  devices.forEach((d) => {
    if (d.shelfId === '1' && d.location != null && d.location !== '') {
      occupied.add(String(d.location));
    }
  });
  for (let i = 0; i < maxPosition; i++) {
    if (!occupied.has(String(i))) {
      return String(i);
    }
  }
  return null;
};

/**
 * 加载 shelfId='1' 上所有已占用位置 -> Map<position, deviceName>
 * 用于在位置选择器中标记已占用格子
 * @param {Array} devices
 * @returns {Map<number, string>}
 */
export const getOccupiedPositionMap = (devices) => {
  const occupied = new Map();
  if (!Array.isArray(devices)) return occupied;
  devices
    .filter((d) => d.shelfId === '1' && d.location != null && d.location !== '')
    .forEach((d) => {
      const pos = parseInt(d.location, 10);
      if (!isNaN(pos)) {
        occupied.set(pos, d.name || '未知');
      }
    });
  return occupied;
};
