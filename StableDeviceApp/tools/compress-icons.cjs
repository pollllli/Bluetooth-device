/**
 * 压缩底部导航栏 tab 图标
 *
 * 用法：
 *   1) cd StableDeviceApp
 *   2) npm install --no-save sharp
 *   3) node tools/compress-icons.js
 *
 * 行为：
 *   - 把 assets/tab-icons/*.png 缩放到 96x96（@3x 屏够用，@2x 也清晰）
 *   - 用 palette + 质量 80 的 PNG 压缩（≈ tinypng 效果）
 *   - 输出前自动备份原文件到 assets/tab-icons/_original/
 *   - 打印每个文件压缩前/后大小和压缩率
 *
 * 还原：
 *   node tools/compress-icons.js --restore
 */

const fs = require('fs');
const path = require('path');

// sharp 是惰性 require——没装时给出友好提示
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('\n❌ 缺少 sharp 依赖，请先执行：\n');
  console.error('   npm install --no-save sharp\n');
  process.exit(1);
}

const ICON_DIR = path.join(__dirname, '..', 'assets', 'tab-icons');
const BACKUP_DIR = path.join(ICON_DIR, '_original');
const TARGET_SIZE = 96;        // tab 图标渲染时只需 24/28px，源 96px 已足够
const PNG_QUALITY = 80;         // 0-100，80 是 tinypng 默认的视觉无损阈值
const ICON_NAMES = ['bluetooth.png', 'bom.png', 'inventory.png', 'profile.png'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function backupOnce() {
  ensureDir(BACKUP_DIR);
  let backedUp = 0;
  for (const name of ICON_NAMES) {
    const src = path.join(ICON_DIR, name);
    const dst = path.join(BACKUP_DIR, name);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      backedUp++;
    }
  }
  return backedUp;
}

async function restoreFromBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`❌ 没找到备份目录：${BACKUP_DIR}`);
    process.exit(1);
  }
  for (const name of ICON_NAMES) {
    const src = path.join(BACKUP_DIR, name);
    const dst = path.join(ICON_DIR, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log(`✓ 已还原 ${name}`);
    } else {
      console.log(`⚠ 备份里没有 ${name}，跳过`);
    }
  }
}

async function compressOne(name) {
  const filepath = path.join(ICON_DIR, name);
  if (!fs.existsSync(filepath)) {
    console.log(`⚠ 跳过（不存在）：${name}`);
    return null;
  }
  const before = fs.statSync(filepath).size;

  // 用 sharp 重采样到 96x96，再以 palette PNG 输出
  // fit:'contain' + 透明背景：保证非正方形图不会被裁剪/拉伸
  const buffer = await sharp(filepath)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      quality: PNG_QUALITY,
      compressionLevel: 9,    // 0-9，9 压缩最强、稍慢
      palette: true,          // 启用 8-bit palette，相当于 pngquant
      effort: 10,             // 0-10，最大压缩尝试
    })
    .toBuffer();

  fs.writeFileSync(filepath, buffer);
  const after = buffer.length;
  const ratio = ((1 - after / before) * 100).toFixed(1);
  return { name, before, after, ratio };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--restore') || args.includes('-r')) {
    console.log('🔄 还原原始图标...\n');
    await restoreFromBackup();
    console.log('\n✅ 还原完成');
    return;
  }

  console.log(`🎨 压缩 tab 图标（目标 ${TARGET_SIZE}x${TARGET_SIZE}, PNG 质量 ${PNG_QUALITY}）\n`);

  const backedUp = await backupOnce();
  if (backedUp > 0) {
    console.log(`📦 已备份 ${backedUp} 个原始文件到 ${path.relative(process.cwd(), BACKUP_DIR)}/\n`);
  }

  const results = [];
  for (const name of ICON_NAMES) {
    const r = await compressOne(name);
    if (r) results.push(r);
  }

  console.log('─────────────────────────────────────────────');
  console.log('文件名              原始大小    压缩后    节省');
  console.log('─────────────────────────────────────────────');
  let totalBefore = 0, totalAfter = 0;
  for (const r of results) {
    totalBefore += r.before;
    totalAfter += r.after;
    const ratio = (r.before / r.after).toFixed(1);
    console.log(
      `${r.name.padEnd(20)} ${formatSize(r.before).padStart(8)} → ${formatSize(r.after).padStart(8)}  ↓${r.ratio}% (${ratio}x)`
    );
  }
  console.log('─────────────────────────────────────────────');
  const totalSaved = totalBefore - totalAfter;
  console.log(
    `${'合计'.padEnd(20)} ${formatSize(totalBefore).padStart(8)} → ${formatSize(totalAfter).padStart(8)}  ↓${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% (省 ${formatSize(totalSaved)})`
  );
  console.log('\n💡 不满意？执行  node tools/compress-icons.cjs --restore  可还原原始文件');
}

main().catch((err) => {
  console.error('❌ 压缩失败：', err.message || err);
  process.exit(1);
});
