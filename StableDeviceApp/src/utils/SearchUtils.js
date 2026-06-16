// 搜索工具函数
// 用于处理搜索相关的逻辑，如生成搜索建议等

/**
 * 生成搜索建议（普通搜索框）
 * @param {string} query - 搜索查询字符串
 * @param {Array} devices - 设备数据数组
 * @param {Array} searchHistory - 搜索历史数组
 * @param {number} limit - 建议数量限制
 * @returns {Array} 搜索建议数组
 * 注：搜索器件名称、器件编号、封装、分类
 */
export const generateSearchSuggestions = (
  query,
  devices,
  searchHistory,
  limit = 5
) => {
  if (!query || !query.trim()) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const suggestions = [];

  devices.forEach((device) => {
    if (
      device.name &&
      device.name.toLowerCase().includes(lowerQuery) &&
      !suggestions.includes(device.name)
    ) {
      suggestions.push(device.name);
    }
    if (
      device.supplierId &&
      device.supplierId.toLowerCase().includes(lowerQuery) &&
      !suggestions.includes(device.supplierId)
    ) {
      suggestions.push(device.supplierId);
    }
    if (
      device.package &&
      device.package.toLowerCase().includes(lowerQuery) &&
      !suggestions.includes(device.package)
    ) {
      suggestions.push(device.package);
    }
    if (
      device.category &&
      device.category.toLowerCase().includes(lowerQuery) &&
      !suggestions.includes(device.category)
    ) {
      suggestions.push(device.category);
    }
  });

  searchHistory.forEach((item) => {
    if (
      item &&
      item.toLowerCase().includes(lowerQuery) &&
      !suggestions.includes(item)
    ) {
      suggestions.push(item);
    }
  });

  return suggestions.slice(0, limit);
};

/**
 * 过滤设备列表（普通搜索框）
 * @param {Array} devices - 设备数据数组
 * @param {string} searchQuery - 搜索查询字符串
 * @param {string} selectedShelf - 选中的器件架ID
 * @returns {Array} 过滤后的设备数组
 * 注：搜索器件名称、器件编号、封装、分类
 */
export const filterDevices = (devices, searchQuery, selectedShelf) => {
  let filtered = devices;

  if (selectedShelf) {
    filtered = filtered.filter((device) => device.shelfId === selectedShelf);
  }

  if (searchQuery && searchQuery.trim() !== '') {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((device) => {
      return (
        (device.name && device.name.toLowerCase().includes(query)) ||
        (device.supplierId && device.supplierId.toLowerCase().includes(query)) ||
        (device.package && device.package.toLowerCase().includes(query)) ||
        (device.category && device.category.toLowerCase().includes(query))
      );
    });
  }

  return filtered;
};
