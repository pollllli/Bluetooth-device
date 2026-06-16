// 存储工具函数
// 用于处理通用的存储操作，提供统一的数据存取接口

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from './ErrorHandler';

/**
 * 保存数据到AsyncStorage
 * @param {string} key - 存储键名
 * @param {any} value - 存储值
 * @returns {Promise<void>}
 */
export const saveData = async (key, value) => {
  try {
    const jsonValue = JSON.stringify(value);
    await AsyncStorage.setItem(key, jsonValue);
  } catch (error) {
    logError(`Failed to save data for key: ${key}`, error, 'StorageUtils');
    throw error;
  }
};

/**
 * 从AsyncStorage获取数据
 * @param {string} key - 存储键名
 * @param {any} defaultValue - 默认值
 * @returns {Promise<any>}
 */
export const getData = async (key, defaultValue = null) => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    return jsonValue != null ? JSON.parse(jsonValue) : defaultValue;
  } catch (error) {
    logError(`Failed to get data for key: ${key}`, error, 'StorageUtils');
    return defaultValue;
  }
};

/**
 * 从AsyncStorage删除数据
 * @param {string} key - 存储键名
 * @returns {Promise<void>}
 */
export const removeData = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    logError(`Failed to remove data for key: ${key}`, error, 'StorageUtils');
    throw error;
  }
};

/**
 * 批量获取数据
 * @param {string[]} keys - 存储键名数组
 * @returns {Promise<Object>}
 */
export const batchGetData = async (keys) => {
  try {
    const results = await AsyncStorage.multiGet(keys);
    const data = {};
    results.forEach(([key, value]) => {
      if (value) {
        try {
          data[key] = JSON.parse(value);
        } catch (e) {
          data[key] = value;
        }
      }
    });
    return data;
  } catch (error) {
    logError('Failed to batch get data', error, 'StorageUtils');
    return {};
  }
};

/**
 * 批量保存数据
 * @param {Object} keyValuePairs - 键值对对象
 * @returns {Promise<void>}
 */
export const batchSaveData = async (keyValuePairs) => {
  try {
    const pairs = Object.entries(keyValuePairs).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]);
    await AsyncStorage.multiSet(pairs);
  } catch (error) {
    logError('Failed to batch save data', error, 'StorageUtils');
    throw error;
  }
};

/**
 * 清除所有存储数据
 * @returns {Promise<void>}
 */
export const clearAllData = async () => {
  try {
    await AsyncStorage.clear();
  } catch (error) {
    logError('Failed to clear all data', error, 'StorageUtils');
    throw error;
  }
};
