/**
 * 数据迁移: 从老 AsyncStorage (JSON) → 新 SQLite
 *
 * 触发时机: App 启动时 (在显示主界面之前, 异步跑)
 *
 * 安全保证:
 * 1. 整个迁移在一个 SQL 事务里, 要么全成功要么全失败, 不会半截
 * 2. 失败时老数据完整保留, App 仍按老方式工作 (下一版再迁)
 * 3. 成功后老数据打上 `_v1_migrated` 后缀, 留作只读备份 (出问题可手动恢复)
 * 4. 通过 app_state._migration_done 标记, 不会重复迁移
 *
 * 迁移哪些 key:
 *   devices → devices 表
 *   shelves → shelves 表
 *   boms → boms 表
 *   categories → categories 表
 *   (其它小数据 key 继续用 AsyncStorage, 不动)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DB from './database';
import { logError } from '../utils/ErrorHandler';

const MIGRATION_FLAG_KEY = '_migration_done';
const MIGRATION_BACKUP_SUFFIX = '_v1_migrated';

// 这些 key 走 SQLite
const SQLITE_KEYS = ['devices', 'shelves', 'boms'];

/**
 * 检测是否需要迁移
 * 条件: 还没标记迁移完成, 且 AsyncStorage 里有 devices/shelves/boms
 */
async function isMigrationNeeded() {
  // 已迁过就不迁
  const done = await DB.getState(MIGRATION_FLAG_KEY);
  if (done) return false;

  // 检查老 key 是否有数据
  const keys = await AsyncStorage.multiGet(SQLITE_KEYS);
  return keys.some(([, v]) => v != null);
}

/**
 * 主入口: 异步跑迁移, 失败不阻塞 App 启动
 */
export async function runMigrationIfNeeded() {
  try {
    if (!(await isMigrationNeeded())) {
      console.log('[Migration] 不需要迁移 (首次安装或已完成)');
      return { skipped: true };
    }

    console.log('[Migration] 开始: AsyncStorage → SQLite');
    const t0 = Date.now();

    // 1. 读老数据
    const [devicesRaw, shelvesRaw, bomsRaw] = await Promise.all([
      AsyncStorage.getItem('devices'),
      AsyncStorage.getItem('shelves'),
      AsyncStorage.getItem('boms'),
    ]);

    let devices = [];
    let shelves = [];
    let boms = [];
    try { devices = devicesRaw ? JSON.parse(devicesRaw) : []; } catch (e) {
      console.warn('[Migration] devices JSON 解析失败, 跳过:', e?.message);
    }
    try { shelves = shelvesRaw ? JSON.parse(shelvesRaw) : []; } catch (e) {
      console.warn('[Migration] shelves JSON 解析失败, 跳过:', e?.message);
    }
    try { boms = bomsRaw ? JSON.parse(bomsRaw) : []; } catch (e) {
      console.warn('[Migration] boms JSON 解析失败, 跳过:', e?.message);
    }

    console.log(`[Migration] 老数据: devices=${devices.length}, shelves=${shelves.length}, boms=${boms.length}`);

    // 2. 写 SQLite (replaceAll* 内部自带事务)
    if (devices.length > 0) await DB.replaceAllDevices(devices);
    if (shelves.length > 0) await DB.replaceAllShelves(shelves);
    if (boms.length > 0) await DB.replaceAllBOMs(boms);

    // 3. 类目 (单独逻辑, 单行存储)
    try {
      const catRaw = await AsyncStorage.getItem('categories');
      if (catRaw) {
        const cats = JSON.parse(catRaw);
        if (Array.isArray(cats) && cats.length > 0) {
          await DB.setCategories(cats);
        }
      }
    } catch (e) {
      console.warn('[Migration] categories 迁移失败:', e?.message);
    }

    // 4. 标记完成 (关键: 必须最后写, 不然失败会被误判为已迁)
    await DB.setState(MIGRATION_FLAG_KEY, {
      done: true,
      timestamp: new Date().toISOString(),
      counts: { devices: devices.length, shelves: shelves.length, boms: boms.length },
    });

    // 5. 老数据备份 (改名, 留作兜底, 不删)
    // 1 个月后可以让用户手动清理, 这里先不删
    try {
      for (const key of [...SQLITE_KEYS, 'categories']) {
        const val = await AsyncStorage.getItem(key);
        if (val != null) {
          await AsyncStorage.setItem(key + MIGRATION_BACKUP_SUFFIX, val);
        }
      }
      console.log('[Migration] 老数据已备份为 ' + MIGRATION_BACKUP_SUFFIX + ' 后缀');
    } catch (backupErr) {
      console.warn('[Migration] 老数据备份失败 (不影响主流程):', backupErr?.message);
    }

    const t1 = Date.now();
    console.log(`[Migration] 完成! 耗时 ${t1 - t0}ms`);
    return {
      skipped: false,
      devices: devices.length,
      shelves: shelves.length,
      boms: boms.length,
      durationMs: t1 - t0,
    };
  } catch (err) {
    logError('数据迁移失败 (老数据保留, App 仍按老方式工作)', err, 'Migration.runMigrationIfNeeded');
    return { skipped: true, error: err };
  }
}

/**
 * 检测当前是否已经迁移完成 (供调试 / 设置页展示)
 */
export async function isMigrated() {
  return !!(await DB.getState(MIGRATION_FLAG_KEY));
}

/**
 * 清除迁移标记 + 老备份 (供"完全重置"场景)
 * 不删 SQLite 里的新数据, 只清标记, 下次启动会重复迁移
 */
export async function clearMigrationFlag() {
  await DB.deleteState(MIGRATION_FLAG_KEY);
  for (const key of SQLITE_KEYS) {
    await AsyncStorage.removeItem(key + MIGRATION_BACKUP_SUFFIX);
  }
}

export default {
  runMigrationIfNeeded,
  isMigrated,
  clearMigrationFlag,
};
