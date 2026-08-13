/**
 * 生成 500 器件的测试 JSON 文件
 * 模仿 b.json 结构, 加入部分器件含 base64 图片 (测试流式导入)
 */
const fs = require('fs');
const path = require('path');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'b.json'), 'utf8'));

// 复制 shelves / categories / 其他结构
const { shelves, categories } = template.data;
const sourceShelf = shelves[1]; // b.json 里 "b" 这个库存
const shelfId = sourceShelf.id;
const shelfName = '测试500器件库';

// ---------- 构造 500 个器件 ----------

// 模拟图片 base64
// 小图 (~200KB, 类似 1024x768 jpeg)
const sampleBase64 = (() => {
  const head = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a';
  const tail = '/2wBDAQkJCQwLDBgNDA4NEikSExJP/9k=';
  const mid = 'A'.repeat(1000); // 1KB 重复单元
  return head + mid.repeat(200) + tail; // ~200KB
})();
// 大图 (~1MB, 类似 2000x2000 大图)
const sampleBigBase64 = sampleBase64.repeat(5);

const componentTypes = [
  { name: 'XL7EL89CKI-111YLC-32M', category: '芯片', pkg: 'QFN-32' },
  { name: 'STM32F103C8T6', category: '芯片', pkg: 'LQFP-48' },
  { name: 'AMS1117-3.3', category: '电源', pkg: 'SOT-223' },
  { name: 'HDB3844', category: '滤波', pkg: 'C0805' },
  { name: 'DS8797', category: '光敏', pkg: 'C0805' },
  { name: 'CH340G', category: '通信', pkg: 'SOP-16' },
  { name: 'ESP32-WROOM-32', category: '通信', pkg: 'SMD' },
  { name: 'AT24C256', category: '存储', pkg: 'SOIC-8' },
  { name: 'BC847B', category: '三极管', pkg: 'SOT-23' },
  { name: 'BSS138', category: '三极管', pkg: 'SOT-23' },
  { name: '1N4148', category: '二极管', pkg: 'SOD-123' },
  { name: 'SS14', category: '二极管', pkg: 'SMA' },
  { name: 'MAX232', category: '通信', pkg: 'SOIC-16' },
  { name: 'MAX485', category: '通信', pkg: 'SOIC-8' },
  { name: 'TLP521', category: '光耦', pkg: 'DIP-4' },
  { name: 'NE555', category: '芯片', pkg: 'DIP-8' },
  { name: 'LM358', category: '运放', pkg: 'SOIC-8' },
  { name: 'LM393', category: '比较器', pkg: 'SOIC-8' },
  { name: 'TL431', category: '基准', pkg: 'SOT-23' },
  { name: 'LM2596', category: '电源', pkg: 'TO-263-5' },
  { name: 'CR2032', category: '电池', pkg: '纽扣' },
  { name: '100Ω电阻', category: '电阻', pkg: '0603' },
  { name: '10kΩ电阻', category: '电阻', pkg: '0603' },
  { name: '4.7kΩ电阻', category: '电阻', pkg: '0805' },
  { name: '1kΩ电位器', category: '电阻', pkg: '可调' },
  { name: '100nF电容', category: '电容', pkg: '0603' },
  { name: '10uF电容', category: '电容', pkg: '0805' },
  { name: '22pF电容', category: '电容', pkg: '0603' },
  { name: '1uF钽电容', category: '电容', pkg: 'A型' },
  { name: '22uF电解', category: '电容', pkg: '插件' },
  { name: '10mH电感', category: '电感', pkg: 'CD43' },
  { name: 'LED-红色', category: 'LED', pkg: '0603' },
  { name: 'LED-绿色', category: 'LED', pkg: '0603' },
  { name: 'LED-蓝色', category: 'LED', pkg: '0603' },
  { name: '晶振8MHz', category: '晶振', pkg: 'HC-49S' },
  { name: '晶振32.768kHz', category: '晶振', pkg: '圆柱' },
  { name: '光耦PC817', category: '光耦', pkg: 'DIP-4' },
  { name: '整流桥', category: '二极管', pkg: 'DIP-4' },
  { name: 'TVS瞬态抑制', category: '保护', pkg: 'SOD-123' },
  { name: '自恢复保险丝', category: '保护', pkg: '插件' },
  { name: '按键开关', category: '开关', pkg: '6x6' },
];

const suppliers = ['C2965582', 'C28233', 'C15850', 'C10001', 'C20002', 'C30003', 'LCSC', 'DigiKey'];
const positions = ['C1,C2', 'R1', 'U1', 'D1', 'L1', 'C3', 'U2', 'R5,R6', 'JP1', 'SW1'];

const devices = [];
const baseTime = Date.UTC(2026, 6, 7, 3, 33, 0); // 2026-07-07 03:33:00 UTC

for (let i = 1; i <= 500; i++) {
  const comp = componentTypes[i % componentTypes.length];
  const supplier = suppliers[i % suppliers.length];
  const position = positions[i % positions.length];
  const offset = i * 1000 + Math.floor(Math.random() * 500);
  const createdAt = new Date(baseTime + offset).toISOString();
  // 仿真 8 行模板结构
  const dev = {
    name: comp.name,
    supplierId: supplier,
    brand: i % 3 === 0 ? 'TI' : (i % 3 === 1 ? 'ST' : '国产'),
    position,
    package: comp.pkg,
    category: comp.category,
    notes: '',
    value: '',
    resistance: '',
    voltage: '',
    capacitance: '',
    inductance: '',
    current: '',
    power: '',
    frequency: '',
    shelfId,
    location: String(i - 1), // 0-based
    quantity: (i % 10) * 5 + 10,
    id: i,
    createdAt,
    updatedAt: createdAt,
  };
  // 仿真图片分布: 70% 含图, 1/3 是大图
  // 估算: 350 张图, 230 张小 (200KB) + 100 张大 (1MB) = 46MB + 100MB = 146MB
  // 加上其他字段 (类别 40 项等), 整体 ~150MB, 接近 500 器件+图片真实场景
  const r = i % 10;
  if (r < 7) {
    // 70% 小图
    dev._imageBase64 = sampleBase64;
  } else if (r < 10) {
    // 30% 大图 (r = 7,8,9)
    dev._imageBase64 = sampleBigBase64;
  }
  // 30% 无图 (i % 10 == 0, 不分配)
  devices.push(dev);
}

const output = {
  data: {
    devices,
    categories,
    _filteredShelfId: shelfId,
    shelves: [sourceShelf], // 单库存导出格式
    currentShelfId: shelfId,
    lastConnectedDevice: sourceShelf.bluetoothMac || '',
  },
  summary: {
    deviceCount: devices.length,
    userCount: 0,
    bomCount: 0,
    searchHistoryCount: 0,
    categoryCount: categories.length,
    subCategoryCount: categories.reduce(
      (s, c) => s + (Array.isArray(c.subCategories) ? c.subCategories.length : 0), 0
    ),
    isCustomCategories: false,
    embeddedImageCount: devices.filter((d) => d._imageBase64).length,
    failedImageCount: 0,
  },
  exportDate: new Date().toISOString(),
  version: '1.3.0',
  appVersion: '1.2.3',
};

const outPath = path.join(__dirname, 'test-500-devices.json');
fs.writeFileSync(outPath, JSON.stringify(output));
const stat = fs.statSync(outPath);
console.log(`已生成: ${outPath}`);
console.log(`文件大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`器件总数: ${devices.length}`);
console.log(`含图片器件: ${devices.filter((d) => d._imageBase64).length}`);
console.log(`版本: ${output.version}`);
console.log(`文件名(用于按文件名判断新增/覆盖): ${shelfName}.json`);
