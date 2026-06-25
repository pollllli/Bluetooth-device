/**
 * 存储服务模块
 * 提供统一的数据存储管理功能，包括器件、用户、BOM等数据的增删改查
 * 支持内存缓存机制，提高读取性能
 */

import {
  saveData,
  getData,
  removeData,
  batchGetData,
  batchSaveData,
  clearAllData,
} from '../utils/StorageUtils';
import { logError, handleAsyncError } from '../utils/ErrorHandler';
import { getCategories as getEffectiveCategories } from './DeviceCategoryService';

/**
 * CSV行解析函数
 * 支持带引号的字段（处理字段中包含逗号的情况）
 * @param {string} line - CSV行内容
 * @returns {Array<string>} 解析后的字段数组
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    // 处理引号（用于包含逗号的字段）
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // 遇到逗号且不在引号内，作为字段分隔符
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * 存储服务类
 * 提供统一的数据存储和缓存管理功能
 */
class StorageService {
  /**
   * 内存缓存（私有静态成员）
   */
  static #cache = new Map();

  /**
   * 缓存有效期（5分钟）
   */
  static #cacheTTL = 5 * 60 * 1000;

  /**
   * 缓存时间戳映射
   */
  static #cacheTimestamps = new Map();

  /**
   * 从缓存获取数据
   * @param {string} key - 缓存键名
   * @returns {*|undefined} 缓存数据，如果过期或不存在返回undefined
   */
  static #getFromCache(key) {
    const timestamp = this.#cacheTimestamps.get(key);
    // 检查缓存是否有效（未过期）
    if (timestamp && Date.now() - timestamp < this.#cacheTTL) {
      return this.#cache.get(key);
    }
    // 缓存过期，移除缓存
    this.#cache.delete(key);
    this.#cacheTimestamps.delete(key);
    return undefined;
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键名
   * @param {*} value - 缓存值
   */
  static #setToCache(key, value) {
    this.#cache.set(key, value);
    this.#cacheTimestamps.set(key, Date.now());
  }

  /**
   * 清除缓存
   * @param {string} [key] - 要清除的缓存键名，不传则清除所有缓存
   */
  static #clearCache(key) {
    if (key) {
      this.#cache.delete(key);
      this.#cacheTimestamps.delete(key);
    } else {
      this.#cache.clear();
      this.#cacheTimestamps.clear();
    }
  }

  /**
   * 获取所有器件数据
   * @returns {Promise<Array>} 器件数据数组
   */
  static async getDevices() {
    try {
      // 先从缓存获取
      const cached = this.#getFromCache('devices');
      if (cached) return cached;

      // 从持久化存储获取
      let devices = await getData('devices', []);

      // 修复已存在的无效 id（NaN、字符串等）
      const existingIds = devices.map((d) =>
        typeof d.id === 'number' && !isNaN(d.id) ? d.id : 0
      );
      let maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;

      let needsSave = false;
      devices = devices.map((device) => {
        if (typeof device.id !== 'number' || isNaN(device.id)) {
          maxId++;
          needsSave = true;
          return { ...device, id: maxId };
        }
        return device;
      });

      // 如果修复了数据，保存修复后的数据
      if (needsSave) {
        await saveData('devices', devices);
      }

      // 更新缓存
      this.#setToCache('devices', devices);
      return devices;
    } catch (error) {
      logError('获取设备数据失败', error, 'StorageService.getDevices');
      return [];
    }
  }

  /**
   * 保存器件数据
   * @param {Array} devices - 器件数据数组
   * @returns {Promise<void>}
   */
  static async saveDevices(devices) {
    try {
      await saveData('devices', devices);
      this.#setToCache('devices', devices);
    } catch (error) {
      logError('保存设备数据失败', error, 'StorageService.saveDevices');
      throw error;
    }
  }

  /**
   * 添加新器件
   * @param {Object} device - 器件数据
   * @param {string} device.id - 器件编号（可选，不填则自动生成）
   * @param {string} device.name - 器件名称（必填）
   * @returns {Promise<Object>} 添加的器件数据（包含自动生成的ID和时间戳）
   * @throws {Error} 如果器件编号已存在
   */
  static async addDevice(device) {
    try {
      const devices = await this.getDevices();

      if (device.location != null && device.location !== '' && device.shelfId === '1') {
        const conflict = devices.find(
          (d) => d.location === device.location && d.shelfId === '1'
        );
        if (conflict) {
          throw new Error(
            `位置 "${device.location}" 与已有器件 "${conflict.name}" 冲突`
          );
        }
      }

      const existingIds = devices.map((d) =>
        typeof d.id === 'number' && !isNaN(d.id) ? d.id : 0
      );
      const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
      const newId =
        device.id && typeof device.id === 'number' && !isNaN(device.id)
          ? device.id
          : maxId + 1;

      const newDevice = {
        ...device,
        id: newId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 【自动归类】若器件没有 category，或 category 不在分类树里，尝试智能匹配
      // 让用户能通过左上角"全部器件 ▼"下拉里的子类目准确筛选到
      try {
        const { autoClassifyDevice, isCategoryInTree } = await import(
          './DeviceCategoryService'
        );
        const needClassify =
          !newDevice.category || !(await isCategoryInTree(newDevice.category));
        if (needClassify) {
          const classification = await autoClassifyDevice(newDevice);
          if (classification) {
            newDevice.category = classification.sub;
            newDevice.bigCategory = classification.big;
            console.log(
              `[addDevice] 自动归类: ${classification.sub} (${classification.source})`
            );
          }
        }
      } catch (clsErr) {
        console.warn('[addDevice] 自动归类失败，不影响器件保存:', clsErr);
      }

      devices.push(newDevice);
      await this.saveDevices(devices);
      return newDevice;
    } catch (error) {
      logError('添加设备失败', error, 'StorageService.addDevice');
      throw error;
    }
  }

  /**
   * 更新器件数据
   * @param {Object} updatedDevice - 更新后的器件数据（必须包含id）
   * @returns {Promise<Object|null>} 更新后的器件数据，未找到返回null
   */
  static async updateDevice(updatedDevice) {
    try {
      const devices = await this.getDevices();

      if (updatedDevice.location != null && updatedDevice.location !== '' && updatedDevice.shelfId === '1') {
        const conflict = devices.find(
          (d) =>
            d.location === updatedDevice.location &&
            d.shelfId === '1' &&
            d.id !== updatedDevice.id
        );
        if (conflict) {
          throw new Error(
            `位置 "${updatedDevice.location}" 与已有器件 "${conflict.name}" 冲突`
          );
        }
      }

      const index = devices.findIndex((d) => d.id === updatedDevice.id);
      if (index !== -1) {
        const updated = {
          ...updatedDevice,
          updatedAt: new Date().toISOString(),
        };
        devices[index] = updated;
        await this.saveDevices(devices);
        return updated;
      }
      return null;
    } catch (error) {
      logError('更新设备失败', error, 'StorageService.updateDevice');
      throw error;
    }
  }

  /**
   * 删除器件
   * @param {number} deviceId - 器件ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  static async deleteDevice(deviceId) {
    try {
      const devices = await this.getDevices();
      const updatedDevices = devices.filter((d) => d.id !== deviceId);
      await this.saveDevices(updatedDevices);
      return true;
    } catch (error) {
      logError('删除设备失败', error, 'StorageService.deleteDevice');
      throw error;
    }
  }

  /**
   * 根据ID获取器件
   * @param {number} deviceId - 器件ID
   * @returns {Promise<Object|null>} 器件数据，未找到返回null
   */
  static async getDeviceById(deviceId) {
    try {
      const devices = await this.getDevices();
      return devices.find((d) => d.id === deviceId) || null;
    } catch (error) {
      logError('根据ID获取设备失败', error, 'StorageService.getDeviceById');
      return null;
    }
  }

  /**
   * 保存上次连接的蓝牙设备信息
   * @param {Object} deviceInfo - 设备信息对象
   * @param {string} deviceInfo.deviceId - 设备ID
   * @param {string} deviceInfo.deviceName - 设备名称
   * @returns {Promise<void>}
   */
  static async saveLastConnectedDevice(deviceInfo) {
    try {
      await saveData('lastConnectedDevice', deviceInfo);
      this.#setToCache('lastConnectedDevice', deviceInfo);
      console.log('蓝牙设备连接信息已保存:', deviceInfo);
    } catch (error) {
      logError('保存蓝牙设备连接信息失败', error, 'StorageService.saveLastConnectedDevice');
      throw error;
    }
  }

  /**
   * 获取上次连接的蓝牙设备信息
   * @returns {Promise<Object|null>} 设备信息对象，未找到返回null
   */
  static async getLastConnectedDevice() {
    try {
      const cached = this.#getFromCache('lastConnectedDevice');
      if (cached) return cached;

      const deviceInfo = await getData('lastConnectedDevice', null);
      if (deviceInfo) {
        this.#setToCache('lastConnectedDevice', deviceInfo);
      }
      return deviceInfo;
    } catch (error) {
      logError('获取蓝牙设备连接信息失败', error, 'StorageService.getLastConnectedDevice');
      return null;
    }
  }

  /**
   * 清除上次连接的蓝牙设备信息
   * @returns {Promise<void>}
   */
  static async clearLastConnectedDevice() {
    try {
      await removeData('lastConnectedDevice');
      this.#cache.delete('lastConnectedDevice');
      console.log('蓝牙设备连接信息已清除');
    } catch (error) {
      logError('清除蓝牙设备连接信息失败', error, 'StorageService.clearLastConnectedDevice');
      throw error;
    }
  }

  /**
   * 获取搜索历史
   * @param {number} [limit=10] - 限制数量
   * @returns {Promise<Array>} 搜索历史数组
   */
  static async getSearchHistory(limit = 10) {
    try {
      const cached = this.#getFromCache('searchHistory');
      if (cached) return cached.slice(0, limit);

      const history = await getData('searchHistory', []);
      const limitedHistory = history.slice(0, limit);
      this.#setToCache('searchHistory', limitedHistory);
      return limitedHistory;
    } catch (error) {
      logError('获取搜索历史失败', error, 'StorageService.getSearchHistory');
      return [];
    }
  }

  /**
   * 添加搜索历史
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<void>}
   */
  static async addSearchHistory(keyword) {
    try {
      // 验证关键词
      if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
        return;
      }

      const history = await this.getSearchHistory(100);
      const trimmedKeyword = keyword.trim();

      // 移除重复项
      const filteredHistory = history.filter((item) => item !== trimmedKeyword);
      // 添加到开头，保持最新的在前面
      const newHistory = [trimmedKeyword, ...filteredHistory].slice(0, 10);

      await this.saveSearchHistory(newHistory);
    } catch (error) {
      logError('添加搜索历史失败', error, 'StorageService.addSearchHistory');
    }
  }

  /**
   * 保存搜索历史
   * @param {Array} history - 搜索历史数组
   * @returns {Promise<void>}
   */
  static async saveSearchHistory(history) {
    try {
      await saveData('searchHistory', history);
      this.#setToCache('searchHistory', history);
    } catch (error) {
      logError('保存搜索历史失败', error, 'StorageService.saveSearchHistory');
      throw error;
    }
  }

  /**
   * 清除搜索历史
   * @returns {Promise<void>}
   */
  static async clearSearchHistory() {
    try {
      await removeData('searchHistory');
      this.#clearCache('searchHistory');
    } catch (error) {
      logError('清除搜索历史失败', error, 'StorageService.clearSearchHistory');
      throw error;
    }
  }

  /**
   * 获取表单状态
   * @returns {Promise<Object>} 表单状态对象
   */
  static async getFormState() {
    try {
      const cached = this.#getFromCache('formState');
      if (cached) return cached;

      const formState = await getData('formState', {});
      this.#setToCache('formState', formState);
      return formState;
    } catch (error) {
      logError('获取表单状态失败', error, 'StorageService.getFormState');
      return {};
    }
  }

  /**
   * 重命名某大分类后，同步所有引用了该大分类的器件
   * 让器件的 bigCategory / category 字段跟随最新的类目名称
   * @param {string} oldBig
   * @param {string} newBig
   * @returns {Promise<{updated: number}>}
   */
  static async renameBigCategoryInDevices(oldBig, newBig) {
    try {
      if (!oldBig || !newBig || oldBig === newBig) return { updated: 0 };
      const devices = await this.getDevices();
      let updated = 0;
      const now = new Date().toISOString();
      const next = devices.map((d) => {
        if (!d || d.bigCategory !== oldBig) return d;
        updated++;
        return { ...d, bigCategory: newBig, updatedAt: now };
      });
      if (updated > 0) await this.saveDevices(next);
      return { updated };
    } catch (error) {
      logError('同步器件大分类失败', error, 'StorageService.renameBigCategoryInDevices');
      return { updated: 0 };
    }
  }

  /**
   * 重命名某子类目后，同步所有引用了该子类目的器件
   * @param {string} oldSub
   * @param {string} newSub
   * @returns {Promise<{updated: number}>}
   */
  static async renameSubCategoryInDevices(oldSub, newSub) {
    try {
      if (!oldSub || !newSub || oldSub === newSub) return { updated: 0 };
      const devices = await this.getDevices();
      let updated = 0;
      const now = new Date().toISOString();
      const next = devices.map((d) => {
        if (!d || d.category !== oldSub) return d;
        updated++;
        return { ...d, category: newSub, updatedAt: now };
      });
      if (updated > 0) await this.saveDevices(next);
      return { updated };
    } catch (error) {
      logError('同步器件子类目失败', error, 'StorageService.renameSubCategoryInDevices');
      return { updated: 0 };
    }
  }

  /**
   * 删除某大分类后，清空引用该大分类的器件类目字段
   * @param {string} big
   * @returns {Promise<{updated: number}>}
   */
  static async deleteBigCategoryInDevices(big) {
    try {
      if (!big) return { updated: 0 };
      const devices = await this.getDevices();
      let updated = 0;
      const now = new Date().toISOString();
      const next = devices.map((d) => {
        if (!d || d.bigCategory !== big) return d;
        updated++;
        return { ...d, bigCategory: '', category: '', updatedAt: now };
      });
      if (updated > 0) await this.saveDevices(next);
      return { updated };
    } catch (error) {
      logError('清空器件大分类失败', error, 'StorageService.deleteBigCategoryInDevices');
      return { updated: 0 };
    }
  }

  /**
   * 删除某子类目后，清空引用该子类目的器件 category 字段
   * （bigCategory 保留 —— 大类本身未变，只是少了一个子项）
   * @param {string} sub
   * @returns {Promise<{updated: number}>}
   */
  static async deleteSubCategoryInDevices(sub) {
    try {
      if (!sub) return { updated: 0 };
      const devices = await this.getDevices();
      let updated = 0;
      const now = new Date().toISOString();
      const next = devices.map((d) => {
        if (!d || d.category !== sub) return d;
        updated++;
        return { ...d, category: '', updatedAt: now };
      });
      if (updated > 0) await this.saveDevices(next);
      return { updated };
    } catch (error) {
      logError('清空器件子类目失败', error, 'StorageService.deleteSubCategoryInDevices');
      return { updated: 0 };
    }
  }

  /**
   * 保存表单状态
   * @param {Object} formState - 表单状态对象
   * @returns {Promise<void>}
   */
  static async saveFormState(formState) {
    try {
      await saveData('formState', formState);
      this.#setToCache('formState', formState);
    } catch (error) {
      logError('保存表单状态失败', error, 'StorageService.saveFormState');
      throw error;
    }
  }

  /**
   * 批量获取数据
   * @param {Array<string>} keys - 存储键名数组
   * @returns {Promise<Object>} 键值对对象
   */
  static async batchGet(keys) {
    try {
      // 先从缓存获取
      const cachedData = {};
      const keysToFetch = [];

      for (const key of keys) {
        const cached = this.#getFromCache(key);
        if (cached) {
          cachedData[key] = cached;
        } else {
          keysToFetch.push(key);
        }
      }

      // 从存储获取剩余的
      if (keysToFetch.length > 0) {
        const fetchedData = await batchGetData(keysToFetch);
        // 更新缓存
        for (const [key, value] of Object.entries(fetchedData)) {
          if (value !== undefined) {
            this.#setToCache(key, value);
          }
        }
        return { ...cachedData, ...fetchedData };
      }

      return cachedData;
    } catch (error) {
      logError('批量获取数据失败', error, 'StorageService.batchGet');
      return {};
    }
  }

  /**
   * 批量保存数据
   * @param {Object} keyValuePairs - 键值对对象
   * @returns {Promise<void>}
   */
  static async batchSet(keyValuePairs) {
    try {
      await batchSaveData(keyValuePairs);
      // 更新缓存
      for (const [key, value] of Object.entries(keyValuePairs)) {
        this.#setToCache(key, value);
      }
    } catch (error) {
      logError('批量保存数据失败', error, 'StorageService.batchSet');
      throw error;
    }
  }

  /**
   * 清除所有数据
   * @returns {Promise<void>}
   */
  static async clearAll() {
    try {
      await clearAllData();
      this.#clearCache();
    } catch (error) {
      logError('清除所有数据失败', error, 'StorageService.clearAll');
      throw error;
    }
  }

  /**
   * 保存登录用户信息
   * @param {Object} user - 用户信息
   * @returns {Promise<void>}
   */
  static async saveLoggedInUser(user) {
    try {
      await saveData('loggedInUser', user);
      this.#setToCache('loggedInUser', user);
    } catch (error) {
      logError(
        '保存登录用户信息失败',
        error,
        'StorageService.saveLoggedInUser'
      );
      throw error;
    }
  }

  /**
   * 获取登录用户信息
   * @returns {Promise<Object|null>} 用户信息，未登录返回null
   */
  static async getLoggedInUser() {
    try {
      let cached = this.#getFromCache('loggedInUser');

      if (!cached) {
        cached = await getData('loggedInUser', null);
      }

      if (!cached) return null;

      // 修复用户权限（确保admin是管理员，user是普通用户）
      let needFix = false;
      let fixedUser = cached;

      if (cached.username === 'admin' && cached.isAdmin !== true) {
        needFix = true;
        fixedUser = { ...cached, isAdmin: true };
      } else if (cached.username === 'user' && cached.isAdmin !== false) {
        needFix = true;
        fixedUser = { ...cached, isAdmin: false };
      }

      if (needFix) {
        await this.saveLoggedInUser(fixedUser);
        return fixedUser;
      }

      this.#setToCache('loggedInUser', cached);
      return cached;
    } catch (error) {
      logError('获取登录用户信息失败', error, 'StorageService.getLoggedInUser');
      return null;
    }
  }

  /**
   * 获取所有BOM数据
   * @returns {Promise<Array>} BOM数据数组
   */
  static async getBOMs() {
    try {
      const cached = this.#getFromCache('boms');
      if (cached) return cached;

      const boms = await getData('boms', []);
      this.#setToCache('boms', boms);
      return boms;
    } catch (error) {
      logError('获取BOM数据失败', error, 'StorageService.getBOMs');
      return [];
    }
  }

  /**
   * 保存BOM数据
   * @param {Array} boms - BOM数据数组
   * @returns {Promise<void>}
   */
  static async saveBOMs(boms) {
    try {
      await saveData('boms', boms);
      this.#setToCache('boms', boms);
    } catch (error) {
      logError('保存BOM数据失败', error, 'StorageService.saveBOMs');
      throw error;
    }
  }

  /**
   * 添加新BOM
   * @param {Object} bom - BOM数据
   * @returns {Promise<Object>} 添加的BOM数据（包含自动生成的ID和时间戳）
   */
  static async addBOM(bom) {
    try {
      const boms = await this.getBOMs();
      const newBOM = {
        ...bom,
        id: boms.length > 0 ? Math.max(...boms.map((b) => b.id)) + 1 : 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      boms.push(newBOM);
      await this.saveBOMs(boms);
      return newBOM;
    } catch (error) {
      logError('添加BOM失败', error, 'StorageService.addBOM');
      throw error;
    }
  }

  /**
   * 更新BOM数据
   * @param {Object} updatedBOM - 更新后的BOM数据（必须包含id）
   * @returns {Promise<boolean>} 是否更新成功
   */
  static async updateBOM(updatedBOM) {
    try {
      const boms = await this.getBOMs();
      const index = boms.findIndex((b) => b.id === updatedBOM.id);
      if (index !== -1) {
        boms[index] = {
          ...updatedBOM,
          updatedAt: new Date().toISOString(),
        };
        await this.saveBOMs(boms);
        return true;
      }
      return false;
    } catch (error) {
      logError('更新BOM失败', error, 'StorageService.updateBOM');
      throw error;
    }
  }

  /**
   * 删除BOM
   * @param {number} bomId - BOM ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  static async deleteBOM(bomId) {
    try {
      const boms = await this.getBOMs();
      const updatedBoms = boms.filter((b) => b.id !== bomId);
      await this.saveBOMs(updatedBoms);
      return true;
    } catch (error) {
      logError('删除BOM失败', error, 'StorageService.deleteBOM');
      throw error;
    }
  }

  /**
   * 根据ID获取BOM
   * @param {number} bomId - BOM ID
   * @returns {Promise<Object|null>} BOM数据，未找到返回null
   */
  static async getBOMById(bomId) {
    try {
      const boms = await this.getBOMs();
      return boms.find((b) => b.id === bomId) || null;
    } catch (error) {
      logError('根据ID获取BOM失败', error, 'StorageService.getBOMById');
      return null;
    }
  }

  /**
   * 获取自定义类目数据
   * 首次加载时返回 null（表示使用默认类目）
   * @returns {Promise<Array|null>} 自定义类目数组，未设置返回 null
   */
  static async getCategories() {
    try {
      const cached = this.#getFromCache('categories');
      if (cached) return cached;
      const categories = await getData('categories', null);
      if (categories) {
        this.#setToCache('categories', categories);
      }
      return categories;
    } catch (error) {
      logError('获取类目数据失败', error, 'StorageService.getCategories');
      return null;
    }
  }

  /**
   * 保存自定义类目数据
   * @param {Array} categories - 类目数据
   * @returns {Promise<void>}
   */
  static async saveCategories(categories) {
    try {
      await saveData('categories', categories);
      this.#setToCache('categories', categories);
    } catch (error) {
      logError('保存类目数据失败', error, 'StorageService.saveCategories');
      throw error;
    }
  }

  /**
   * 导出所有数据
   * @returns {Promise<Object>} 包含所有数据的备份对象
   */
  static async exportAllData() {
    try {
      const keys = ['devices', 'users', 'boms', 'searchHistory', 'formState'];
      const data = await this.batchGet(keys);

      // 始终导出当前生效的类目（包括默认类目），保证另一台手机
      // 导入后类目与本机完全一致，无需重新增删
      try {
        const effectiveCategories = await getEffectiveCategories();
        data.categories = effectiveCategories;
      } catch (catErr) {
        logError('导出类目失败，使用默认类目', catErr, 'StorageService.exportAllData');
        data.categories = null;
      }

      // 统计各数据条数，便于展示给用户
      const summary = {
        deviceCount: Array.isArray(data.devices) ? data.devices.length : 0,
        userCount: Array.isArray(data.users) ? data.users.length : 0,
        bomCount: Array.isArray(data.boms) ? data.boms.length : 0,
        searchHistoryCount: Array.isArray(data.searchHistory) ? data.searchHistory.length : 0,
        categoryCount: Array.isArray(data.categories) ? data.categories.length : 0,
        subCategoryCount: Array.isArray(data.categories)
          ? data.categories.reduce((sum, c) => sum + (Array.isArray(c.subCategories) ? c.subCategories.length : 0), 0)
          : 0,
        isCustomCategories: await (async () => {
          try {
            const stored = await this.getCategories();
            return Array.isArray(stored) && stored.length > 0;
          } catch {
            return false;
          }
        })(),
      };

      return {
        data,
        summary,
        exportDate: new Date().toISOString(),
        version: '1.1.0',
        appVersion: '1.0.0',
      };
    } catch (error) {
      logError('导出数据失败', error, 'StorageService.exportAllData');
      throw error;
    }
  }

  /**
   * 导入备份数据
   * @param {Object} backupData - 备份数据对象
   * @param {Object} backupData.data - 要导入的数据
   * @param {string} [backupData.version] - 备份版本
   * @returns {Promise<boolean>} 是否导入成功
   * @throws {Error} 如果备份数据无效或版本不兼容
   */
  static async importAllData(backupData) {
    try {
      if (!backupData || !backupData.data) {
        throw new Error('无效的备份数据');
      }

      // 验证备份数据版本（兼容 1.0.0 / 1.1.0）
      const version = backupData.version || '1.0.0';
      const supportedVersions = ['1.0.0', '1.1.0'];
      if (!supportedVersions.includes(version)) {
        throw new Error('备份数据版本不兼容');
      }

      // 1.0.0 没有 categories 字段，若用户已在另一台手机上自定义过类目，
      // 导入后那台手机的本地类目不会被覆盖（保持本地原有类目）
      // 1.1.0 始终包含 categories 字段，会完整覆盖

      // 批量保存数据
      await this.batchSet(backupData.data);
      return true;
    } catch (error) {
      logError('导入数据失败', error, 'StorageService.importAllData');
      throw error;
    }
  }

  /**
   * 从CSV文件批量导入器件数据
   * @param {string} csvContent - CSV文件内容
   * @returns {Promise<Object>} 导入结果
   * @returns {boolean} success - 是否成功
   * @returns {number} imported - 成功导入数量
   * @returns {Array<string>} errors - 错误信息列表
   * @returns {number} total - 总行数
   */
  static async importDevicesFromCSV(csvContent) {
    try {
      const devices = await this.getDevices();
      const newDevices = [];
      const errors = [];

      // 中文列名映射（支持多种列名）
      const columnMapping = {
        器件名称: 'name',
        名称: 'name',
        器件编号: 'supplierId',
        编号: 'supplierId',
        供应商编号: 'supplierId',
        封装: 'package',
        位号: 'position',
        备注: 'notes',
        值: 'value',
        数量: 'quantity',
        型号: 'name',
        功能: 'function',
        分类: 'category',
        类别: 'category',
        类目: 'category',
        制造商: 'manufacturer',
        供应商: 'supplier',
        价格: 'price',
        物理位置: 'location',
        位置: 'location',
        物理序号: 'location',
        位置序号: 'location',
        datasheet: 'datasheet',
      };

      // 解析CSV内容
      const lines = csvContent.split('\n');
      const headers = parseCSVLine(lines[0]).map((header) => header.trim());

      // 逐行解析
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // 跳过空行

        const values = parseCSVLine(line);
        const device = {};

        // 映射列名到字段
        headers.forEach((header, index) => {
          let mappedField = header.toLowerCase();

          // 查找中文列名映射
          for (const [chineseName, englishName] of Object.entries(
            columnMapping
          )) {
            if (
              header === chineseName ||
              header.toLowerCase() === chineseName.toLowerCase()
            ) {
              mappedField = englishName;
              break;
            }
          }

          device[mappedField] = (values[index] || '').trim();
        });

        // 验证：只要任意字段有数据就导入（允许名称/编号为空，导入后显示为 null）；
        // 仅当整行所有字段都为空时视为空行跳过
        const hasAnyData =
          device.name ||
          device.supplierId ||
          device.package ||
          device.position ||
          device.notes ||
          device.category ||
          device.value ||
          device.quantity ||
          device.location ||
          device.manufacturer ||
          device.supplier ||
          device.price ||
          device.datasheet ||
          device.function;
        if (!hasAnyData) {
          continue; // 跳过完全空白的行
        }

        // 如果name为空但有中文名称，使用中文名称
        if (!device.name && device['器件名称']) {
          device.name = device['器件名称'];
        }

        // 如果没有设置supplierId，但有id，将id也赋值给supplierId
        if (!device.supplierId && device.id) {
          device.supplierId = device.id;
        }

        // 自动根据"值"字段填入对应的电气参数字段（支持复合值如 "10uf/50V"）
        if (device.value) {
          const parts = device.value.trim().split(/[/,，\s]+/).filter(p => p.trim());
          for (const part of parts) {
            const v = part.trim();
            if (/^\d+\.?\d*\s*[kKMmμuGg]?\s*[ΩΩRr]$/i.test(v) || /^\d+\.?\d*\s*[kKMmμuGg]?\s*ohm$/i.test(v)) {
              device.resistance = v;
            } else if (/^\d+\.?\d*\s*[kKMmGgT]?\s*[Hh]z$/i.test(v)) {
              device.frequency = v;
            } else if (/^\d+\.?\d*\s*[pPnNμuUmM]?\s*[Ff]$/i.test(v)) {
              device.capacitance = v;
            } else if (/^\d+\.?\d*\s*[nNμuUmM]?\s*[Hh]$/i.test(v)) {
              device.inductance = v;
            } else if (/^\d+\.?\d*\s*[mMkK]?\s*[Vv]$/i.test(v)) {
              device.voltage = v;
            } else if (/^\d+\.?\d*\s*[nNμuUmMkK]?\s*[Aa]$/i.test(v)) {
              device.current = v;
            } else if (/^\d+\.?\d*\s*[mMkK]?\s*[Ww]$/i.test(v)) {
              device.power = v;
            }
          }
        }

        // 全部默认放在器件架（一）
        device.shelfId = '1';

        // 移除不需要的字段
        delete device.shelfid;

        newDevices.push(device);
      }

      // 检查位置冲突
      const locationMap = {};
      const existingDevices = await this.getDevices();
      for (const ed of existingDevices) {
        if (ed.location != null && ed.location !== '' && ed.shelfId === '1') {
          locationMap[ed.location] = ed.name;
        }
      }

      // 为没有location的器件自动分配空位置
      for (const device of newDevices) {
        if (device.location == null || device.location === '') {
          for (let pos = 0; pos < 90; pos++) {
            const posStr = String(pos);
            if (!locationMap[posStr]) {
              device.location = posStr;
              locationMap[posStr] = device.name;
              break;
            }
          }
        }
      }

      // 检查有location的器件是否冲突
      for (const device of newDevices) {
        if (device.location != null && device.location !== '') {
          if (locationMap[device.location] && locationMap[device.location] !== device.name) {
            errors.push(
              `第 ${newDevices.indexOf(device) + 2} 行: 位置 "${device.location}" 与已有器件 "${locationMap[device.location]}" 冲突`
            );
          } else {
            locationMap[device.location] = device.name;
          }
        }
      }

      // 批量添加新器件（跳过有位置冲突的器件）
      for (const device of newDevices) {
        const hasConflict =
          device.location != null && device.location !== '' &&
          errors.some((e) =>
            e.includes(`位置 "${device.location}" 与已有器件`)
          );
        if (!hasConflict) {
          await this.addDevice(device);
        }
      }

      const importedCount = newDevices.filter((device) => {
        const hasConflict =
          device.location != null && device.location !== '' &&
          errors.some((e) =>
            e.includes(`位置 "${device.location}" 与已有器件`)
          );
        return !hasConflict;
      }).length;

      return {
        success: true,
        imported: importedCount,
        errors,
        total: newDevices.length,
      };
    } catch (error) {
      logError(
        '批量导入器件失败',
        error,
        'StorageService.importDevicesFromCSV'
      );
      throw error;
    }
  }

  /**
   * 搜索器件
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Array>} 搜索结果数组
   */
  static async searchDevices(keyword) {
    try {
      const devices = await this.getDevices();
      if (!keyword) return devices;
      const searchTerm = keyword.toLowerCase().trim();

      if (!searchTerm) return devices;

      // 多字段模糊搜索
      return devices.filter((device) => {
        return (
          (device.name && device.name.toLowerCase().includes(searchTerm)) ||
          (device.id && device.id.toString().includes(searchTerm)) ||
          (device.function &&
            device.function.toLowerCase().includes(searchTerm)) ||
          (device.resistance &&
            device.resistance.toLowerCase().includes(searchTerm)) ||
          (device.voltage &&
            device.voltage.toLowerCase().includes(searchTerm)) ||
          (device.capacitance &&
            device.capacitance.toLowerCase().includes(searchTerm)) ||
          (device.inductance &&
            device.inductance.toLowerCase().includes(searchTerm)) ||
          (device.current && device.current.toLowerCase().includes(searchTerm))
        );
      });
    } catch (error) {
      logError('搜索器件失败', error, 'StorageService.searchDevices');
      return [];
    }
  }

  /**
   * 过滤器件
   * @param {Object} filters - 过滤条件对象
   * @returns {Promise<Array>} 过滤结果数组
   */
  static async filterDevices(filters) {
    try {
      const devices = await this.getDevices();

      return devices.filter((device) => {
        for (const [key, value] of Object.entries(filters)) {
          // 跳过空值条件
          if (value === null || value === undefined || value === '') continue;

          const deviceValue = device[key];
          if (!deviceValue) return false;

          // 字符串模糊匹配，数字精确匹配
          if (typeof value === 'string') {
            if (
              !deviceValue
                .toString()
                .toLowerCase()
                .includes(value.toLowerCase())
            ) {
              return false;
            }
          } else if (typeof value === 'number') {
            if (deviceValue !== value) {
              return false;
            }
          }
        }
        return true;
      });
    } catch (error) {
      logError('过滤器件失败', error, 'StorageService.filterDevices');
      return [];
    }
  }
}

export default StorageService;
