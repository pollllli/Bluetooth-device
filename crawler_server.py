"""
立创商城(szlcsc.com) 增强版爬虫服务 v2
- Playwright 浏览器自动化 + SQLite 本地缓存
- 搜索结果页 (so.szlcsc.com/global.html) 直接包含器件的完整信息
- 提取完整器件数据：型号/品牌/封装/类目/价格/库存/规格参数/描述
- 支持单件 & 批量爬取 API
- 指数退避重试 + WAF识别

启动方式: python crawler_server.py
API:
  GET  /api/crawl?keyword=器件编号          单件爬取
  POST /api/crawl-batch                     批量爬取 (body: {"keywords": ["C2965582", ...]})
  GET  /health                              健康检查
  GET  /cache/stats                         缓存统计
  POST /cache/clear                         清空缓存
"""

import asyncio
import json
import re
import random
import os
import time
import sqlite3
import logging
from urllib.parse import quote
from datetime import datetime, timedelta

from aiohttp import web
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# ===== 配置 =====
PORT = 3000
# 立创商城搜索结果页URL（搜索结果页直接展示器件的完整信息）
SEARCH_URL_TEMPLATE = 'https://so.szlcsc.com/global.html?k={}'

# Chrome用户数据目录（使用独立目录避免与正在使用的Chrome冲突）
USER_DATA_DIR = os.path.join(os.environ.get('TEMP', 'C:\\Temp'), 'szlcsc_crawler_chrome')

# 优先使用本地已有的完整Chromium，避免下载 headless-shell
CHROMIUM_EXECUTABLE = os.path.join(
    os.environ.get('LOCALAPPDATA', ''),
    'ms-playwright',
    'chromium-1223',
    'chrome-win64',
    'chrome.exe'
)

# SQLite 缓存数据库路径
CACHE_DB_PATH = os.path.join(os.environ.get('TEMP', 'C:\\Temp'), 'szlcsc_crawler_cache.db')

# 缓存有效期（小时），超过此时间的数据会被重新爬取
CACHE_TTL_HOURS = 24

# 爬取重试配置
MAX_RETRIES = 2
RETRY_BASE_DELAY_MS = 2000

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)


# ===== 全局浏览器实例（复用，避免每次请求都新建）=====
_browser: Browser | None = None
_context: BrowserContext | None = None
_lock = asyncio.Lock()  # 防止并发请求冲突


# ============================================================
#  SQLite 缓存层
# ============================================================

def get_db_connection():
    """获取数据库连接（线程安全）"""
    conn = sqlite3.connect(CACHE_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_cache_db():
    """初始化缓存数据库表"""
    conn = get_db_connection()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS product_cache (
                keyword TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                crawled_at TEXT NOT NULL,
                source_url TEXT,
                hit_count INTEGER DEFAULT 0
            )
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_crawled_at ON product_cache(crawled_at)
        ''')
        conn.commit()
        log.info(f'缓存数据库已就绪: {CACHE_DB_PATH}')
    finally:
        conn.close()


def get_cached(keyword: str) -> dict | None:
    """
    从缓存中获取数据
    返回解析后的字典，缓存未命中或已过期返回 None
    """
    conn = get_db_connection()
    try:
        row = conn.execute(
            'SELECT data, crawled_at, hit_count FROM product_cache WHERE keyword = ?',
            (keyword,)
        ).fetchone()

        if not row:
            return None

        # 检查是否过期
        crawled_at = datetime.fromisoformat(row['crawled_at'])
        if datetime.now() - crawled_at > timedelta(hours=CACHE_TTL_HOURS):
            log.info(f'缓存已过期: {keyword} (于 {row["crawled_at"]})')
            return None

        # 更新命中计数
        conn.execute(
            'UPDATE product_cache SET hit_count = hit_count + 1 WHERE keyword = ?',
            (keyword,)
        )
        conn.commit()

        log.info(f'缓存命中: {keyword} (命中次数: {row["hit_count"] + 1})')
        result = json.loads(row['data'])
        result['_cached'] = True
        result['_cached_at'] = row['crawled_at']
        return result
    except Exception as e:
        log.warning(f'缓存读取异常: {e}')
        return None
    finally:
        conn.close()


def set_cache(keyword: str, data: dict, source_url: str = ''):
    """写入缓存"""
    conn = get_db_connection()
    try:
        now = datetime.now().isoformat()
        conn.execute('''
            INSERT OR REPLACE INTO product_cache (keyword, data, crawled_at, source_url, hit_count)
            VALUES (?, ?, ?, ?, COALESCE((SELECT hit_count FROM product_cache WHERE keyword = ?), 0))
        ''', (keyword, json.dumps(data, ensure_ascii=False), now, source_url, keyword))
        conn.commit()
        log.info(f'缓存已写入: {keyword}')
    except Exception as e:
        log.warning(f'缓存写入异常: {e}')
    finally:
        conn.close()


def clear_cache():
    """清空所有缓存"""
    conn = get_db_connection()
    try:
        count = conn.execute('SELECT COUNT(*) as cnt FROM product_cache').fetchone()['cnt']
        conn.execute('DELETE FROM product_cache')
        conn.commit()
        log.info(f'缓存已清空，共删除 {count} 条记录')
        return count
    finally:
        conn.close()


def get_cache_stats() -> dict:
    """获取缓存统计信息"""
    conn = get_db_connection()
    try:
        total = conn.execute('SELECT COUNT(*) as cnt FROM product_cache').fetchone()['cnt']
        valid = conn.execute(
            f"SELECT COUNT(*) as cnt FROM product_cache WHERE "
            f"crawled_at > '{(datetime.now() - timedelta(hours=CACHE_TTL_HOURS)).isoformat()}'"
        ).fetchone()['cnt']
        expired = total - valid
        top_keywords = conn.execute(
            'SELECT keyword, hit_count, crawled_at FROM product_cache ORDER BY hit_count DESC LIMIT 10'
        ).fetchall()
        return {
            'total': total,
            'valid': valid,
            'expired': expired,
            'ttl_hours': CACHE_TTL_HOURS,
            'top_keywords': [dict(r) for r in top_keywords],
        }
    finally:
        conn.close()


# ============================================================
#  浏览器管理
# ============================================================

async def get_browser_context():
    """
    获取浏览器上下文（单例模式，全局复用）
    如果浏览器未初始化则创建，已存在则直接返回
    """
    global _browser, _context

    if _context is not None:
        return _context

    async with _lock:
        # double-check lock
        if _context is not None:
            return _context

        log.info('正在启动浏览器...')
        pw = await async_playwright().start()

        # 确保用户数据目录存在
        os.makedirs(USER_DATA_DIR, exist_ok=True)

        # 优先使用本地已有的完整Chromium
        executable_path = None
        if os.path.exists(CHROMIUM_EXECUTABLE):
            executable_path = CHROMIUM_EXECUTABLE
            log.info(f'使用本地Chromium: {executable_path}')

        _browser = await pw.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=True,
            executable_path=executable_path,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-infobars',
                '--window-size=1920,1080',
            ],
            ignore_default_args=['--enable-automation'],
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='zh-CN',
            timezone_id='Asia/Shanghai',
        )
        _context = _browser
        log.info('浏览器启动成功')

        return _context


async def close_browser():
    """关闭浏览器实例"""
    global _browser, _context
    if _context:
        try:
            await _context.close()
        except Exception:
            pass
        _context = None
        _browser = None
        log.info('浏览器已关闭')


async def reset_browser():
    """重置浏览器（关闭后下次调用 get_browser_context 会重新创建）"""
    await close_browser()


async def human_delay(min_ms=1500, max_ms=3500):
    """模拟人类操作的随机延迟"""
    delay = random.randint(min_ms, max_ms)
    await asyncio.sleep(delay / 1000)


# ============================================================
#  核心爬取逻辑
# ============================================================

async def crawl_product(keyword: str, use_cache: bool = True) -> dict:
    """
    爬取立创商城器件详情（带缓存和重试）

    流程：检查缓存 → 搜索页 → 提取第一个商品数据 → 写入缓存

    Args:
        keyword: 器件编号或名称
        use_cache: 是否使用缓存（默认开启）
    """
    # 1. 检查缓存
    if use_cache:
        cached = get_cached(keyword)
        if cached:
            return cached

    log.info(f'开始爬取: {keyword}')

    # 2. 带重试的爬取
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            result = await _crawl_product_impl(keyword)

            # 成功（即使有 error 字段）
            if result and not result.get('error'):
                # 写入缓存
                set_cache(keyword, result, result.get('sourceUrl', ''))
                return result

            # 有 error 但可能是 WAF 触发，重试
            if attempt < MAX_RETRIES:
                log.warning(f'第{attempt + 1}次爬取结果异常: {result.get("error")}, 重试...')
                await asyncio.sleep(2)
                continue
            return result

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY_MS * (2 ** attempt) + random.randint(0, 1000)
                log.warning(f'第{attempt + 1}次尝试异常: {e}，{delay / 1000:.1f}秒后重试...')
                await asyncio.sleep(delay / 1000)
            else:
                log.error(f'已达到最大重试次数({MAX_RETRIES})，放弃: {e}')

    return {'error': f'爬取失败: {str(last_error)}', 'keyword': keyword}


async def _crawl_product_impl(keyword: str) -> dict:
    """
    爬取实现（无缓存、无重试的纯实现）

    流程：
    1. 先访问首页让WAF拿到cookie
    2. 访问 global.html 搜索结果页
    3. 从搜索结果第一个商品卡片中提取结构化数据
    """
    context = await get_browser_context()
    page: Page = await context.new_page()

    try:
        # === 第0步：先访问首页让WAF放行（必要！否则搜索页会被WAF拦截）===
        log.info('热身：访问首页让WAF放行...')
        try:
            await page.goto('https://www.szlcsc.com/', wait_until='domcontentloaded', timeout=20000)
            await human_delay(800, 1500)
        except Exception as e:
            log.warning(f'首页预热失败（继续尝试搜索）: {e}')

        # === 第一步：访问搜索结果页 ===
        search_url = SEARCH_URL_TEMPLATE.format(quote(keyword))
        log.info(f'访问搜索页: {search_url}')

        response = await page.goto(search_url, timeout=30000, wait_until='domcontentloaded')
        if not response or response.status >= 400:
            log.warning(f'搜索页请求异常，状态码: {response.status if response else "None"}')

        # 等待JavaScript渲染完成（关键：JSON-LD需要等页面渲染完才出现）
        await human_delay(2000, 3000)

        # === 第二步：检查是否真的到了搜索结果页（不是404） ===
        title = await page.title()
        final_url = page.url
        log.info(f'搜索页加载后: title={title!r}, url={final_url}')

        if '没有找到' in title or '404' in title or 'global.html' not in final_url or '登录' in title or 'passport' in final_url or 'login' in final_url.lower():
            log.warning(f'搜索结果页异常: title={title!r}, url={final_url}')
            # ========== WAF自我修复：检测到登录页则清空持久化目录并重置浏览器 ==========
            if '登录' in title or 'passport' in final_url or 'login' in final_url.lower():
                log.warning('⚠️ 检测到WAF拦截（被重定向到登录页），执行自我修复...')
                try:
                    await page.close()
                except Exception:
                    pass
                await reset_browser()
                # 清空持久化目录（标记为不可信）
                if os.path.exists(USER_DATA_DIR):
                    try:
                        import shutil
                        shutil.rmtree(USER_DATA_DIR, ignore_errors=True)
                        os.makedirs(USER_DATA_DIR, exist_ok=True)
                        log.info(f'✅ 已清空持久化目录: {USER_DATA_DIR}')
                    except Exception as e2:
                        log.warning(f'清空目录失败: {e2}')
                # 重试一次
                log.info('重试爬取（使用全新浏览器实例）...')
                return await _crawl_product_impl(keyword)
            return {
                'error': f'未找到搜索结果: {keyword} (title={title!r})',
                'keyword': keyword,
                'pageTitle': title,
                'pageUrl': final_url,
            }

        # === 第三步：从页面中提取第一个商品的数据 ===
        result = await _extract_first_product(page, keyword, search_url)

        if result.get('name') or result.get('productNumber'):
            result['crawledAt'] = datetime.now().isoformat()
            log.info(f'爬取成功: name={result.get("name")}, brand={result.get("brand")}, package={result.get("package")}')
            return result
        else:
            log.warning(f'未能提取到有效数据，title={title!r}')
            return {
                'error': '页面渲染成功但未能提取到产品信息',
                'keyword': keyword,
                'pageTitle': title,
            }

    except Exception as e:
        log.error(f'爬取过程异常: {type(e).__name__}: {e}')
        return {'error': f'爬取异常: {str(e)}', 'keyword': keyword}
    finally:
        try:
            await page.close()
        except Exception:
            pass


async def _extract_first_product(page: Page, keyword: str, source_url: str) -> dict:
    """
    从立创商城搜索结果页提取第一个商品的6个核心字段

    字段：编号(productNumber) / 名称(name) / 类目(category) / 封装(package) / 品牌(brand) / 数量(quantity)
    策略：JSON-LD 拿主字段，DOM 补全 类目/封装
    """
    result = {
        'productNumber': keyword,
        'sourceUrl': source_url,
    }

    # 用JavaScript在浏览器内提取（避开GBK编码问题）
    data = await page.evaluate(r'''(keyword) => {
        // 6个核心字段
        const out = {name: null, brand: null, package: null, category: null,
                     productNumber: keyword, quantity: null};

        // ========== 第1步：解析 Schema.org JSON-LD（最可靠）==========
        let jsonLdData = null;
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of ldScripts) {
            try {
                const json = JSON.parse(s.textContent);
                if (json['@type'] === 'ItemList' && Array.isArray(json.itemListElement) && json.itemListElement.length > 0) {
                    const first = json.itemListElement[0];
                    const item = first.item || first;
                    if (item && item.name) { jsonLdData = item; break; }
                }
                if (json['@type'] === 'Product' && json.name) { jsonLdData = json; break; }
            } catch (e) { /* 跳过 */ }
        }

        if (jsonLdData) {
            out.name = jsonLdData.name || null;
            if (jsonLdData.brand) {
                out.brand = (typeof jsonLdData.brand === 'string') ? jsonLdData.brand : (jsonLdData.brand.name || null);
            }
            if (jsonLdData.sku) out.productNumber = jsonLdData.sku;
            else if (jsonLdData.mpn) out.productNumber = jsonLdData.mpn;
        }

        // ========== 第2步：从页面文本提取 类目/封装 ==========
        const bodyText = document.body ? (document.body.innerText || '') : '';

        // 优先从 DOM 中找"类目"/"封装"标签后的第一个有意义的文本（链接或纯文本）
        // 立创商城DOM结构: <dl><dt>类目</dt><span></span><dd><a>单片机(MCU/MPU/SOC)</a></dd></dl>
        function extractFieldFromDOM(fieldName) {
            const allDts = document.querySelectorAll('dt');
            for (const dt of allDts) {
                if ((dt.textContent || '').trim() !== fieldName) continue;
                const dl = dt.parentElement;
                if (!dl) continue;
                // 找 <dl> 里的 <dd>
                const dd = dl.querySelector('dd');
                if (!dd) continue;
                // 优先取 <a> 链接的文本
                const a = dd.querySelector('a');
                const v = (a ? a.textContent : dd.textContent || '').trim();
                if (v && v.length < 100 && !v.includes('http') && !v.includes('>')) {
                    return v;
                }
            }
            return null;
        }

        function extractField(fieldName) {
            // 优先用 DOM 方式
            const domVal = extractFieldFromDOM(fieldName);
            if (domVal) return domVal;
            // 降级用正则
            const patterns = [
                new RegExp(fieldName + '\\s*\\n+\\s*([^\\n]+)'),
                new RegExp('^\\s*' + fieldName + '\\s*\\n+\\s*([^\\n]+)', 'm'),
            ];
            for (const re of patterns) {
                const m = bodyText.match(re);
                if (m) {
                    const v = m[1].trim();
                    if (v && v.length < 100 && !v.includes('http') && !v.includes('>')) {
                        return v;
                    }
                }
            }
            return null;
        }

        out.category = extractField('类目');
        out.package = extractField('封装');

        // ========== 第3步：提取数量（从库存文本）==========
        // 格式: 现货271K+ → 271000
        // 或: 现货: 30 → 30
        const stockMatch = bodyText.match(/现货[：:是\s]*([\d.]+K?\+?)/);
        if (stockMatch) {
            const raw = stockMatch[1].replace('+', '');
            if (raw.includes('K') || raw.includes('k')) {
                out.quantity = Math.round(parseFloat(raw.replace(/[Kk]/, '')) * 1000);
            } else {
                out.quantity = parseInt(raw) || null;
            }
        }

        return out;
    }''', keyword)

    if data:
        for k, v in data.items():
            if v is not None and v != {} and v != []:
                result[k] = v

    return result


# ============================================================
#  HTTP API 接口
# ============================================================

async def handle_crawl(request: web.Request) -> web.Response:
    """处理单件爬取请求 GET /api/crawl?keyword=xxx&nocache=1"""
    keyword = request.query.get('keyword', '').strip()
    nocache = request.query.get('nocache', '').lower() in ('1', 'true')

    if not keyword:
        return web.json_response(
            {'error': '缺少 keyword 参数'},
            status=400,
            headers={'Access-Control-Allow-Origin': '*'}
        )

    log.info(f'[API] 收到单件爬取请求: {keyword} (跳过缓存: {nocache})')

    try:
        result = await crawl_product(keyword, use_cache=not nocache)
        return web.json_response(
            result,
            headers={'Access-Control-Allow-Origin': '*'}
        )
    except Exception as e:
        log.error(f'[API] 请求处理异常: {e}')
        return web.json_response(
            {'error': f'服务器内部错误: {str(e)}'},
            status=500,
            headers={'Access-Control-Allow-Origin': '*'}
        )


async def handle_crawl_batch(request: web.Request) -> web.Response:
    """
    处理批量爬取请求 POST /api/crawl-batch
    Body: {"keywords": ["C2965582", "C12345"], "nocache": false}
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response(
            {'error': '请求体必须是有效的 JSON'},
            status=400,
            headers={'Access-Control-Allow-Origin': '*'}
        )

    keywords = body.get('keywords', [])
    nocache = body.get('nocache', False)

    if not keywords or not isinstance(keywords, list):
        return web.json_response(
            {'error': '缺少 keywords 数组参数'},
            status=400,
            headers={'Access-Control-Allow-Origin': '*'}
        )

    if len(keywords) > 20:
        return web.json_response(
            {'error': '单次最多支持20个器件编号'},
            status=400,
            headers={'Access-Control-Allow-Origin': '*'}
        )

    log.info(f'[API] 收到批量爬取请求: {len(keywords)} 个器件 (跳过缓存: {nocache})')

    results = {}
    errors = {}
    success_count = 0
    cache_hit_count = 0

    # 串行爬取（避免并发触发反爬）
    for kw in keywords:
        kw_str = str(kw).strip()
        if not kw_str:
            continue
        try:
            result = await crawl_product(kw_str, use_cache=not nocache)
            if result.get('_cached'):
                cache_hit_count += 1
            if result.get('error'):
                errors[kw_str] = result['error']
            else:
                results[kw_str] = result
                success_count += 1
        except Exception as e:
            errors[kw_str] = str(e)

        # 批量爬取时添加间隔避免被封
        await human_delay(800, 1500)

    summary = {
        'total': len(keywords),
        'success': success_count,
        'cache_hits': cache_hit_count,
        'failed': len(errors),
    }

    log.info(f'[API] 批量爬取完成: {summary}')

    return web.json_response({
        'summary': summary,
        'results': results,
        'errors': errors,
    }, headers={'Access-Control-Allow-Origin': '*'})


async def handle_health(request: web.Request) -> web.Response:
    """健康检查接口"""
    stats = get_cache_stats()
    return web.json_response({
        'status': 'ok',
        'browser_ready': _context is not None,
        'cache': {
            'total': stats['total'],
            'valid': stats['valid'],
        },
    })


async def handle_cache_stats(request: web.Request) -> web.Response:
    """缓存统计接口"""
    return web.json_response(get_cache_stats())


async def handle_cache_clear(request: web.Request) -> web.Response:
    """清空缓存接口"""
    count = clear_cache()
    return web.json_response({'message': f'已清空 {count} 条缓存记录'})


async def on_startup(app):
    """应用启动时初始化"""
    log.info('=' * 60)
    log.info('  立创商城 增强版爬虫服务 v2 启动中...')
    log.info(f'  API地址: http://localhost:{PORT}/api/crawl?keyword=器件编号')
    log.info(f'  批量API: POST http://localhost:{PORT}/api/crawl-batch')
    log.info(f'  Chrome数据目录: {USER_DATA_DIR}')
    log.info(f'  缓存数据库: {CACHE_DB_PATH}')
    log.info(f'  缓存有效期: {CACHE_TTL_HOURS} 小时')
    log.info('=' * 60)

    # 初始化缓存数据库
    init_cache_db()

    # 预热浏览器
    try:
        await get_browser_context()
        log.info('浏览器预热完成，准备接受请求')
    except Exception as e:
        log.warning(f'浏览器预热失败（将在首次请求时重试）: {e}')


async def on_cleanup(app):
    """应用关闭时清理资源"""
    log.info('正在关闭爬虫服务...')
    await close_browser()
    log.info('爬虫服务已停止')


def main():
    """主入口"""
    app = web.Application()

    # 注册路由
    app.router.add_get('/api/crawl', handle_crawl)
    app.router.add_post('/api/crawl-batch', handle_crawl_batch)
    app.router.add_get('/health', handle_health)
    app.router.add_get('/cache/stats', handle_cache_stats)
    app.router.add_post('/cache/clear', handle_cache_clear)

    # CORS 预检
    async def options_handler(request):
        return web.Response(
            status=200,
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        )
    app.router.add_route('OPTIONS', '/api/crawl', options_handler)
    app.router.add_route('OPTIONS', '/api/crawl-batch', options_handler)
    app.router.add_route('OPTIONS', '/cache/clear', options_handler)

    # 注册生命周期回调
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    # 启动服务
    web.run_app(app, host='0.0.0.0', port=PORT, print=None)


# ============================================================
# 【已注释】开机自启动静默爬虫
# 如需重新启用，请取消注释以下代码
# ============================================================
#if __name__ == '__main__':
#    main()
