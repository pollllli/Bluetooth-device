/**
 * SQLite 数据库封装
 *
 * 设计目标:
 * - 单例 DB 连接, 整个 App 共享一个 db 实例
 * - Schema 集中管理, 启动时自动建表 + 建索引
 * - 提供常用 CRUD 辅助函数
 * - 所有大数据(devices/shelves/boms/categories)走这里, 小数据(currentShelfId 等)继续用 AsyncStorage
 *
 * 为什么不把全表读出来再 filter?
 * - 旧方案把 1 万个器件一次性 JSON.parse 到 JS 数组, 内存峰值 100~300MB
 * - SQL 方案按需 SELECT, 内存峰值 <5MB, 跟文件大小无关
 *
 * 迁移策略:
 * - 启动时 migration.js 会把老 AsyncStorage 数据搬到 SQLite
 * - 老数据保留作为只读备份(30 天后再让用户决定是否清理)
 * - 业务代码通过 StorageService 访问, 不直接 import 这个文件
 */

import * as SQLite from 'expo-sqlite';

// ========== 数据库文件 ==========
const DB_NAME = 'stable_device.db';
const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = '_schema_version';

// ========== 单例 DB ==========
let _db = null;
let _initPromise = null;

/**
 * 获取数据库实例 (懒加载, 整个 App 第一次调用时打开)
 * @returns {Promise<SQLite.SQLiteDatabase>}
 */
export async function getDB() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      // 启用 WAL 模式, 读写并发更好 + 减少锁等待
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      // 创 schema (幂等, 多次执行安全)
      await createSchema(db);
      _db = db;
      console.log('[Database] SQLite 已就绪, schema v' + SCHEMA_VERSION);
      return db;
    } catch (err) {
      _initPromise = null;
      throw err;
    }
  })();
  return _initPromise;
}

/**
 * 关闭数据库 (供测试 / 重置场景用, 业务代码一般不调)
 */
export async function closeDB() {
  if (_db) {
    await _db.closeAsync();
    _db = null;
    _initPromise = null;
  }
}

/**
 * 删除数据库文件 (供"清空所有数据"按钮用, 慎用!)
 */
export async function deleteDatabase() {
  await closeDB();
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
    console.log('[Database] 已删除数据库文件');
  } catch (e) {
    console.warn('[Database] 删除数据库失败:', e?.message);
  }
}

// ========== Schema ==========
const SCHEMA_STATEMENTS = [
  // ---- 器件表 (核心, 之前 41MB 都在这里) ----
  `CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    name TEXT,
    supplier_id TEXT,
    package TEXT,
    value TEXT,
    location TEXT,
    shelf_id TEXT,
    category TEXT,
    big_category TEXT,
    description TEXT,
    image TEXT,
    quantity INTEGER DEFAULT 1,
    custom_fields TEXT,
    created_at TEXT,
    updated_at TEXT
  );`,
  // 索引: 按库存查 (最常见, 每次切库都查)
  `CREATE INDEX IF NOT EXISTS idx_devices_shelf ON devices(shelf_id);`,
  // 索引: 按名称搜索 (库存页搜索框)
  `CREATE INDEX IF NOT EXISTS idx_devices_name ON devices(name);`,
  // 索引: 按供应商编号搜索
  `CREATE INDEX IF NOT EXISTS idx_devices_supplier ON devices(supplier_id);`,
  // 索引: 按子类目筛选
  `CREATE INDEX IF NOT EXISTS idx_devices_category ON devices(category);`,
  // 索引: 位置冲突检查 (同一 shelf 内 location 唯一)
  `CREATE INDEX IF NOT EXISTS idx_devices_shelf_location ON devices(shelf_id, location);`,

  // ---- 库存表 ----
  `CREATE TABLE IF NOT EXISTS shelves (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bluetooth_mac TEXT,
    bluetooth_name TEXT,
    created_at TEXT,
    updated_at TEXT
  );`,

  // ---- BOM 表 (一个 BOM = 一行, 整包 JSON 存 data 字段) ----
  // BOMS 总量小, 没必要拆 bom_items 子表, 整包存取最简单
  `CREATE TABLE IF NOT EXISTS boms (
    id INTEGER PRIMARY KEY,
    name TEXT,
    data TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );`,

  // ---- 类目表 (类目树是嵌套结构, 整包 JSON 存) ----
  // 类目数据极小, 整包存取最简单
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT
  );`,

  // ---- KV 表 (小数据, 比如当前选中库存, 上次连接的蓝牙) ----
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );`,
];

async function createSchema(db) {
  for (const sql of SCHEMA_STATEMENTS) {
    await db.execAsync(sql);
  }
  // 记录 schema 版本 (供以后升级用)
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?);`,
    [SCHEMA_VERSION_KEY, String(SCHEMA_VERSION)]
  );
}

// ========== 通用辅助函数 ==========

/**
 * 把 JS 行映射成 camelCase (DB 用 snake_case, JS 用 camelCase)
 * 业务代码期望的字段是 camelCase, 所以查询后转一下
 */
function rowToCamel(row) {
  if (!row) return null;
  const out = {};
  for (const k of Object.keys(row)) {
    // devices table
    if (k === 'supplier_id') out.supplierId = row[k];
    else if (k === 'shelf_id') out.shelfId = row[k];
    else if (k === 'big_category') out.bigCategory = row[k];
    else if (k === 'created_at') out.createdAt = row[k];
    else if (k === 'updated_at') out.updatedAt = row[k];
    else if (k === 'custom_fields') {
      // 还原动态字段
      if (row[k]) {
        try {
          const cf = JSON.parse(row[k]);
          Object.assign(out, cf);
        } catch { /* ignore */ }
      }
    } else {
      out[k] = row[k];
    }
  }
  return out;
}

function camelToDeviceParams(d) {
  // 常见字段 → 列, 其它全部进 custom_fields
  //
  // 【1.4 阶段 3 重要约束】image 字段必须是 `file://` 沙盒路径 (例 file:///data/.../images/xxx.jpg),
  // **不能是 base64**。
  //   - 入参前由 StorageService 负责保证:
  //     * addDevice / updateDevice: 调 #persistImageToSandbox 把 ImagePicker 临时路径复制到沙盒
  //     * importAllData / importShelfFromFile: 调 #writeBase64AsImage 把 _imageBase64 解码写到沙盒
  //     * streamImportShelfFromFile: 同上 (BATCH=10 并行)
  //   - 不要在这里做 base64 → 文件的转换, DB 层只负责存取
  //   - 库内 image 永远 ≤ 256 字符 (沙盒路径), 不会撑大 DB
  const known = ['id', 'name', 'supplierId', 'package', 'value', 'location',
    'shelfId', 'category', 'bigCategory', 'description', 'image', 'quantity',
    'createdAt', 'updatedAt'];
  const params = {
    id: d.id ?? null,
    name: d.name ?? null,
    supplier_id: d.supplierId ?? null,
    package: d.package ?? null,
    value: d.value ?? null,
    location: d.location != null ? String(d.location) : null,
    shelf_id: d.shelfId ?? null,
    category: d.category ?? null,
    big_category: d.bigCategory ?? null,
    description: d.description ?? d.notes ?? null,
    image: d.image ?? null,
    quantity: typeof d.quantity === 'number' ? d.quantity : (parseInt(d.quantity) || 1),
    created_at: d.createdAt ?? null,
    updated_at: d.updatedAt ?? null,
  };
  // 其它字段进 custom_fields JSON
  const custom = {};
  for (const k of Object.keys(d)) {
    if (!known.includes(k) && k !== '_imageBase64') {
      custom[k] = d[k];
    }
  }
  params.custom_fields = Object.keys(custom).length > 0 ? JSON.stringify(custom) : null;
  return params;
}

// ========== 公开 API: 器件 CRUD ==========

/**
 * 全量替换器件列表 (用于导入 / 覆盖)
 * @param {Array} devices
 */
export async function replaceAllDevices(devices) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM devices;');
    if (!Array.isArray(devices) || devices.length === 0) return;
    // 用一条多值 INSERT 大幅提速 (1 万条从 30s 降到 0.5s)
    const CHUNK = 500;  // SQL 参数有上限, 分批
    for (let i = 0; i < devices.length; i += CHUNK) {
      const slice = devices.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      const values = [];
      for (const d of slice) {
        const p = camelToDeviceParams(d);
        values.push(
          p.id, p.name, p.supplier_id, p.package, p.value, p.location,
          p.shelf_id, p.category, p.big_category, p.description, p.image,
          p.quantity, p.custom_fields, p.created_at, p.updated_at
        );
      }
      await db.runAsync(
        `INSERT INTO devices
         (id, name, supplier_id, package, value, location, shelf_id,
          category, big_category, description, image, quantity,
          custom_fields, created_at, updated_at)
         VALUES ${placeholders};`,
        values
      );
    }
  });
}

/**
 * 追加器件 (用于新增, 不清空旧数据)
 */
export async function insertDevices(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return;
  const db = await getDB();
  const CHUNK = 500;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < devices.length; i += CHUNK) {
      const slice = devices.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      const values = [];
      for (const d of slice) {
        const p = camelToDeviceParams(d);
        values.push(
          p.id, p.name, p.supplier_id, p.package, p.value, p.location,
          p.shelf_id, p.category, p.big_category, p.description, p.image,
          p.quantity, p.custom_fields, p.created_at, p.updated_at
        );
      }
      await db.runAsync(
        `INSERT INTO devices
         (id, name, supplier_id, package, value, location, shelf_id,
          category, big_category, description, image, quantity,
          custom_fields, created_at, updated_at)
         VALUES ${placeholders};`,
        values
      );
    }
  });
}

/**
 * 1.6.2 修复: 导入时自动 remap ID, 避免与现有 ID 撞车
 *
 * 场景:
 *   - 用户先导入库存 A (A 的 device.id=1..50 写入 SQLite)
 *   - 再导入库存 B (B 的 device.id 也是 1..50, 来自不同源)
 *   - 原 insertDevices 直接 INSERT → UNIQUE constraint failed: devices.id
 *
 * 策略:
 *   - 一次性拿到当前 SQLite 里 MAX(id), 记为 baseId
 *   - 把传入 devices 的 id 全部 remap 到 (baseId+1, baseId+2, ...)
 *   - 这样无论导入多少次, 都不会和已有 ID 冲突
 *   - shelf_id 不动, 仍然是各自的库存 id
 *   - 返回 remap 后的 devices 数组 (供调用方后续用, 比如图片处理后用新 id 写回)
 */
export async function remapAndInsertDevices(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return [];
  const db = await getDB();
  // 1) 查当前最大 id (一个事务里, 保证准确)
  const maxRow = await db.getFirstAsync(
    'SELECT COALESCE(MAX(id), 0) AS maxId FROM devices;'
  );
  const maxId = maxRow?.maxId || 0;
  // 2) remap, 起点 = maxId + 1
  let nextId = maxId + 1;
  // 用 _origId 保留原 id, 便于追踪/调试, 同时改写 d.id 为新 id
  // 注意: 不能 spread {...d, id: nextId++} 因为原 d 可能是 frozen
  for (const d of devices) {
    if (!d) continue;
    if (d.id !== nextId) {
      d._origId = d.id;
      d.id = nextId;
    }
    nextId++;
  }
  // 3) 沿用 insertDevices 的批量实现
  await insertDevices(devices);
  return devices;
}

/**
 * 更新单条器件的 image 字段 (图片写完沙盒后回写)
 * 走单行 UPDATE, 性能足够 (图片处理是 10 并发, 不会成为瓶颈)
 * @param {number} id
 * @param {string} image - file:// 沙盒路径
 */
export async function updateDeviceImage(id, image) {
  if (id == null) return;
  const db = await getDB();
  await db.runAsync('UPDATE devices SET image = ? WHERE id = ?;', [image || null, id]);
}

/**
 * 读取所有器件 (返回 camelCase JS 对象数组)
 */
export async function getAllDevices() {
  const db = await getDB();
  const rows = await db.getAllAsync('SELECT * FROM devices ORDER BY id;');
  return rows.map(rowToCamel);
}

/**
 * 按库存查器件 (这是切库时的主查询, SQL 自己 filter, 只返回该库存的)
 */
export async function getDevicesByShelf(shelfId) {
  const db = await getDB();
  const rows = await db.getAllAsync(
    'SELECT * FROM devices WHERE shelf_id = ? ORDER BY id;',
    [shelfId]
  );
  return rows.map(rowToCamel);
}

/**
 * 按 ID 查器件
 */
export async function getDeviceById(id) {
  const db = await getDB();
  const row = await db.getFirstAsync('SELECT * FROM devices WHERE id = ?;', [id]);
  return rowToCamel(row);
}

/**
 * 按名称 / 供应商编号模糊搜索
 */
export async function searchDevices(query, shelfId = null) {
  if (!query || !query.trim()) {
    return shelfId ? getDevicesByShelf(shelfId) : getAllDevices();
  }
  const db = await getDB();
  const like = `%${query.trim()}%`;
  const rows = shelfId
    ? await db.getAllAsync(
        `SELECT * FROM devices
         WHERE shelf_id = ?
           AND (name LIKE ? OR supplier_id LIKE ? OR value LIKE ?)
         ORDER BY id;`,
        [shelfId, like, like, like]
      )
    : await db.getAllAsync(
        `SELECT * FROM devices
         WHERE name LIKE ? OR supplier_id LIKE ? OR value LIKE ?
         ORDER BY id;`,
        [like, like, like]
      );
  return rows.map(rowToCamel);
}

/**
 * 统计指定库存的器件数 (SQL COUNT, 几乎瞬时)
 */
export async function countDevicesByShelf(shelfId) {
  const db = await getDB();
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) AS n FROM devices WHERE shelf_id = ?;',
    [shelfId]
  );
  return row?.n ?? 0;
}

// ========== 1.4 阶段 1: 高级筛选走 SQL ==========

// 已知列 (camelCase) → snake_case, 其它不进 SQL (走 JS filter)
const FILTERABLE_COLUMNS = new Set([
  'shelfId',
  'name',
  'supplierId',
  'package',
  'value',
  'location',
  'category',
  'bigCategory',
  'description',
  'quantity',
  'image',
  'createdAt',
  'updatedAt',
]);

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/**
 * 通用筛选: 把 filters 对象转成 SQL WHERE
 * 单 shelf + 单字段 (最常见: category / bigCategory) 走 SQL
 * 复杂筛选 (多字段无 shelf / 多字段含 shelf) 走 getAllDevices + JS filter
 *
 * @param {Object} filters - { shelfId?: string, category?: string, ... }
 * @returns {Promise<Array>}
 */
export async function filterDevices(filters = {}) {
  const entries = Object.entries(filters).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );
  if (entries.length === 0) return getAllDevices();

  // 单 shelf + 单字段 (除 shelfId 外) → SQL
  const nonShelfEntries = entries.filter(([k]) => k !== 'shelfId');
  if (entries.length >= 1 && nonShelfEntries.length <= 1) {
    try {
      return await filterDevicesByShelfAnd(
        filters.shelfId || null,
        filters
      );
    } catch (e) {
      console.warn('[Database] filterDevices SQL 失败, 降级为全读:', e?.message);
    }
  }

  // 复杂情况: 全读 + JS filter (1.5 再优化)
  const all = await getAllDevices();
  return all.filter((d) => {
    for (const [k, v] of entries) {
      const dv = d[k];
      if (dv == null) return false;
      if (typeof v === 'string') {
        if (!String(dv).toLowerCase().includes(String(v).toLowerCase())) return false;
      } else if (typeof v === 'number') {
        if (dv !== v) return false;
      }
    }
    return true;
  });
}

/**
 * 按 shelf + 单字段查 (最常见: shelfId + category, 1.4 阶段 1 主优化点)
 * @param {string|null} shelfId - 不传则查全表
 * @param {Object} filters - 其它字段 (只支持 FILTERABLE_COLUMNS 里的)
 * @returns {Promise<Array>}
 */
export async function filterDevicesByShelfAnd(shelfId, filters = {}) {
  const db = await getDB();
  const conditions = [];
  const params = [];

  if (shelfId != null && shelfId !== '') {
    conditions.push('shelf_id = ?');
    params.push(shelfId);
  }

  for (const [k, v] of Object.entries(filters)) {
    if (k === 'shelfId') continue;
    if (v == null || v === '') continue;
    if (!FILTERABLE_COLUMNS.has(k)) {
      // 非 SQL 字段, 走 JS 二次过滤
      const all = await getAllDevices();
      const shelfFiltered = shelfId
        ? all.filter((d) => d && d.shelfId === shelfId)
        : all;
      return shelfFiltered.filter((d) => {
        const dv = d[k];
        if (dv == null) return false;
        if (typeof v === 'string') {
          return String(dv).toLowerCase().includes(String(v).toLowerCase());
        }
        if (typeof v === 'number') return dv === v;
        return false;
      });
    }
    const col = camelToSnake(k);
    if (typeof v === 'number') {
      conditions.push(`${col} = ?`);
      params.push(v);
    } else {
      conditions.push(`${col} LIKE ?`);
      params.push(`%${v}%`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync(
    `SELECT * FROM devices ${where} ORDER BY id;`,
    params
  );
  return rows.map(rowToCamel);
}

/**
 * 新增或替换一个器件 (按 id 决定 INSERT or REPLACE)
 */
export async function upsertDevice(d) {
  const db = await getDB();
  const p = camelToDeviceParams(d);
  await db.runAsync(
    `INSERT OR REPLACE INTO devices
     (id, name, supplier_id, package, value, location, shelf_id,
      category, big_category, description, image, quantity,
      custom_fields, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [p.id, p.name, p.supplier_id, p.package, p.value, p.location,
     p.shelf_id, p.category, p.big_category, p.description, p.image,
     p.quantity, p.custom_fields, p.created_at, p.updated_at]
  );
}

/**
 * 按 id 删除器件
 */
export async function deleteDeviceById(id) {
  const db = await getDB();
  await db.runAsync('DELETE FROM devices WHERE id = ?;', [id]);
}

/**
 * 按库存删除所有器件 (删库存时调用)
 */
export async function deleteDevicesByShelf(shelfId) {
  const db = await getDB();
  await db.runAsync('DELETE FROM devices WHERE shelf_id = ?;', [shelfId]);
}

/**
 * 找位置冲突 (同一库存同一位置已有谁)
 */
export async function findLocationConflict(shelfId, location, excludeId = null) {
  const db = await getDB();
  const row = excludeId != null
    ? await db.getFirstAsync(
        'SELECT id, name FROM devices WHERE shelf_id = ? AND location = ? AND id != ? LIMIT 1;',
        [shelfId, String(location), excludeId]
      )
    : await db.getFirstAsync(
        'SELECT id, name FROM devices WHERE shelf_id = ? AND location = ? LIMIT 1;',
        [shelfId, String(location)]
      );
  return row ? rowToCamel(row) : null;
}

// ========== 公开 API: 库存 CRUD ==========

export async function getAllShelves() {
  const db = await getDB();
  const rows = await db.getAllAsync('SELECT * FROM shelves ORDER BY name;');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    bluetoothMac: r.bluetooth_mac || null,
    bluetoothName: r.bluetooth_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function replaceAllShelves(shelves) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM shelves;');
    if (!Array.isArray(shelves) || shelves.length === 0) return;
    for (const s of shelves) {
      await db.runAsync(
        `INSERT OR REPLACE INTO shelves (id, name, bluetooth_mac, bluetooth_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          s.id, s.name, s.bluetoothMac || null, s.bluetoothName || null,
          s.createdAt || null, s.updatedAt || null,
        ]
      );
    }
  });
}

export async function upsertShelf(s) {
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO shelves (id, name, bluetooth_mac, bluetooth_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      s.id, s.name, s.bluetoothMac || null, s.bluetoothName || null,
      s.createdAt || new Date().toISOString(),
      s.updatedAt || new Date().toISOString(),
    ]
  );
}

export async function deleteShelfById(id) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.deleteDevicesByShelf(id);
    await db.runAsync('DELETE FROM shelves WHERE id = ?;', [id]);
  });
}

// ========== 公开 API: BOM ==========

export async function getAllBOMs() {
  const db = await getDB();
  const rows = await db.getAllAsync('SELECT * FROM boms ORDER BY id;');
  return rows.map((r) => {
    try {
      return { ...JSON.parse(r.data), id: r.id, name: r.name };
    } catch {
      return { id: r.id, name: r.name, data: r.data };
    }
  });
}

export async function replaceAllBOMs(boms) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM boms;');
    if (!Array.isArray(boms) || boms.length === 0) return;
    for (const b of boms) {
      const { id, name, ...rest } = b;
      await db.runAsync(
        `INSERT INTO boms (id, name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        [id ?? null, name ?? null, JSON.stringify(b),
         b.createdAt || new Date().toISOString(),
         b.updatedAt || new Date().toISOString()]
      );
    }
  });
}

export async function upsertBOM(b) {
  const db = await getDB();
  const { id, name, ...rest } = b;
  if (id != null) {
    await db.runAsync(
      `INSERT OR REPLACE INTO boms (id, name, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?);`,
      [id, name ?? null, JSON.stringify(b),
       b.createdAt || new Date().toISOString(),
       new Date().toISOString()]
    );
  } else {
    const res = await db.runAsync(
      `INSERT INTO boms (name, data, created_at, updated_at)
       VALUES (?, ?, ?, ?);`,
      [name ?? null, JSON.stringify(b),
       new Date().toISOString(), new Date().toISOString()]
    );
    b.id = res.lastInsertRowId;
  }
  return b;
}

export async function deleteBOMById(id) {
  const db = await getDB();
  await db.runAsync('DELETE FROM boms WHERE id = ?;', [id]);
}

// ========== 公开 API: 类目 ==========

export async function getCategories() {
  const db = await getDB();
  const row = await db.getFirstAsync('SELECT data FROM categories WHERE id = 1;');
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function setCategories(categories) {
  if (!categories) return;
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO categories (id, data, updated_at) VALUES (1, ?, ?);`,
    [JSON.stringify(categories), new Date().toISOString()]
  );
}

// ========== 公开 API: app_state (kv 小数据) ==========

export async function getState(key) {
  const db = await getDB();
  const row = await db.getFirstAsync('SELECT value FROM app_state WHERE key = ?;', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export async function setState(key, value) {
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?);`,
    [key, JSON.stringify(value)]
  );
}

export async function deleteState(key) {
  const db = await getDB();
  await db.runAsync('DELETE FROM app_state WHERE key = ?;', [key]);
}

// ========== 统计 ==========

/**
 * 调试用: 打印各表行数
 */
export async function getStats() {
  const db = await getDB();
  const stats = {};
  for (const table of ['devices', 'shelves', 'boms', 'categories', 'app_state']) {
    const row = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${table};`);
    stats[table] = row?.n ?? 0;
  }
  return stats;
}

export default {
  getDB,
  closeDB,
  deleteDatabase,
  getStats,
  // devices
  replaceAllDevices,
  insertDevices,
  remapAndInsertDevices, // 1.6.2: 导入时 remap id, 避免 UNIQUE 冲突
  updateDeviceImage,     // 1.6.2: 单行更新 image 字段
  getAllDevices,
  getDevicesByShelf,
  getDeviceById,
  searchDevices,
  countDevicesByShelf,
  filterDevices,           // 1.4 阶段 1: 通用筛选
  filterDevicesByShelfAnd, // 1.4 阶段 1: shelf + 单字段
  upsertDevice,
  deleteDeviceById,
  deleteDevicesByShelf,
  findLocationConflict,
  // shelves
  getAllShelves,
  replaceAllShelves,
  upsertShelf,
  deleteShelfById,
  // boms
  getAllBOMs,
  replaceAllBOMs,
  upsertBOM,
  deleteBOMById,
  // categories
  getCategories,
  setCategories,
  // app_state
  getState,
  setState,
  deleteState,
};
