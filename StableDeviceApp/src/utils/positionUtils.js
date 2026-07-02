/**
 * 位置工具函数
 *
 * 共享给 ScanScreen 和 NewDeviceScreen,用于"找指定库存上第一个空位置"
 *
 * 兼容老数据:
 *   老版本所有器件的 shelfId 都是 '1', 老调用方 (ScanScreen/NewDeviceScreen)
 *   默认传 '1', 行为与之前完全一致.
 */

const DEFAULT_SHELF = '1';
const DEFAULT_MAX = 90;

/**
 * 在给定的器件列表中,找到指定 shelfId 上第一个空位置
 * @param {Array} devices - 全部器件
 * @param {number|string} [shelfId='1'] - 库存 id
 * @param {number} [maxPosition=90] - 搜索范围上限(不包含)
 * @returns {string|null} 第一个空位置(字符串,与保存时一致),满架返回 null
 */
export const findFirstEmptyPosition = (
  devices,
  shelfId = DEFAULT_SHELF,
  maxPosition = DEFAULT_MAX
) => {
  if (!Array.isArray(devices)) return null;
  const occupied = new Set();
  devices.forEach((d) => {
    if (
      d.shelfId === shelfId &&
      d.location != null &&
      d.location !== ''
    ) {
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
 * 加载指定 shelfId 上所有已占用位置 -> Map<position, deviceName>
 * 用于在位置选择器中标记已占用格子
 * @param {Array} devices
 * @param {number|string} [shelfId='1'] - 库存 id
 * @returns {Map<number, string>}
 */
export const getOccupiedPositionMap = (
  devices,
  shelfId = DEFAULT_SHELF
) => {
  const occupied = new Map();
  if (!Array.isArray(devices)) return occupied;
  devices
    .filter(
      (d) =>
        d.shelfId === shelfId &&
        d.location != null &&
        d.location !== ''
    )
    .forEach((d) => {
      const pos = parseInt(d.location, 10);
      if (!isNaN(pos)) {
        occupied.set(pos, d.name || '未知');
      }
    });
  return occupied;
};
