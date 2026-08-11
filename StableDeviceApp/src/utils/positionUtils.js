/**
 * 位置工具函数
 *
 * 共享给 ScanScreen 和 NewDeviceScreen,用于"找指定库存上第一个空位置"
 *
 * 兼容老数据:
 *   老版本所有器件的 shelfId 都是 '1', 老调用方 (ScanScreen/NewDeviceScreen)
 *   默认传 '1', 行为与之前完全一致.
 *
 * 设计上限 (DEFAULT_MAX = 300):
 *   - UI 上展示 0-299 共 300 个位置, 用户可选
 *   - 自动分配 (扫码/新建) 也在 0-299 范围
 *   - 这里只规定"软件层最多支持 300", 跟具体硬件无关
 *   - 用户实际能点亮几个位置 = 下位机能响应几个, 由用户操作时判断
 *     (选位置 → app 试亮 → 用户确认灯是否亮 → 决定存不存)
 *   之前 DEFAULT_MAX=90 / MAX_HARDWARE_LIGHTS=90 都是历史遗留, 跟硬件无关
 */

const DEFAULT_SHELF = '1';
// 单库存最大位置数 (设计上限). 改这里一处, 扫码/新建自动分配 + 位置选择器 UI 都跟随.
const DEFAULT_MAX = 300;

/**
 * 在给定的器件列表中,找到指定 shelfId 上第一个空位置
 * @param {Array} devices - 全部器件
 * @param {number|string} [shelfId='1'] - 库存 id
 * @param {number} [maxPosition=300] - 搜索范围上限(不包含)
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

// 位置硬件支持判断已移除 — 由用户在选位置时实际试亮确认, 不在代码里硬编码.
// 这样不用每次换硬件都改代码.
