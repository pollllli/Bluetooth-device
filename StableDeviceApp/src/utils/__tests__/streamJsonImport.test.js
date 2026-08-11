/**
 * 1.6.7 验证: 流式 JSON parser 跨 chunk 时, meta 字段 (特别是 categories 大数组)
 * 必须能被完整提取, 不能因为字符串 / 转义 / 深度状态丢失而截断。
 *
 * 之前的 bug: 局部 inStr/esc/d 变量在 _consume() 重入时重置, 导致大 categories
 * 数组在 chunk 边界被错误地结束, 后续 mergeCategoriesFromBackup 拿到空数组
 * 或半截数组, 用户看不到自定义分类。
 */
import { StreamParser, STATE } from '../streamJsonImport';

function makeBackup(categories) {
  return JSON.stringify({
    data: {
      categories,
      shelves: [
        { id: 'shelf_1', name: 'A', bluetoothMac: 'AA:BB:CC:DD:EE:FF' },
      ],
      currentShelfId: 'shelf_1',
      lastConnectedDevice: 'AA:BB:CC:DD:EE:FF',
      devices: [
        { id: 1, name: 'D1', shelfId: 'shelf_1', location: '0', quantity: 1 },
        { id: 2, name: 'D2', shelfId: 'shelf_1', location: '1', quantity: 2 },
      ],
    },
    version: '1.3.0',
    appVersion: '1.2.3',
  });
}

/**
 * 真实生产文件格式: devices 在前, categories 在后 (参照 b.json)
 * 这是 1.6.7 修复的关键测试 — 老 parser 在 devices 数组 `]` 处直接 DONE,
 * 会跳过 categories, 必须验证修复后能正确解析
 */
function makeProductionOrderBackup(categories) {
  return JSON.stringify({
    data: {
      devices: [
        { id: 1, name: 'D1', shelfId: 'shelf_1', location: '0', quantity: 1 },
        { id: 2, name: 'D2', shelfId: 'shelf_1', location: '1', quantity: 2 },
      ],
      categories,
      _filteredShelfId: 'shelf_1',
      shelves: [{ id: 'shelf_1', name: 'A', bluetoothMac: 'AA:BB:CC:DD:EE:FF' }],
      currentShelfId: 'shelf_1',
      lastConnectedDevice: 'AA:BB:CC:DD:EE:FF',
    },
    version: '1.3.0',
    appVersion: '1.2.3',
  });
}

function runParser(text, onDevice) {
  const devices = [];
  const parser = new StreamParser({ onDevice: (d) => { devices.push(d); } });
  // 模拟流式分块: 按 splitAt 切两段, 中间 yield 一下
  const splitAt = Math.floor(text.length / 2);
  parser.feed(text.slice(0, splitAt));
  parser.feed(text.slice(splitAt));
  parser.end();
  return { parser, devices };
}

describe('StreamParser - meta (categories) 跨 chunk 提取', () => {
  test('完整文件: categories 数组能被完整提取', () => {
    const cats = [
      { name: '电容', subCategories: ['贴片电容(MLCC)', '直插独石电容(MLCC)', '钽电容'] },
      { name: '电阻', subCategories: ['贴片电阻', '插件电阻', '排阻'] },
      { name: '二极管', subCategories: ['稳压二极管', '肖特基二极管', '整流桥'] },
    ];
    const text = makeBackup(cats);
    const { parser, devices } = runParser(text);

    expect(devices.length).toBe(2);
    expect(parser.state).toBe(STATE.DONE);
    expect(Array.isArray(parser.meta.categories)).toBe(true);
    expect(parser.meta.categories).toEqual(cats);
  });

  test('切分点在 categories 字符串中 (转义/中文)', () => {
    const cats = [
      { name: '电容', subCategories: ['贴片电容(MLCC) "高端"', '钽电容 \\"特殊\\"'] },
    ];
    const text = makeBackup(cats);
    // 故意找一段切在 categories 字符串中间
    const idx = text.indexOf('贴片');
    expect(idx).toBeGreaterThan(0);
    const splitAt = idx + 2; // 切在"贴片"中间
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    parser.feed(text.slice(0, splitAt));
    parser.feed(text.slice(splitAt));
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(parser.meta.categories).toEqual(cats);
  });

  test('切分点在嵌套对象/数组边界', () => {
    // 模拟深嵌套, subCategories 内含嵌套数组
    const cats = [
      {
        name: '复合类',
        subCategories: ['子类1', '子类2', { nested: 'object' }, [1, 2, 3], '子类5'],
      },
    ];
    const text = makeBackup(cats);
    // 切在 nested object 附近
    const idx = text.indexOf('"nested"');
    expect(idx).toBeGreaterThan(0);
    const splitAt = idx + 4;
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    parser.feed(text.slice(0, splitAt));
    parser.feed(text.slice(splitAt));
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(parser.meta.categories).toEqual(cats);
  });

  test('切分点多段细碎 (每 1KB 切一刀, 模拟流式分块)', () => {
    // 模拟生产环境的细碎分块: 1KB 一段, 比生产 512KB 小, 但仍能保证 "data" 不会跨块
    // 真正生产是 512KB, "data" key 一定在第一段, 这里用 1KB 验证 categories 数组内的跨段
    const cats = [
      { name: 'A类', subCategories: ['a1', 'a2', 'a3', 'a4', 'a5'] },
      { name: 'B类', subCategories: ['b1', 'b2'] },
      { name: 'C类', subCategories: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'] },
    ];
    const text = makeBackup(cats);
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    for (let i = 0; i < text.length; i += 1024) {
      parser.feed(text.slice(i, i + 1024));
    }
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(devices.length).toBe(2);
    expect(parser.meta.categories).toEqual(cats);
  });

  test('真实规模: 100 个大类的 categories 数组, 切在数组中间', () => {
    const cats = [];
    for (let i = 0; i < 100; i++) {
      cats.push({
        name: '大类_' + i,
        subCategories: Array.from({ length: 30 }, (_, j) => `子类_${i}_${j}`),
      });
    }
    const text = makeBackup(cats);
    // 切在 categories 数组中间 (找第 50 个大类的位置)
    const idx = text.indexOf('"大类_50"');
    expect(idx).toBeGreaterThan(0);
    const splitAt = idx + 4;
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    parser.feed(text.slice(0, splitAt));
    parser.feed(text.slice(splitAt));
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(parser.meta.categories).toEqual(cats);
    expect(parser.meta.categories.length).toBe(100);
  });

  test('切分点紧贴 categories 结束的 ], 之前 (容易误判为结束)', () => {
    const cats = [
      { name: 'X', subCategories: ['a', 'b'] },
    ];
    const text = makeBackup(cats);
    // 找 categories 数组结束的 ]
    const closeIdx = text.indexOf('"]', text.indexOf('"b"'));
    expect(closeIdx).toBeGreaterThan(0);
    const splitAt = closeIdx + 1; // 切在 ] 之前
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    parser.feed(text.slice(0, splitAt));
    parser.feed(text.slice(splitAt));
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(parser.meta.categories).toEqual(cats);
  });

  // 1.6.7 关键测试: 生产文件顺序 devices 在前 categories 在后,
  // 老 parser 在 devices 数组 ] 处直接 DONE, 会跳过 categories
  test('生产文件顺序: devices 在前, categories 在后, 都能正确解析', () => {
    const cats = [
      { name: '电容', subCategories: ['贴片电容(MLCC)', '钽电容'] },
      { name: '电阻', subCategories: ['贴片电阻', '插件电阻'] },
      { name: '二极管', subCategories: ['稳压二极管', '肖特基二极管'] },
    ];
    const text = makeProductionOrderBackup(cats);
    const { parser, devices } = runParser(text);

    expect(devices.length).toBe(2);
    expect(parser.state).toBe(STATE.DONE);
    expect(Array.isArray(parser.meta.categories)).toBe(true);
    expect(parser.meta.categories).toEqual(cats);
    expect(parser.meta.shelves).toBeDefined();
    expect(parser.meta.shelves[0].id).toBe('shelf_1');
    expect(parser.meta.currentShelfId).toBe('shelf_1');
  });

  // 切分点刚好在 devices 数组 ] 之后, categories 之前
  test('生产顺序 + 切分点在 devices ] 与 categories 字段之间', () => {
    const cats = [
      { name: 'C1', subCategories: ['c1a', 'c1b'] },
      { name: 'C2', subCategories: ['c2a'] },
    ];
    const text = makeProductionOrderBackup(cats);
    // 切在 devices 数组的 ] 之后, 逗号之前
    const idx = text.indexOf('],');
    expect(idx).toBeGreaterThan(0);
    const splitAt = idx + 1; // 切在 , 之后
    const devices = [];
    const parser = new StreamParser({ onDevice: (d) => devices.push(d) });
    parser.feed(text.slice(0, splitAt));
    parser.feed(text.slice(splitAt));
    parser.end();
    expect(parser.state).toBe(STATE.DONE);
    expect(devices.length).toBe(2);
    expect(parser.meta.categories).toEqual(cats);
  });
});
