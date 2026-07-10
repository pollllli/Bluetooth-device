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
import { getShelves, getCurrentShelfId } from './ShelfService';
import * as FileSystem from 'expo-file-system/legacy';

// 导入的图片保存目录 (app 沙盒内, 跨设备可移植)
const IMAGES_DIR = `${FileSystem.documentDirectory}images/`;

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

      // 清理历史遗留的 ImagePicker 临时 cache 路径
      // 旧版本 addDevice 把 asset.uri 直接存进 AsyncStorage, 文件在 cache/ImagePicker/ 下,
      // 一旦 cache 被系统清掉, 这个 device.image 就成"鬼影", 后续 export 读就 ENOENT
      // 这里一次性把失效的临时路径清成空串, 不再尝试重新复制 (源文件已经没了)
      if (Array.isArray(devices) && devices.length > 0) {
        let cleanedImageCount = 0;
        const cleaned = await Promise.all(
          devices.map(async (d) => {
            if (!d || !d.image || typeof d.image !== 'string') return d;
            if (!d.image.startsWith('file://')) return d; // content:// / http:// 不动
            if (d.image.startsWith(IMAGES_DIR)) return d; // 已经是永久沙盒的, 不动
            // 临时 cache 路径: 检查文件是否还存在
            try {
              const info = await FileSystem.getInfoAsync(d.image);
              if (!info || !info.exists) {
                cleanedImageCount++;
                console.warn(`[getDevices] 清理失效图片路径: ${d.image}`);
                return { ...d, image: '' };
              }
            } catch (e) {
              // getInfoAsync 失败: 保守地清掉, 避免后续报错
              cleanedImageCount++;
              return { ...d, image: '' };
            }
            return d;
          })
        );
        if (cleanedImageCount > 0) {
          devices = cleaned;
          needsSave = true;
          console.log(`[getDevices] 共清理 ${cleanedImageCount} 个失效的图片临时路径`);
        }
      }

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

      if (device.location != null && device.location !== '' && device.shelfId) {
        const conflict = devices.find(
          (d) => d.location === device.location && d.shelfId === device.shelfId
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

      // 【图片持久化】把 ImagePicker 临时 cache 路径复制到永久沙盒
      // 修复: 之前直接存 asset.uri, 临时文件被系统清掉后 export 读就 ENOENT
      if (newDevice.image) {
        newDevice.image = await this.#persistImageToSandbox(newDevice.image);
      }

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

      if (updatedDevice.location != null && updatedDevice.location !== '' && updatedDevice.shelfId) {
        const conflict = devices.find(
          (d) =>
            d.location === updatedDevice.location &&
            d.shelfId === updatedDevice.shelfId &&
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
        // 【图片持久化】编辑器件时如果换了图, 把新图也复制到永久沙盒
        if (updatedDevice.image && updatedDevice.image !== devices[index].image) {
          updatedDevice.image = await this.#persistImageToSandbox(updatedDevice.image);
        }
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
   * 把图片 URI 读成 base64 字符串 (用于导出时嵌入 JSON)
   * @param {string} uri - file://... / content://... / ph://...
   * @returns {Promise<string|null>} base64 字符串, 失败返回 null
   */
  static async #readImageAsBase64(uri) {
    if (!uri || typeof uri !== 'string') return null;
    try {
      // 防御性探针: 先用 getInfoAsync 确认文件存在
      // 修复"上次运行出现错误"弹窗: ImagePicker 选完图如果 app 被强杀 / 后台清掉,
      // 存的还是 cache 临时路径, 下次启动读就直接 ENOENT。
      // 提前跳过, 不走 readAsStringAsync, 也不进 catch (避免 console.error 触发 LogBox 持久化)
      if (uri.startsWith('file://')) {
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info || !info.exists) {
            // 静默返回 null, 仅 warn (warn 不会被 LogBox 弹窗)
            console.warn(`[readImageAsBase64] 图片不存在, 已跳过: ${uri}`);
            return null;
          }
        } catch (infoErr) {
          // getInfoAsync 自身失败不阻塞, 让 readAsStringAsync 继续尝试 (可能 content:// 走 ContentResolver)
        }
      }
      // FileSystem.readAsStringAsync 支持 file:// 和 content://
      // 鸿蒙/微信分享的 content URI 也能用 (走 ContentResolver)
      return await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (err) {
      // 用 warn 而不是 error:
      // - 缺失的临时 cache 图是**预期的可恢复**情况 (用户上次强退 / 切库 / 系统清缓存)
      // - console.error 会被 RN LogBox 持久化, 下次启动弹"上次运行出现错误"骚扰用户
      // - console.warn 不被 LogBox 记录, 仅 adb logcat 可见
      console.warn(`[readImageAsBase64] 读图片失败 (已跳过): ${err?.message || err}`);
      return null;
    }
  }

  /**
   * 把 base64 字符串写入 app 沙盒的 images/ 目录
   * @param {string} base64
   * @param {string} filename - 例 '12.jpg'
   * @returns {Promise<string|null>} 沙盒 file:// URI, 失败返回 null
   */
  static async #writeBase64AsImage(base64, filename) {
    if (!base64) return null;
    try {
      // 确保 images/ 目录存在
      const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(IMAGES_DIR, { intermediates: true });
      }
      const filePath = `${IMAGES_DIR}${filename}`;
      await FileSystem.writeAsStringAsync(filePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return filePath;
    } catch (err) {
      logError('写 base64 到沙盒失败', err, 'StorageService.#writeBase64AsImage');
      return null;
    }
  }

  /**
   * 把图片文件从临时位置 (ImagePicker cache) 复制到 app 永久沙盒 images/ 目录
   *
   * 设计目的 (修复"上次运行出现错误"弹窗):
   * - expo-image-picker 默认把选中的图放到 cache/ImagePicker/xxx.jpeg (临时路径)
   * - 临时路径随时可能被 Android 系统清掉 (杀进程 / 低存储清理 / 切到后台太久)
   * - addDevice / updateDevice 直接把临时 URI 存进 AsyncStorage,
   *   后续 export 读就 ENOENT, console.error 被 App.tsx 拦截器持久化 → 弹窗骚扰用户
   *
   * 行为:
   * - 入参 URI 已经在永久沙盒 (IMAGES_DIR) 内 → 不动, 直接返回原 URI
   * - 是 cache 路径 / 其他临时位置 → 复制到永久沙盒, 返回新 URI
   * - 复制失败 (源文件已不在) → 返回原 URI, 让上层继续 (export 时会优雅降级)
   *
   * @param {string} uri - 源图片 URI
   * @returns {Promise<string>} 永久沙盒 URI, 失败回退到原 URI
   */
  static async #persistImageToSandbox(uri) {
    if (!uri || typeof uri !== 'string') return uri;
    // 已经在永久沙盒内: 不动
    if (uri.startsWith(IMAGES_DIR)) return uri;
    // 非 file:// URI (content:// / ph:// / http://) : 不处理, 让上层走 ContentResolver
    if (!uri.startsWith('file://')) return uri;
    try {
      // 先确认源文件存在 (用户上次强退 → cache 被清 → 源可能已经没了)
      const srcInfo = await FileSystem.getInfoAsync(uri);
      if (!srcInfo || !srcInfo.exists) {
        console.warn(`[persistImageToSandbox] 源图片已不存在, 跳过: ${uri}`);
        return uri; // 返回原 URI, 上层按需处理
      }
      // 确保目标目录存在
      const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
      if (!dirInfo || !dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(IMAGES_DIR, { intermediates: true });
      }
      // 提取扩展名, 默认 .jpg
      const extMatch = uri.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
      const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.jpg';
      // 用 device.id 或时间戳命名, 保证唯一
      const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const destPath = `${IMAGES_DIR}${filename}`;
      await FileSystem.copyAsync({ from: uri, to: destPath });
      console.log(`[persistImageToSandbox] 已复制 ${uri} -> ${destPath}`);
      return destPath;
    } catch (err) {
      console.warn(`[persistImageToSandbox] 复制失败, 保留原 URI: ${err?.message || err}`);
      return uri;
    }
  }

  /**
   * 将备份中的类目合并到本地类目（不覆盖, 只追加）
   * - 大类不存在 → 整个追加（带全部子类目）
   * - 大类存在但子项缺失 → 只追加缺失的子类目
   *
   * 设计目的: 用户在 A 手机上自定义的类目, 通过 JSON 分享给 B 手机后,
   * B 手机的本地已有类目不应被清空, 也不应被完全覆盖,
   * 而应该是"取并集"。
   *
   * @param {Array|null|undefined} backupCategories 备份里的 categories 数组
   * @returns {Promise<{added: number, updated: boolean}>} 追加的子类目数, 是否更新过本地
   */
  static async mergeCategoriesFromBackup(backupCategories) {
    if (!Array.isArray(backupCategories) || backupCategories.length === 0) {
      return { added: 0, updated: false };
    }
    try {
      // 关键: 走原始 AsyncStorage, 不要走 DeviceCategoryService (避免被默认值兜底污染)
      const localRaw = await this.getCategories();
      const local = Array.isArray(localRaw) ? localRaw : [];

      // 深拷贝, 避免直接改 cached
      const merged = local.map((c) => ({
        name: c.name,
        subCategories: Array.isArray(c.subCategories) ? [...c.subCategories] : [],
      }));
      const byBigName = new Map(merged.map((c) => [c.name, c]));

      let addedSubCount = 0;
      let addedBigCount = 0;
      for (const bc of backupCategories) {
        if (!bc || !bc.name) continue;
        const bigName = String(bc.name).trim();
        if (!bigName) continue;
        const subs = Array.isArray(bc.subCategories) ? bc.subCategories : [];

        if (!byBigName.has(bigName)) {
          // 新大类: 整体追加
          merged.push({
            name: bigName,
            subCategories: subs.map((s) => String(s).trim()).filter(Boolean),
          });
          byBigName.set(bigName, merged[merged.length - 1]);
          addedBigCount++;
          addedSubCount += subs.length;
        } else {
          // 已存在的大类: 只追加缺失的子类目
          const localBig = byBigName.get(bigName);
          const existing = new Set(localBig.subCategories);
          for (const s of subs) {
            const subName = String(s || '').trim();
            if (!subName) continue;
            if (!existing.has(subName)) {
              localBig.subCategories.push(subName);
              existing.add(subName);
              addedSubCount++;
            }
          }
        }
      }

      if (addedSubCount > 0 || addedBigCount > 0) {
        await this.saveCategories(merged);
        console.log(
          `[mergeCategoriesFromBackup] 合并完成: 新增 ${addedBigCount} 个大类, 共 ${addedSubCount} 个新子类目`
        );
        return { added: addedSubCount, updated: true };
      }
      return { added: 0, updated: false };
    } catch (err) {
      logError('合并类目失败', err, 'StorageService.mergeCategoriesFromBackup');
      return { added: 0, updated: false };
    }
  }

  /**
   * 导出所有数据
   * @param {Object} [options] - 导出选项
   * @param {string} [options.shelfId] - 只导出指定库存的器件（按 shelfId 过滤），不传则导出全部
   * @returns {Promise<Object>} 包含所有数据的备份对象
   */
  static async exportAllData(options = {}) {
    try {
      const { shelfId } = options;
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

      // 关键: 如果指定了 shelfId, 只导出该库存的器件
      if (shelfId && Array.isArray(data.devices)) {
        const before = data.devices.length;
        data.devices = data.devices.filter((d) => d && d.shelfId === shelfId);
        data._filteredShelfId = shelfId; // 标记这是单库存导出
        console.log(
          `[exportAllData] 按 shelfId=${shelfId} 过滤器件: ${before} -> ${data.devices.length}`
        );
      }

      // 关键: 导出库存列表 (含蓝牙绑定 MAC/名称), 用于接收方还原库存-蓝牙记忆
      try {
        const shelves = await getShelves();
        data.shelves = shelves; // shelves[].bluetoothMac / bluetoothName 一起导出
      } catch (shelfErr) {
        logError('导出库存列表失败', shelfErr, 'StorageService.exportAllData');
        data.shelves = null;
      }

      // 关键: 导出当前选中的库存 id
      try {
        data.currentShelfId = await getCurrentShelfId();
      } catch (csErr) {
        data.currentShelfId = null;
      }

      // 关键: 导出"上次连接的蓝牙设备" (库存页"重新连接"按钮依赖此字段)
      // 没有这个的话, 接收方 app 里的"重新连接"按钮点不动 (getLastConnectedDevice 返回 null)
      try {
        data.lastConnectedDevice = await this.getLastConnectedDevice();
      } catch (lcdErr) {
        data.lastConnectedDevice = null;
      }

      // 关键: 把每张图片读成 base64 嵌入 JSON
      // 否则接收方手机的 content:// URI 失效, 图片加载不出来
      let embeddedImageCount = 0;
      let failedImageCount = 0;
      if (Array.isArray(data.devices)) {
        for (const device of data.devices) {
          if (device && device.image) {
            const b64 = await this.#readImageAsBase64(device.image);
            if (b64) {
              device._imageBase64 = b64;
              embeddedImageCount++;
            } else {
              failedImageCount++;
            }
          }
        }
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
        embeddedImageCount,
        failedImageCount,
      };

      return {
        data,
        summary,
        exportDate: new Date().toISOString(),
        // 1.3.0: 含 shelves 列表 + currentShelfId + 库存-蓝牙记忆 (bluetoothMac / bluetoothName)
        // 关键: 必须是 1.3.0, 导入端才会在 importAllData 中还原库存列表与蓝牙绑定
        version: '1.3.0',
        appVersion: '1.2.3',
      };
    } catch (error) {
      logError('导出数据失败', error, 'StorageService.exportAllData');
      throw error;
    }
  }

  /**
   * 一次性导出多个库存, 返回多份独立 JSON 对象
   * 每份 JSON 仅包含指定库存的器件, 其余数据(boms/users/categories)同样携带以便还原
   * @param {Array<{id:string, name:string}>} shelves - 要导出的库存列表
   * @returns {Promise<Array<{shelf: object, backup: object, fileName: string}>>}
   */
  static async exportShelves(shelves) {
    if (!Array.isArray(shelves) || shelves.length === 0) {
      throw new Error('未选择任何库存');
    }
    const result = [];
    for (const shelf of shelves) {
      const backup = await this.exportAllData({ shelfId: shelf.id });
      // 关键: 文件名直接用库存名(去掉不合法字符, 保留中文/英文/数字/常用符号)
      // 例如: 库存A.json  (旧版: 库存_库存A_20260702.json)
      // 这样从微信导入时, 可以直接根据文件名判断是新增还是覆盖
      const safeName = (shelf.name || '未命名库存')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || '未命名库存';
      const fileName = `${safeName}.json`;
      result.push({ shelf, backup, fileName });
    }
    return result;
  }

  /**
   * 导入备份数据
   * @param {Object} backupData - 备份数据对象
   * @param {Object} backupData.data - 要导入的数据
   * @param {string} [backupData.version] - 备份版本
   * @returns {Promise<{restoredImageCount: number, failedImageCount: number}>}
   * @throws {Error} 如果备份数据无效或版本不兼容
   */
  static async importAllData(backupData) {
    try {
      if (!backupData || !backupData.data) {
        throw new Error('无效的备份数据');
      }

      // 验证备份数据版本 (兼容 1.0.0 / 1.1.0 / 1.2.0 / 1.3.0)
      // 1.0.0: 无 categories 字段, 无图片
      // 1.1.0: 含 categories 字段, 无图片
      // 1.2.0: 含 categories 字段 + 器件图片 (base64 嵌入)
      // 1.3.0: 含 shelves 列表 + currentShelfId + 库存-蓝牙记忆 (bluetoothMac/bluetoothName)
      const version = backupData.version || '1.0.0';
      const supportedVersions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0'];
      if (!supportedVersions.includes(version)) {
        throw new Error('备份数据版本不兼容');
      }

      // 1.0.0 没有 categories 字段，若用户已在另一台手机上自定义过类目，
      // 导入后那台手机的本地类目不会被覆盖（保持本地原有类目）
      // 1.1.0 始终包含 categories 字段，会完整覆盖
      // 1.2.0 始终包含 categories 字段 + 器件图片

      // 关键: 1.2.0 备份里器件图片是 _imageBase64 字段
      // 我们需要把它解码写入本机沙盒, 把 device.image 替换为 file:// 沙盒路径
      let restoredImageCount = 0;
      let failedImageCount = 0;
      // 1.2.0 / 1.3.0 都含 _imageBase64 图片, 都走图片恢复
      if ((version === '1.2.0' || version === '1.3.0') && Array.isArray(backupData.data.devices)) {
        for (const device of backupData.data.devices) {
          if (device && device._imageBase64) {
            const filename = `${device.id || Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const fileUri = await this.#writeBase64AsImage(device._imageBase64, filename);
            if (fileUri) {
              device.image = fileUri;   // 替换为沙盒 file:// URI
              restoredImageCount++;
            } else {
              failedImageCount++;
              device.image = '';        // 写入失败: 清除无效 URI
            }
            // 删除临时字段, 不存进 storage
            delete device._imageBase64;
          }
        }
      }

      // 批量保存数据
      await this.batchSet(backupData.data);

      // 关键: 1.3.0 恢复库存列表 + 库存-蓝牙绑定 (bluetoothMac / bluetoothName)
      if (version === '1.3.0' && Array.isArray(backupData.data.shelves) && backupData.data.shelves.length > 0) {
        try {
          // 1) 直接写 AsyncStorage (避开 ShelfService 内部缓存)
          await saveData('shelves', backupData.data.shelves);
          if (backupData.data.currentShelfId) {
            await saveData('currentShelfId', backupData.data.currentShelfId);
          }
          console.log('[importAllData] 1.3.0 已恢复库存列表与蓝牙绑定, shelves.length=',
            backupData.data.shelves.length);
        } catch (shelfImportErr) {
          logError('恢复库存列表失败', shelfImportErr, 'StorageService.importAllData');
        }
      }

      // 关键: 1.3.0 恢复"上次连接的蓝牙设备" (库存页"重新连接"按钮依赖)
      // 同时同步写入 currentShelf 的 bluetoothMac/bluetoothName, 保证切库自动连也用得上
      if (version === '1.3.0' && backupData.data.lastConnectedDevice) {
        try {
          const lcd = backupData.data.lastConnectedDevice;
          await this.saveLastConnectedDevice(lcd);
          // 兜底: 把这个设备同步写到 currentShelf 上, 防止 shelves 没绑
          if (lcd && (lcd.id || lcd.deviceId) && (lcd.name || lcd.deviceName)) {
            try {
              // 关键: 先清掉 ShelfService 的内存缓存, 下面的 getCurrentShelfId / getShelves
              // 才会从 AsyncStorage 重新读取 (否则拿到的是导入前的旧数据, 会覆盖刚写入的 shelves)
              try {
                const ShelfService = require('./ShelfService');
                if (ShelfService && typeof ShelfService.clearShelvesCache === 'function') {
                  ShelfService.clearShelvesCache();
                }
              } catch (clearCacheErr) {
                // ignore
              }

              const curShelfId = await getCurrentShelfId();
              if (curShelfId) {
                const allShelves = await getShelves();
                const cur = allShelves.find((s) => s.id === curShelfId);
                if (cur && !cur.bluetoothMac) {
                  cur.bluetoothMac = lcd.id || lcd.deviceId;
                  cur.bluetoothName = lcd.name || lcd.deviceName;
                  await saveData('shelves', allShelves);
                  // 同步清掉 ShelfService 缓存, 让下次读取拿到最新的
                  try {
                    const ShelfService = require('./ShelfService');
                    if (ShelfService && typeof ShelfService.clearShelvesCache === 'function') {
                      ShelfService.clearShelvesCache();
                    }
                  } catch (e) {}
                  console.log('[importAllData] 已把 lastConnectedDevice 同步到当前库存的蓝牙绑定');
                }
              }
            } catch (syncErr) {
              console.warn('[importAllData] 同步 lastConnectedDevice 到当前库存失败:', syncErr);
            }
          }
          console.log('[importAllData] 1.3.0 已恢复 lastConnectedDevice');
        } catch (lcdErr) {
          logError('恢复 lastConnectedDevice 失败', lcdErr, 'StorageService.importAllData');
        }
      }

      // 清除 devices 缓存, 强制下次读取时重新加载 (新导入的图片路径立即生效)
      this.#clearCache('devices');

      // 合并类目 (取并集, 不覆盖本地) — 1.1.0+ 备份含 categories
      let mergedCategoryCount = 0;
      try {
        if (version === '1.1.0' || version === '1.2.0' || version === '1.3.0') {
          const mergeRes = await this.mergeCategoriesFromBackup(backupData.data.categories);
          mergedCategoryCount = mergeRes.added;
        }
      } catch (catErr) {
        logError('合并类目失败', catErr, 'StorageService.importAllData');
      }

      return { restoredImageCount, failedImageCount, mergedCategoryCount };
    } catch (error) {
      logError('导入数据失败', error, 'StorageService.importAllData');
      throw error;
    }
  }

  /**
   * 从文件导入单个库存 (新流程)
   *
   * 设计目标: 多次从微信导入时, 不会覆盖其他库存, 而是在已有基础上添加
   *
   * 关键逻辑:
   * 1. 用 fileName(去掉 .json 后缀) 作为"目标库存名"
   * 2. 如果本地已有同名库存 → 覆盖该库存的器件数据(保留其 id, 以免误删器件)
   * 3. 如果本地没有同名库存 → 自动新增一个库存, 并把导入的器件放到这个新库存下
   * 4. 导入完成后, 把"目标库存"设置为当前库存(切库动作)
   * 5. 不影响 BOM / users / categories / searchHistory 等其他数据
   * 6. 不影响其他库存的器件
   *
   * @param {string} fileName - 原始文件名(来自微信分享/手动选择), 例: "库存A.json"
   * @param {Object} backupData - 备份数据对象 (来自 exportAllData 序列化后的 JSON)
   * @returns {Promise<{shelfId:string, shelfName:string, isNew:boolean, action:'overwrite'|'add', deviceCount:number, restoredImageCount:number, failedImageCount:number, bluetoothMac?:string, bluetoothName?:string}>}
   */
  static async importShelfFromFile(fileName, backupData) {
    try {
      if (!backupData || !backupData.data) {
        throw new Error('无效的备份数据');
      }

      // 【最早期动作】先把旧蓝牙链路断开
      // 微信分享导入时, App 已经在后台待过, BLE 链路大概率被 OS 挂起/已死
      // 如果不在这一步断开, 后面所有"灭旧库存灯"的操作都会因为 sendCommand 链路
      // 死了而静默失败, 但 try/catch 不抛错 — 用户看到的就是"灯还亮着但日志说成功了"
      // 调 disconnect(): 内部会先发 controlAll: false(尝试灭灯), 再 cancelConnection(清理链路)
      // 即使 sendCommand 失败, cancelConnection 也会尽量把链路关掉
      try {
        const conn = (typeof global !== 'undefined') ? global.deviceConnection : null;
        if (conn && conn.handler && typeof conn.handler.disconnect === 'function') {
          console.log('[importShelfFromFile] 导入前先断开旧蓝牙链路, 强制灭旧库存灯');
          await conn.handler.disconnect();
        }
      } catch (discErr) {
        // 忽略, 不阻塞导入主流程
        console.warn('[importShelfFromFile] 导入前断旧蓝牙失败 (不阻塞):', discErr?.message || discErr);
      }

      // 1) 验证备份数据版本 (兼容 1.0.0 / 1.1.0 / 1.2.0 / 1.3.0)
      const version = backupData.version || '1.0.0';
      const supportedVersions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0'];
      if (!supportedVersions.includes(version)) {
        throw new Error('备份数据版本不兼容');
      }

      // 2) 解析文件名 → 目标库存名
      // 微信分享时, fileName 可能包含 .json 后缀; 也可能没有
      // 还需要把微信那边 URL 编码过的字符解码
      let rawName = (fileName || '').toString();
      try {
        rawName = decodeURIComponent(rawName);
      } catch (e) {
        // 解码失败就用原文
      }
      // 去掉 .json / .JSON 等后缀, 以及路径中可能的前缀
      rawName = rawName.split(/[\\/]/).pop() || rawName;
      rawName = rawName.replace(/\.json$/i, '').trim();
      // 万一文件名为空, 给一个默认名 (不应该发生)
      const targetShelfName = rawName || '导入的库存';
      console.log('[importShelfFromFile] fileName=', fileName, '→ 目标库存名:', targetShelfName);

      // 3) 1.2.0 / 1.3.0 备份里的器件图片是 _imageBase64 字段
      //    解码写入本机沙盒, 把 device.image 替换为 file:// 沙盒路径
      let restoredImageCount = 0;
      let failedImageCount = 0;
      if ((version === '1.2.0' || version === '1.3.0') && Array.isArray(backupData.data.devices)) {
        for (const device of backupData.data.devices) {
          if (device && device._imageBase64) {
            const fname = `${device.id || Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const fileUri = await this.#writeBase64AsImage(device._imageBase64, fname);
            if (fileUri) {
              device.image = fileUri;
              restoredImageCount++;
            } else {
              failedImageCount++;
              device.image = '';
            }
            delete device._imageBase64;
          }
        }
      }

      // 4) 决定是覆盖还是新增
      //    加载本地 shelves (绕过 ShelfService 缓存, 走原始 AsyncStorage)
      const localShelvesRaw = await getData('shelves', null);
      // 关键: 新装用户 shelves 是空数组, 不要再兜底加一个"库存（一）"
      // (会和用户主动建的"库存（一）"冲突, 也会导致导入后多出一个空库存)
      const localShelves = Array.isArray(localShelvesRaw) ? localShelvesRaw : [];

      const existing = localShelves.find((s) => s && s.name === targetShelfName);

      // 从备份里取"源库存"的元数据 (蓝牙绑定等)
      // 旧版备份没有 shelves 字段, 这种情况下没有源库存信息
      const backupShelves = Array.isArray(backupData.data.shelves) ? backupData.data.shelves : [];
      // 关键: 备份里通常是全部 shelves (exportAllData 不剔除其他库存),
      // 不能再用 backupShelves[0] 拿绑定 — 那样会拿到一个"恰好排第一的库存"的 MAC,
      // 而不是用户真正导出的那个。
      // 优先用"按文件名解析出的库存名"在备份 shelves 里精确匹配。
      let sourceShelf = backupShelves.find((s) => s && s.name === targetShelfName) || {};
      if (!sourceShelf || !sourceShelf.id) {
        // 兜底: 旧版备份里没有 shelves, 退化为取第一个
        sourceShelf = backupShelves[0] || {};
      }
      const sourceBluetoothMac = sourceShelf.bluetoothMac || '';
      const sourceBluetoothName = sourceShelf.bluetoothName || '';
      console.log('[importShelfFromFile] 源库存解析:', sourceShelf.id, sourceShelf.name,
        'mac=', sourceBluetoothMac, 'name=', sourceBluetoothName);

      let targetShelfId;
      let isNew;
      let action;

      if (existing) {
        // 覆盖: 保留现有库存 id, 这样 ShelfService 不会因 id 变化而误判
        targetShelfId = existing.id;
        isNew = false;
        action = 'overwrite';
        // 蓝牙绑定: 如果导入的数据有更新的绑定, 覆盖; 否则保留本地
        if (sourceBluetoothMac) {
          existing.bluetoothMac = sourceBluetoothMac;
          existing.bluetoothName = sourceBluetoothName;
        }
        console.log('[importShelfFromFile] 覆盖现有库存:', targetShelfName, 'id=', targetShelfId);
      } else {
        // 新增: 生成新 id, 沿用导入的蓝牙绑定
        targetShelfId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newShelf = { id: targetShelfId, name: targetShelfName };
        if (sourceBluetoothMac) {
          newShelf.bluetoothMac = sourceBluetoothMac;
          newShelf.bluetoothName = sourceBluetoothName;
        }
        localShelves.push(newShelf);
        isNew = true;
        action = 'add';
        console.log('[importShelfFromFile] 新增库存:', targetShelfName, 'id=', targetShelfId);
      }

      // 5) 处理器件
      //    - 取出本地全部器件
      //    - 删掉"目标库存"下的旧器件 (覆盖语义)
      //    - 把导入的器件的 shelfId 全部改写为"目标库存 id" (适配新 id)
      //    - 与其他库存的器件合并保存
      const localDevices = await this.getDevices();
      const otherShelfDevices = localDevices.filter((d) => d && d.shelfId !== targetShelfId);

      const importedDevicesRaw = Array.isArray(backupData.data.devices) ? backupData.data.devices : [];
      const importedDevices = importedDevicesRaw.map((d) => {
        if (!d) return d;
        // 关键: 不管源文件里 shelfId 是什么(可能是源 id, 可能没有, 可能是别的库存),
        // 都统一改写为目标库存 id, 避免出现"导入到错的库存"或"导入后无库存归属"
        return { ...d, shelfId: targetShelfId };
      });

      const mergedDevices = [...otherShelfDevices, ...importedDevices];
      await this.saveDevices(mergedDevices);
      console.log('[importShelfFromFile] 器件合并完成: 其他库存', otherShelfDevices.length, '个 + 导入',
        importedDevices.length, '个 = 总计', mergedDevices.length, '个');

      // 6) 写回 shelves (覆盖场景可能改了 bluetoothMac/bluetoothName)
      await saveData('shelves', localShelves);

      // 6.1) 通知订阅者: shelves 变了 (AppNavigator 据此决定是否显示"连接"/"BOM"标签)
      try {
        const ShelfService = require('./ShelfService');
        if (ShelfService && typeof ShelfService.notifyShelfChanged === 'function') {
          ShelfService.notifyShelfChanged(localShelves);
        }
      } catch (emitErr) {
        // ignore
      }

      // 7) 切换 currentShelfId 为导入的库存 (导入完成, 当前库存跟随)
      // 【关键】之前直接 saveData, 绕过了 ShelfService.setCurrentShelfId,
      // 导致 controlAll: false 不会发, 灭灯/清 BOM 都不会发生
      // 现在走 setCurrentShelfId, 让切库/灭灯的副作用统一收敛
      //
      // 【重要】必须在 setCurrentShelfId 之前清掉 ShelfService 的 shelvesCache,
      // 因为 importShelfFromFile 是直接 getData('shelves') 写入的, 没经过 ShelfService,
      // 它的 _shelvesCache 还是旧的 (不含新库存). setCurrentShelfId 内部
      // 校验 `list.some(s => s.id === id)` 拿的是旧 cache, 会报"库存不存在".
      // 解决: 显式清 cache, 让 setCurrentShelfId 走 getShelves() → AsyncStorage
      try {
        const ShelfService = require('./ShelfService');
        if (ShelfService && typeof ShelfService.clearShelvesCache === 'function') {
          ShelfService.clearShelvesCache();
        }
        if (ShelfService && typeof ShelfService.setCurrentShelfId === 'function') {
          await ShelfService.setCurrentShelfId(targetShelfId);
        } else {
          // 兜底: ShelfService 不可用时, 走原 saveData
          await saveData('currentShelfId', targetShelfId);
        }
      } catch (switchErr) {
        // ShelfService 报错时, 至少保证 currentShelfId 写盘成功
        logError('setCurrentShelfId 失败, 降级到 saveData', switchErr, 'StorageService.importShelfFromFile');
        await saveData('currentShelfId', targetShelfId);
      }

      // 8) 清除缓存
      this.#clearCache('devices');
      try {
        const ShelfService = require('./ShelfService');
        if (ShelfService && typeof ShelfService.clearShelvesCache === 'function') {
          ShelfService.clearShelvesCache();
        }
      } catch (clearCacheErr) {
        // ignore
      }

      // 9) 读一下最终的目标库存(用于返回蓝牙绑定等元数据)
      const finalShelf = localShelves.find((s) => s && s.id === targetShelfId) || {};

      // 10) 合并类目 (用户反馈: 之前导出的 JSON 不包含分类管理中新增的类目)
      // 关键: 不覆盖本地, 只追加备份里有但本地没有的 (取并集)
      let mergedCategoryCount = 0;
      try {
        if (version === '1.1.0' || version === '1.2.0' || version === '1.3.0') {
          const mergeRes = await this.mergeCategoriesFromBackup(backupData.data.categories);
          mergedCategoryCount = mergeRes.added;
        }
      } catch (catErr) {
        logError('合并类目失败', catErr, 'StorageService.importShelfFromFile');
      }

      return {
        shelfId: targetShelfId,
        shelfName: targetShelfName,
        isNew,
        action,
        deviceCount: importedDevices.length,
        restoredImageCount,
        failedImageCount,
        mergedCategoryCount,
        bluetoothMac: finalShelf.bluetoothMac || '',
        bluetoothName: finalShelf.bluetoothName || '',
      };
    } catch (error) {
      logError('从文件导入库存失败', error, 'StorageService.importShelfFromFile');
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

        // 多库存: 保留每个器件自身的 shelfId, 老数据(没有 shelfId 字段)默认放主库存
        if (!device.shelfId) {
          device.shelfId = '1';
        }

        // 移除不需要的字段
        delete device.shelfid;

        newDevices.push(device);
      }

      // 按 shelfId 分组检查位置冲突
      const existingDevices = await this.getDevices();
      const locationMapByShelf = {};
      for (const ed of existingDevices) {
        if (ed.location != null && ed.location !== '' && ed.shelfId) {
          if (!locationMapByShelf[ed.shelfId]) locationMapByShelf[ed.shelfId] = {};
          locationMapByShelf[ed.shelfId][ed.location] = ed.name;
        }
      }

      // 为没有location的器件自动分配空位置
      for (const device of newDevices) {
        if (device.location == null || device.location === '') {
          const shelf = device.shelfId || '1';
          if (!locationMapByShelf[shelf]) locationMapByShelf[shelf] = {};
          for (let pos = 0; pos < 90; pos++) {
            const posStr = String(pos);
            if (!locationMapByShelf[shelf][posStr]) {
              device.location = posStr;
              locationMapByShelf[shelf][posStr] = device.name;
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
