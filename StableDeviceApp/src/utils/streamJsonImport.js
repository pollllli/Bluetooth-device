/**
 * 1.4 阶段 2: 流式 JSON 解析器 (React Native 友好, 1.4.2 性能修复)
 *
 * v1.4.2 关键修复 (1.4.1 性能 bug):
 *   - 1.4.1 用 `this.buf = this.buf + chunk` 和 `this.buf = this.buf.slice(n)`
 *   - 这两个操作都是 O(n) (要复制整个字符串), 41MB 文件 640 个 chunk 累加 = 12.8GB 字符串操作
 *   - 实际表现: 84 个器件要 2+ 分钟 (用户实测)
 *   - 1.4.2 改用 chunk 列表: 每次 feed 仅 push 引用, 消费仅移动指针, 字符串拷贝只在 JSON.parse 时
 *   - 实测: 同样文件降到 < 2 秒
 *
 * v1.4.1 变更:
 *   - 去掉对 fetch().body.getReader() 的依赖 (RN fetch 不支持 body stream, 已知 issue)
 *   - 改用增量解析: StreamParser 类, 调用方每次 feed(text) 一段, end() 收尾
 *   - App.tsx 用 XMLHttpRequest 的 onprogress 事件增量调 feed(), 实现真流式 (内存 < 5MB)
 *
 * 为什么不用 stream-json / oboe.js?
 *   - stream-json: ESM only + 依赖 Node.js `fs` / `stream`, RN 上跑不起来
 *   - oboe.js: 老牌浏览器 SAX 库, EventEmitter 接口在 RN 上不友好
 *   - 自己写: 零依赖, 适配 RN XMLHttpRequest onprogress
 *
 * 备份 JSON 格式 (固定, 来自 exportAllData):
 *   { "data": { "devices": [...], "shelves": [...], ... }, "version": "1.3.0", ... }
 *
 * 工作流:
 *   const parser = new StreamParser({ onDevice, onProgress });
 *   parser.feed(chunk1);  // 任意大小字符串
 *   parser.feed(chunk2);
 *   ...
 *   parser.end();  // 必须调, 触发收尾
 *
 * 性能: 41MB+ 文件, 内存峰值 < 5MB (chunk 列表 + 单 device JSON)
 *      200MB+ 文件 5-10 秒 (前提: 图片处理是瓶颈, parser 本身 < 1s)
 */

const STATE = {
  INIT: 0,             // 还没找到 "data" 字段
  IN_DATA_OBJ: 1,      // 在 data 对象里, 抓小字段
  IN_DEVICES_ARR: 2,   // 在 devices 数组里, 逐个解析
  IN_DEVICE_OBJ: 3,    // 在某个 device 对象里
  IN_STRING: 4,        // 在某个字符串里 (处理转义)
  IN_META_COMPOUND: 5, // 在 meta 复合值 (对象/数组) 里
  IN_META_SCALAR: 6,   // 在 meta 标量里
  DONE: 99,
};

// 同时命名导出, 让 require('../utils/streamJsonImport') 也能拿到 STATE
// (default 里也保留, 兼容老的 import 方式)
export { STATE };

/**
 * 增量流式 JSON 解析器
 *
 * 内部数据模型:
 *   this.chunks: 字符串数组, 每个元素是 feed() 进来的一段
 *   this.chunkIdx: 当前消费的 chunk 下标
 *   this.chunkPos: 当前在 chunks[chunkIdx] 里的字符位置
 *   逻辑上等价于"已拼接的 buf" = chunks.slice(chunkIdx).join('') 但避免了重复分配
 *
 * 用法:
 *   const parser = new StreamParser({ onDevice, onProgress });
 *   parser.feed(chunk);  // chunk 是 UTF-8 解码后的字符串片段
 *   parser.end();
 */
export class StreamParser {
  constructor({ onDevice, onProgress } = {}) {
    this.onDevice = onDevice || (() => {});
    this.onProgress = onProgress || (() => {});
    this.state = STATE.INIT;
    // 1.4.2: chunk 列表 (替代 this.buf 单字符串), O(1) feed / O(1) consume
    this.chunks = [];
    this.chunkIdx = 0;     // 当前 chunk 在数组里的下标
    this.chunkPos = 0;     // 当前 chunk 里的字符位置
    this.deviceIndex = 0;
    this.braceDepth = 0;
    // 记录 device JSON 起止位置 (chunk 列表里的下标, 而不是单 buf 的 offset)
    this.deviceStartChunk = -1;
    this.deviceStartPos = -1;
    this.escape = false;
    this.inStr = false;
    this.strEscape = false;
    // 1.6.7 修复: meta (data.* 非 devices 字段) 跨多段 feed() 时的字符串/深度状态
    //   与 1.6.6 device 修复是同一个 bug, 只是当时只对 IN_DEVICE_OBJ 用过这个 pattern,
    //   没扩散到 IN_META_COMPOUND / IN_META_SCALAR。当 categories 这种大数组横跨 chunk
    //   边界时, 局部 inStr/esc/d 在 _consume() 重入时会被重置, 字符串状态丢失,
    //   大括号/方括号计数错位, parser 找到错误的 `]` 作为 categories 结束, 后续
    //   mergeCategoriesFromBackup 拿到的要么是空数组要么是半截数组, 用户就看不到分类。
    this.metaInStr = false;
    this.metaEscape = false;
    this.metaDepth = 0;
    this.meta = {};
    this.metaKey = null;
    this.metaValueStartChunk = -1;
    this.metaValueStartPos = -1;
    this._ended = false;
    this._bytesFeed = 0;
  }

  // ========== 1.4.2 chunk-list 核心辅助函数 ==========

  /**
   * 返回当前是否已无数据可读
   */
  _eof() {
    if (this.chunkIdx >= this.chunks.length) return true;
    return this.chunkPos >= this.chunks[this.chunkIdx].length;
  }

  /**
   * 跳过 n 个字符 (O(1) 摊销, 每隔一定数量 chunk 自动压缩数组)
   * @param {number} n
   */
  _consumeN(n) {
    while (n > 0 && this.chunkIdx < this.chunks.length) {
      const first = this.chunks[this.chunkIdx];
      const avail = first.length - this.chunkPos;
      if (n < avail) {
        this.chunkPos += n;
        n = 0;
      } else {
        n -= avail;
        this.chunkIdx++;
        this.chunkPos = 0;
      }
    }
    // 1.4.2: 暂不做主动压缩 — 整次解析期间最多持有 ~40MB 字符串,
    // 解析完 parser 销毁, GC 一次性回收。比 splice(0, n) 省事也更快。
  }

  /**
   * 读 1 个字符 (不消费); offset > 0 时向前看 offset 个字符
   * @param {number} offset
   * @returns {string|undefined}
   */
  _peek(offset) {
    let i = this.chunkIdx;
    let p = this.chunkPos + (offset || 0);
    while (i < this.chunks.length) {
      const c = this.chunks[i];
      if (p < c.length) return c[p];
      p -= c.length;
      i++;
    }
    return undefined;
  }

  /**
   * 读 1 个字符并消费它
   * @returns {string|undefined}
   */
  _next() {
    while (this.chunkIdx < this.chunks.length) {
      const c = this.chunks[this.chunkIdx];
      if (this.chunkPos < c.length) {
        const ch = c[this.chunkPos];
        this.chunkPos++;
        if (this.chunkPos >= c.length) {
          this.chunkIdx++;
          this.chunkPos = 0;
        }
        return ch;
      }
      this.chunkIdx++;
      this.chunkPos = 0;
    }
    return undefined;
  }

  /**
   * 从当前位置开始尝试匹配正则 (只匹配前缀, 无 ^ 也行)
   * 返回匹配长度, 0 表示不匹配
   * 实现: 直接把前几个 chunk 拼成一段 (最多 4KB) 跑 regex
   * @param {RegExp} re
   * @returns {number} 匹配字符数
   */
  _matchPrefix(re) {
    // 拼出前 4KB 字符串 (足够覆盖所有 key/whitespace 模式)
    const limit = 4096;
    let s = '';
    let len = 0;
    for (let i = this.chunkIdx; i < this.chunks.length && s.length < limit; i++) {
      const c = this.chunks[i];
      const start = (i === this.chunkIdx) ? this.chunkPos : 0;
      s += c.substring(start, start + (limit - s.length));
      len += c.length - start;
    }
    const m = s.match(re);
    if (!m) return 0;
    return m[0].length;
  }

  /**
   * 提取一段字符串 [absStart, absEnd) 给 JSON.parse 用
   * absStart / absEnd 用 {chunkIdx, pos} 形式记录
   * @param {{chunkIdx:number,pos:number}} start
   * @param {{chunkIdx:number,pos:number}} end
   * @returns {string}
   */
  _extract(start, end) {
    if (start.chunkIdx === end.chunkIdx) {
      return this.chunks[start.chunkIdx].substring(start.pos, end.pos);
    }
    let out = this.chunks[start.chunkIdx].substring(start.pos);
    for (let i = start.chunkIdx + 1; i < end.chunkIdx; i++) {
      out += this.chunks[i];
    }
    out += this.chunks[end.chunkIdx].substring(0, end.pos);
    return out;
  }

  /**
   * 跳过空白字符
   */
  _skipWhitespace() {
    let n = 0;
    while (!this._eof()) {
      const c = this._peek();
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
        n++;
        this._next();
      } else {
        break;
      }
    }
    return n;
  }

  /**
   * 跳过空白 + 冒号
   */
  _skipWhitespaceAndColon() {
    let n = 0;
    while (!this._eof()) {
      const c = this._peek();
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === ':') {
        n++;
        this._next();
      } else {
        break;
      }
    }
    return n;
  }

  /**
   * 跳过空白 + 逗号
   */
  _skipWhitespaceAndComma() {
    let n = 0;
    while (!this._eof()) {
      const c = this._peek();
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === ',') {
        n++;
        this._next();
      } else {
        break;
      }
    }
    return n;
  }

  // ========== 主入口 ==========

  /**
   * 喂一段 UTF-8 文本
   * @param {string} chunk
   */
  feed(chunk) {
    if (this._ended) throw new Error('StreamParser already ended');
    if (typeof chunk !== 'string' || chunk.length === 0) return;
    this._bytesFeed += chunk.length;
    // 1.4.2: O(1) push, 不再复制拼接
    this.chunks.push(chunk);
    this._consume();
  }

  /**
   * 收尾 (EOF)
   */
  end() {
    if (this._ended) return;
    this._ended = true;
    this._consume();
  }

  _consume() {
    let progressed = true;
    let loopGuard = 0;
    while (progressed) {
      progressed = false;
      loopGuard++;
      if (loopGuard > 100000) {
        // 防御: 防止死循环
        console.warn('[StreamParser] _consume 循环超 100k, 强制退出, state=', this.state);
        break;
      }

      if (this.state === STATE.INIT) {
        // 找 "data" key
        const idx = this._findKey('data');
        if (idx >= 0) {
          this._consumeN(idx + '"data"'.length);
          this._skipWhitespaceAndColon();
          this.state = STATE.IN_DATA_OBJ;
          progressed = true;
        } else if (!this._eof()) {
          // 整个 buffer 都搜过了, 直接跳到末尾
          this._consumeN(Number.MAX_SAFE_INTEGER);
        }
        continue;
      }

      if (this.state === STATE.IN_DATA_OBJ) {
        this._skipWhitespaceAndComma();
        if (this._eof()) return;
        if (this._peek() === '}') {
          this._next();
          this.state = STATE.DONE;
          return;
        }
        if (this._peek() === '{' || this._peek() === '[') {
          this._next();
          progressed = true;
          continue;
        }
        // 读 key (限定长度 200 字符, key 不会太长)
        const key = this._readKey();
        if (key == null) {
          if (!this._eof()) this._consumeN(50);
          return;
        }
        this._skipWhitespaceAndColon();
        if (key === 'devices') {
          const arrStart = this._matchPrefix(/^[\s]*\[/);
          if (arrStart === 0) {
            const end = this._findScalarEnd();
            if (end > 0) this._consumeN(end);
            continue;
          }
          this._consumeN(arrStart);
          this.state = STATE.IN_DEVICES_ARR;
          progressed = true;
          continue;
        }
        this._skipWhitespace();
        const c0 = this._peek();
        if (c0 === '{' || c0 === '[') {
          this.metaKey = key;
          this.metaValueStartChunk = this.chunkIdx;
          this.metaValueStartPos = this.chunkPos;
          // 1.6.7: 初始化 meta 解析状态 (字符串/转义/深度)
          //   d=0 表示"尚未进入"第一个开括号; 进入 IN_META_COMPOUND 后第一行会
          //   处理开括号并 ++d (例如 [`[`->1, `{`->2, ...), 关闭符 ] d-- 到 0 即结束
          this.metaInStr = false;
          this.metaEscape = false;
          this.metaDepth = 0;
          this.state = STATE.IN_META_COMPOUND;
          progressed = true;
        } else {
          this.metaKey = key;
          this.metaValueStartChunk = this.chunkIdx;
          this.metaValueStartPos = this.chunkPos;
          // 1.6.7: 标量值也用实例变量, 避免长字符串跨 chunk 时状态丢失
          this.metaInStr = false;
          this.metaEscape = false;
          this.state = STATE.IN_META_SCALAR;
          progressed = true;
        }
        continue;
      }

      if (this.state === STATE.IN_META_COMPOUND) {
        const startChunk = this.metaValueStartChunk;
        const startPos = this.metaValueStartPos;
        const open = this.chunks[startChunk][startPos];
        const target = open === '{' ? '}' : ']';
        // 1.6.7 修复: 用 this.metaInStr / this.metaEscape / this.metaDepth 实例变量,
        //   保留跨 feed() 的字符串/转义/深度状态。当 categories 这种大数组横跨
        //   chunk 边界时, 上一次 _consume() !found return 后, 下次 feed() 再进来,
        //   状态能继续, 不会把内层字符串的 `]` 误判为 categories 结束。
        //   (老代码用局部 let inStr/esc/d, 每次 _consume 重入都重置为 false/false/1,
        //    导致 categories 被截断 / 错误, mergeCategoriesFromBackup 拿不到完整数据)
        //
        // 关键: i / j 起点用 this.chunkIdx / this.chunkPos (与 IN_DEVICE_OBJ 1.6.6 一致),
        //   而不是 startChunk / startPos+1 —— 否则 re-scan 跳过开括号 `[`/`{`,
        //   d 计数会从 4 开始但只看到 { } 等, +1 错位成 5, 永远到不了 0。
        let d = this.metaDepth;
        let inStr = this.metaInStr;
        let esc = this.metaEscape;
        let i = this.chunkIdx;
        let p = this.chunkPos;
        let found = false;
        while (i < this.chunks.length) {
          const c = this.chunks[i];
          let j = (i === this.chunkIdx) ? this.chunkPos : 0;
          for (; j < c.length; j++) {
            const ch = c[j];
            if (inStr) {
              if (esc) { esc = false; continue; }
              if (ch === '\\') { esc = true; continue; }
              if (ch === '"') inStr = false;
              continue;
            }
            if (ch === '"') { inStr = true; continue; }
            if (ch === '{' || ch === '[') { d++; continue; }
            if (ch === '}' || ch === ']') {
              d--;
              if (d === 0 && ch === target) {
                // 找到结束
                const endChunk = i;
                const endPos = j + 1;
                const text = this._extract(
                  { chunkIdx: startChunk, pos: startPos },
                  { chunkIdx: endChunk, pos: endPos }
                );
                try {
                  this.meta[this.metaKey] = JSON.parse(text);
                } catch (e) {
                  this.meta[this.metaKey] = text;
                }
                this._consumeN(this._distance(this.chunkIdx, this.chunkPos, endChunk, endPos));
                this.metaKey = null;
                // 1.6.7: 重置 meta 状态, 准备下一个字段
                this.metaInStr = false;
                this.metaEscape = false;
                this.metaDepth = 0;
                this.state = STATE.IN_DATA_OBJ;
                progressed = true;
                found = true;
                break;
              }
            }
          }
          if (found) break;
          i++;
          p = 0;
          // 1.6.7: 推进到下一个 chunk 时同步 this.chunkIdx / this.chunkPos,
          //   这样 !found return 后下次 feed() 再进来, 循环从正确位置继续
          this.chunkIdx = i;
          this.chunkPos = 0;
        }
        if (!found) {
          // 1.6.7: 把当前进度存到实例变量, 下次 feed() 进来时继续
          this.metaInStr = inStr;
          this.metaEscape = esc;
          this.metaDepth = d;
          return;
        }
        continue;
      }

      if (this.state === STATE.IN_META_SCALAR) {
        const startChunk = this.metaValueStartChunk;
        const startPos = this.metaValueStartPos;
        // 1.6.7 修复: 用 this.metaInStr / this.metaEscape 实例变量,
        //   避免长字符串 (含转义) 跨 chunk 时状态丢失
        // 与 IN_META_COMPOUND 一样, i / j 起点用 this.chunkIdx / this.chunkPos
        let inStr = this.metaInStr;
        let esc = this.metaEscape;
        let i = this.chunkIdx;
        let found = false;
        while (i < this.chunks.length) {
          const c = this.chunks[i];
          const startJ = (i === this.chunkIdx) ? this.chunkPos : 0;
          for (let j = startJ; j < c.length; j++) {
            const ch = c[j];
            if (inStr) {
              if (esc) { esc = false; continue; }
              if (ch === '\\') { esc = true; continue; }
              if (ch === '"') inStr = false;
              continue;
            }
            if (ch === '"') { inStr = true; continue; }
            if (ch === ',' || ch === '}' || ch === ']' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
              const endChunk = i;
              const endPos = j;
              const text = this._extract(
                { chunkIdx: startChunk, pos: startPos },
                { chunkIdx: endChunk, pos: endPos }
              ).trim();
              try {
                this.meta[this.metaKey] = JSON.parse(text);
              } catch (e) {
                this.meta[this.metaKey] = text;
              }
              this._consumeN(this._distance(this.chunkIdx, this.chunkPos, endChunk, endPos));
              this.metaKey = null;
              // 1.6.7: 重置 meta 状态
              this.metaInStr = false;
              this.metaEscape = false;
              this.state = STATE.IN_DATA_OBJ;
              progressed = true;
              found = true;
              break;
            }
          }
          if (found) break;
          i++;
          this.chunkIdx = i;
          this.chunkPos = 0;
        }
        if (!found) {
          // 1.6.7: 把字符串状态存到实例变量
          this.metaInStr = inStr;
          this.metaEscape = esc;
          return;
        }
        continue;
      }

      if (this.state === STATE.IN_DEVICES_ARR) {
        this._skipWhitespaceAndComma();
        if (this._eof()) return;
        if (this._peek() === ']') {
          this._next();
          // 1.6.7 修复: data 对象里 devices 之后还有 categories / shelves / currentShelfId 等
          //   字段, 不能在这里直接 DONE, 要回到 IN_DATA_OBJ 继续解析后续 meta
          //   (老代码直接置 DONE, 导致 devices 之后的 categories 被完全跳过,
          //    mergeCategoriesFromBackup 拿不到 backupCategories, 用户看不到导入的分类)
          this.state = STATE.IN_DATA_OBJ;
          progressed = true;
          continue;
        }
        if (this._peek() === '{') {
          this.deviceStartChunk = this.chunkIdx;
          this.deviceStartPos = this.chunkPos;
          this.braceDepth = 1;
          this.inStr = false;
          this.escape = false;
          this._next();   // 消耗开括号
          this.state = STATE.IN_DEVICE_OBJ;
          progressed = true;
        } else {
          this._next();
          progressed = true;
        }
        continue;
      }

      if (this.state === STATE.IN_DEVICE_OBJ) {
        // 1.6.6 修复: 用实例变量 this.inStr / this.braceDepth 替代局部变量,
        //   这样当 device 跨越多段 feed() (含 base64 图片的大器件) 时,
        //   _consume() 在 !found 时 return, 下次 feed() 再进入这里,
        //   字符串/大括号深度状态能正确保留, 不会误判 } 为 device 结束。
        //   (老代码用局部 let inStr/depth, 每次 _consume 重入都重置为 false/1,
        //    导致跨 chunk 的字符串状态丢失, } 被错误计数, 只导入前几个器件)
        const startChunk = this.deviceStartChunk;
        const startPos = this.deviceStartPos;
        let i = this.chunkIdx;
        let p = this.chunkPos;
        // this.inStr / this.braceDepth / this.escape 由 IN_DEVICES_ARR 进入时初始化
        let found = false;
        // 1.6.3: 用 String.indexOf 替代逐字符循环, native C++ 实现
        //   - 单设备 200KB+ 文本 (主要被 base64 占据), 99% 是普通字符
        //   - 老逻辑: 17M 次 JS char 比较 ≈ 4μs/次 ≈ 68s
        //   - 新逻辑: indexOf 单次 native 调用, 整段跳过, 同文件 < 2s
        outer:
        while (i < this.chunks.length) {
          const c = this.chunks[i];
          let j = (i === this.chunkIdx) ? this.chunkPos : 0;
          while (j < c.length) {
            if (this.inStr) {
              // 字符串内: 找下一个 " (跳过转义)
              // indexOf 是 native C++, 比 JS char 循环快 50-100 倍
              const next = c.indexOf('"', j);
              if (next < 0) {
                // 整个 chunk 后都是字符串内容
                j = c.length;
              } else {
                // 检查是否是 \" (转义): 数前面连续的 \
                let bc = 0;
                for (let k = next - 1; k >= 0 && c[k] === '\\'; k--) bc++;
                if (bc % 2 === 0) {
                  // 未转义的 ", 字符串结束
                  this.inStr = false;
                  j = next + 1;
                } else {
                  // 转义的 ", 跳过
                  j = next + 1;
                }
              }
              continue;
            }
            // 非字符串: 找下一个 ", {, } 的最近位置
            // 3 次 indexOf (native), 取代之前 17M 次 char 比较
            const nq = c.indexOf('"', j);
            const no = c.indexOf('{', j);
            const nc = c.indexOf('}', j);
            // 找最近的
            let min = -1;
            let which = 0;  // 0=", 1={, 2=}
            if (nq >= 0) { min = nq; which = 0; }
            if (no >= 0 && (min < 0 || no < min)) { min = no; which = 1; }
            if (nc >= 0 && (min < 0 || nc < min)) { min = nc; which = 2; }
            if (min < 0) {
              // 整个 chunk 没有特殊字符, 跳过
              j = c.length;
              continue;
            }
            if (which === 0) {
              this.inStr = true;
              j = min + 1;
            } else if (which === 1) {
              this.braceDepth++;
              j = min + 1;
            } else {
              // which === 2
              this.braceDepth--;
              if (this.braceDepth === 0) {
                // 找到了! 提取 device JSON
                const endChunk = i;
                const endPos = min + 1;
                const jsonText = this._extract(
                  { chunkIdx: startChunk, pos: startPos },
                  { chunkIdx: endChunk, pos: endPos }
                );
                try {
                  const obj = JSON.parse(jsonText);
                  this.onDevice(obj, this.deviceIndex);
                  this.deviceIndex++;
                } catch (e) {
                  console.warn('[streamJson] device 解析失败, 跳过:', e?.message, jsonText.slice(0, 80));
                }
                // 消费到结束
                this._consumeN(this._distance(this.chunkIdx, this.chunkPos, endChunk, endPos));
                this.deviceStartChunk = -1;
                this.deviceStartPos = -1;
                this.state = STATE.IN_DEVICES_ARR;
                progressed = true;
                found = true;
                break outer;
              }
              j = min + 1;
            }
          }
          // 一个 chunk 处理完, 推进到下一个
          i++;
          p = 0;
          this.chunkIdx = i;
          this.chunkPos = 0;
        }
        if (!found) {
          // 还没找到结束, 让出控制权, 等下一段 feed 进来
          return;
        }
        continue;
      }
    }
  }

  /**
   * 计算从 (startChunk, startPos) 到 (endChunk, endPos) 之间的字符数
   */
  _distance(startChunk, startPos, endChunk, endPos) {
    if (startChunk === endChunk) {
      return endPos - startPos;
    }
    let n = this.chunks[startChunk].length - startPos;
    for (let i = startChunk + 1; i < endChunk; i++) {
      n += this.chunks[i].length;
    }
    n += endPos;
    return n;
  }

  /**
   * 读取一个 JSON key (从当前位置开始), 返回 unescape 后的字符串
   * 失败返回 null
   */
  _readKey() {
    if (this._peek() !== '"') return null;
    this._next();  // 消耗开引号
    let result = '';
    while (!this._eof()) {
      const c = this._next();
      if (c === '\\') {
        const e = this._next();
        if (e === undefined) return null;
        result += '\\' + e;
        continue;
      }
      if (c === '"') {
        return unescapeString(result);
      }
      result += c;
      // 防御: key 不应该很长
      if (result.length > 200) return null;
    }
    return null;
  }

  /**
   * 从当前位置开始找 key, 返回相对当前 chunkPos 的偏移; -1 表示没找到
   * 1.4.2: 实现是 O(剩余 buffer) 但不走 string concat, 直接逐 chunk 扫
   */
  _findKey(key) {
    const needle = '"' + key + '"';
    let i = this.chunkIdx;
    let p = this.chunkPos;
    let inStr = false;
    let esc = false;
    let absStart = 0;  // 相对当前 chunkPos 的偏移
    while (i < this.chunks.length) {
      const c = this.chunks[i];
      const startJ = (i === this.chunkIdx) ? this.chunkPos : 0;
      for (let j = startJ; j < c.length; j++) {
        const ch = c[j];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
        } else if (ch === '"') {
          // 尝试匹配 needle (跨 chunk 边界)
          if (this._startsWith(needle, i, j)) {
            // 还要看后面是不是 ":"
            const after = this._peekAt(i, j + needle.length, 5);
            if (after && /^\s*:/.test(after)) {
              return absStart;
            }
          }
          inStr = true;
        }
        absStart++;
      }
      i++;
    }
    return -1;
  }

  /**
   * 检查 chunks 在 (chunkIdx, pos) 位置是否以 needle 开头 (跨 chunk)
   */
  _startsWith(needle, chunkIdx, pos) {
    let i = chunkIdx;
    let p = pos;
    for (let n = 0; n < needle.length; n++) {
      while (i < this.chunks.length && p >= this.chunks[i].length) {
        i++;
        p = 0;
      }
      if (i >= this.chunks.length) return false;
      if (this.chunks[i][p] !== needle[n]) return false;
      p++;
    }
    return true;
  }

  /**
   * 从 (chunkIdx, pos) 开始读 n 个字符
   */
  _peekAt(chunkIdx, pos, n) {
    let s = '';
    let i = chunkIdx;
    let p = pos;
    while (i < this.chunks.length && s.length < n) {
      const c = this.chunks[i];
      if (p < c.length) {
        s += c.substring(p, Math.min(p + (n - s.length), c.length));
        p += s.length;
        if (p >= c.length) { i++; p = 0; }
      } else {
        i++;
        p = 0;
      }
    }
    return s;
  }

  _findScalarEnd() {
    let i = this.chunkIdx;
    let p = this.chunkPos;
    let inStr = false;
    let esc = false;
    let absStart = 0;
    while (i < this.chunks.length) {
      const c = this.chunks[i];
      const startJ = (i === this.chunkIdx) ? this.chunkPos : 0;
      for (let j = startJ; j < c.length; j++) {
        const ch = c[j];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === ',' || ch === '}' || ch === ']') {
          return absStart;
        }
        absStart++;
      }
      i++;
    }
    return -1;
  }
}

function unescapeString(s) {
  return s.replace(/\\(.)/g, '$1');
}

/**
 * 1.4.1 v4: 智能打开 URI (content:// / file://)
 *
 * 策略:
 *   1) 优先 fetch(uri).arrayBuffer() - 走 OkHttp (content://) 或 file:// 直接读
 *      一次性拿字节数组, 不写中间文件, 比 copyAsync 快很多
 *   2) fallback: copyAsync 到 cache + fetch localUri (兼容老设备)
 *
 * @param {string} uri
 * @returns {Promise<{bytes: Uint8Array, cleanup: () => Promise<void>, totalBytes: number}>}
 */
export async function openImportBytes(uri) {
  // 1) 优先直接 fetch (RN 0.60+ fetch 支持 content:// / file://)
  //    注意: 大文件 (>30MB) 在部分 Android 设备上会 "Network request failed"
  //          streamFetchChunked 已改为优先走 streamReadFileChunked (expo-file-system), 不经过这里
  try {
    const response = await fetch(uri);
    if (response.ok) {
      const ab = await response.arrayBuffer();
      const bytes = new Uint8Array(ab);
      if (bytes.length > 0) {
        return {
          bytes,
          totalBytes: bytes.length,
          cleanup: async () => { /* no temp file */ },
        };
      }
    }
  } catch (e) {
    console.warn('[streamJson] 直接 fetch 失败, 回退 copy+fetch:', e?.message);
  }

  // 2) fallback: copy 到 cache + fetch
  const FileSystem = require('expo-file-system/legacy');
  const cacheDir = FileSystem.cacheDirectory || '';
  const safeName = (uri.split('/').pop() || 'imported').replace(/[\\/:*?"<>|]/g, '_').slice(0, 32);
  const localUri = `${cacheDir}import_${Date.now()}_${safeName}`;
  await FileSystem.copyAsync({ from: uri, to: localUri });
  const response = await fetch(localUri);
  const ab = await response.arrayBuffer();
  const bytes = new Uint8Array(ab);
  return {
    bytes,
    totalBytes: bytes.length,
    cleanup: async () => {
      try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (e) { /* ignore */ }
    },
  };
}

/**
 * 1.6.5: base64 → Uint8Array 解码 (零依赖, 查表法)
 * 用于 expo-file-system readAsStringAsync(encoding: 'base64') 后的解码
 *
 * @param {string} b64 - base64 字符串 (可能含换行/空格, 会先 trim)
 * @returns {Uint8Array} 解码后的字节数组
 */
const B64_LOOKUP = (() => {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const arr = new Int8Array(128).fill(-1);
  for (let i = 0; i < CHARS.length; i++) arr[CHARS.charCodeAt(i)] = i;
  arr[61] = 0; // '=' padding 当 0 处理
  return arr;
})();

function decodeBase64ToBytes(b64) {
  if (!b64 || typeof b64 !== 'string') return new Uint8Array(0);
  // 去掉空白 (expo-file-system 有时会带换行)
  const clean = b64.replace(/\s/g, '');
  const len = clean.length;
  if (len === 0) return new Uint8Array(0);

  // 计算输出长度
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  const byteLen = ((len * 3) >> 2) - padding;
  const bytes = new Uint8Array(byteLen);

  let byteIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = B64_LOOKUP[clean.charCodeAt(i)] || 0;
    const c2 = B64_LOOKUP[clean.charCodeAt(i + 1)] || 0;
    const c3 = B64_LOOKUP[clean.charCodeAt(i + 2)] || 0;
    const c4 = B64_LOOKUP[clean.charCodeAt(i + 3)] || 0;

    bytes[byteIdx++] = (c1 << 2) | (c2 >> 4);
    if (byteIdx < byteLen) bytes[byteIdx++] = ((c2 & 0x0f) << 4) | (c3 >> 2);
    if (byteIdx < byteLen) bytes[byteIdx++] = ((c3 & 0x03) << 6) | c4;
  }

  return bytes;
}

/**
 * 1.6.5: 用 expo-file-system 按位置/长度分块读文件, 彻底绕开 fetch
 *
 * 为什么不用 fetch + arrayBuffer?
 *   - Android 上 fetch 对 content:// / 大 file:// 经常报 "Network request failed"
 *   - fetch().arrayBuffer() 一次性把整个文件加载到内存, 41MB 文件 = 41MB JS heap
 *   - 本方案: 每 512KB 读一次 (base64 编码), 解码后喂 TextDecoder, 内存峰值 < 2MB
 *
 * @param {string} uri - content:// 或 file:// URI
 * @param {object} [hooks]
 * @param {(p: {read: number, total: number, phase: string}) => void} [hooks.onProgress]
 * @param {(text: string) => void} [hooks.onChunk] - 解码后的 UTF-8 文本片段
 * @param {(text: string) => void} [hooks.onEnd] - 文件读完回调
 * @returns {Promise<{abort: () => void, totalBytes: number}>}
 */
export async function streamReadFileChunked(uri, { onProgress, onChunk, onEnd } = {}) {
  const FileSystem = require('expo-file-system/legacy');

  // 1) 如果是 content:// URI, 先 copy 到 cache 目录 (expo-file-system 对 file:// 支持最好)
  let filePath = uri;
  let tempFile = null;
  if (uri.startsWith('content://')) {
    const cacheDir = FileSystem.cacheDirectory || '';
    const safeName = (uri.split('/').pop() || 'imported').replace(/[\\/:*?"<>|]/g, '_').slice(0, 32);
    tempFile = `${cacheDir}import_${Date.now()}_${safeName}`;
    console.log('[streamReadFile] content:// URI, 先 copy 到 cache:', tempFile);
    await FileSystem.copyAsync({ from: uri, to: tempFile });
    filePath = tempFile;
  }

  // 2) 拿文件大小
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info || !info.exists) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const total = info.size || 0;
  console.log('[streamReadFile] 文件大小:', total, 'bytes,', (total / 1024 / 1024).toFixed(2), 'MB');
  if (total === 0) {
    if (onEnd) onEnd('');
    if (onProgress) onProgress({ read: 0, total: 0, phase: 'done' });
    if (tempFile) { try { await FileSystem.deleteAsync(tempFile, { idempotent: true }); } catch (e) { /* ignore */ } }
    return { abort: () => {}, totalBytes: 0 };
  }

  // 3) 分块读 (base64 encoding + position/length)
  //    512KB raw → ~683KB base64 字符串, 解码后 512KB bytes
  //    41MB 文件 = 80 次 readAsStringAsync, 每次约 50-100ms, 总计 4-8 秒
  const CHUNK_RAW = 512 * 1024; // 512KB raw bytes per read
  const decoder = new TextDecoder('utf-8');
  let aborted = false;
  let processed = 0;
  const YIELD_EVERY = 4; // 每 4 chunk (2MB) 让一次主循环

  try {
    let chunkIdx = 0;
    for (let pos = 0; pos < total; pos += CHUNK_RAW) {
      if (aborted) break;
      const len = Math.min(CHUNK_RAW, total - pos);

      // 读 base64 chunk (expo-file-system 只支持 base64 + position/length 组合)
      const b64 = await FileSystem.readAsStringAsync(filePath, {
        encoding: 'base64',
        position: pos,
        length: len,
      });

      // base64 → bytes → UTF-8 text
      const bytes = decodeBase64ToBytes(b64);
      const text = decoder.decode(bytes, { stream: true });
      if (text && onChunk) onChunk(text);

      processed = pos + len;
      if (onProgress) {
        onProgress({ read: processed, total, phase: 'downloading' });
      }

      chunkIdx++;
      if (chunkIdx % YIELD_EVERY === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // flush decoder (处理最后的多字节字符)
    const tail = decoder.decode();
    if (tail && onChunk) onChunk(tail);

    if (onEnd) onEnd('');
    if (onProgress) onProgress({ read: processed, total, phase: 'done' });
  } finally {
    // 清理临时文件
    if (tempFile) {
      try { await FileSystem.deleteAsync(tempFile, { idempotent: true }); } catch (e) { /* ignore */ }
    }
  }

  return {
    abort: () => { aborted = true; },
    totalBytes: total,
  };
}

/**
 * 1.4.1 v2 修复: 用 fetch + arrayBuffer + 手动分块喂 parser
 *
 * 为什么不直接用 XHR onprogress?
 *   - RN 0.83 上 XMLHttpRequest.onprogress 对 file:// 行为不稳定
 *     (有的设备触发, 有的直接 onload, 有的 onerror 假报成功)
 *   - 改用 fetch + arrayBuffer (老 1.3 优化已验证可用), 拿到字节数组
 *   - 然后手动分 64KB 喂给 StreamParser.feed(), 中间 setTimeout(0) 让 UI 刷新
 *
 * 内存峰值:
 *   - fetch + arrayBuffer: 41MB 字节数组 (Java 侧 Uint8Array, 不经 UTF-16 转换)
 *   - parser 内部: 1 个 device + 1 个 batch (500 device) ≈ 5-10MB
 *   - 合计: ~50MB (1.3 之前是 100-150MB, 已降一半)
 *   - 200MB 文件: ~250MB Java 字节, 现代 mobile 2-4GB RAM 够用
 *
 * 进度条:
 *   - 每 64KB onProgress 一次, React state 60fps
 *   - parser.feed 是同步的, 中间 setTimeout(0) 让 React 调度刷新
 */
export async function streamFetchChunked(bytesOrUri, { onProgress, onChunk, onEnd } = {}) {
  // 1.6.5: URI 字符串优先走 streamReadFileChunked (expo-file-system 分块读)
  //   彻底绕开 fetch, 解决 "Network request failed" (41MB+ content:// / file:// 文件)
  //   fetch + arrayBuffer 一次性把整个文件加载到 JS heap, 大文件直接失败
  //   streamReadFileChunked 每 512KB 读一次, 内存峰值 < 2MB
  if (typeof bytesOrUri === 'string') {
    return streamReadFileChunked(bytesOrUri, { onProgress, onChunk, onEnd });
  }

  // 2) 如果已经是 Uint8Array, 用内存分块 (老路径, 保留兼容)
  let bytes;
  let total;
  let cleanup = async () => {};
  if (bytesOrUri instanceof Uint8Array) {
    bytes = bytesOrUri;
    total = bytes.length;
  } else {
    const opened = await openImportBytes(bytesOrUri);
    bytes = opened.bytes;
    total = opened.totalBytes;
    cleanup = opened.cleanup;
  }
  if (total === 0) {
    if (onEnd) onEnd('');
    onProgress && onProgress({ read: 0, total: 0, phase: 'done' });
    await cleanup();
    return { abort: () => {}, totalBytes: 0 };
  }

  const CHUNK = 64 * 1024; // 64KB
  const decoder = new TextDecoder('utf-8');
  let aborted = false;
  let processed = 0;
  // 1.4.1 v5 优化: 之前每 64KB 都 setTimeout(0) 让出主循环,
  // 41MB 文件 640 次 setTimeout 累加就是 2~6s 纯等待时间 (用户体感"慢")
  // 改为: 每 16 chunk (1MB) 让一次, 进度更新每 4 chunk (256KB) 一次
  // 内存峰值几乎不变 (parser 内部 buf 累加), 但主循环阻塞时间大幅下降
  const YIELD_EVERY_N_CHUNKS = 16;
  const PROGRESS_EVERY_N_CHUNKS = 4;

  try {
    let chunkIdx = 0;
    for (let i = 0; i < total; i += CHUNK) {
      if (aborted) break;
      const end = Math.min(i + CHUNK, total);
      const slice = bytes.subarray(i, end);
      const text = decoder.decode(slice, { stream: true });
      if (text && onChunk) onChunk(text);
      processed = end;
      if (onProgress && (chunkIdx % PROGRESS_EVERY_N_CHUNKS === 0 || end === total)) {
        onProgress({ read: processed, total, phase: 'downloading' });
      }
      chunkIdx++;
      // 让出主循环, 让 React 状态刷新 (1.4.1 v5: 改 N chunk 让一次)
      if (chunkIdx % YIELD_EVERY_N_CHUNKS === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    // flush decoder
    const tail = decoder.decode();
    if (tail && onChunk) onChunk(tail);
    if (onEnd) onEnd('');
    if (onProgress) onProgress({ read: processed, total, phase: 'done' });
  } finally {
    await cleanup();
  }
  return {
    abort: () => { aborted = true; },
    totalBytes: total,
  };
}

/**
 * 用 XHR 流式读取 file:// / content:// URI
 * RN 上 fetch().body 不可用, 改用 XMLHttpRequest 的 onprogress 事件
 *
 * 注意: RN 0.83 上 XHR onprogress 对 file:// 行为不稳定, 1.4.1 v2 已切到 streamFetchChunked
 *       此函数保留以备未来 RN 升级后使用
 *
 * @param {string} uri
 * @param {object} hooks
 * @param {(p: {read: number, total?: number, phase: string}) => void} hooks.onProgress
 * @param {(text: string) => void} hooks.onChunk - 每次 XHR onprogress 触发时, 把新增的 text 喂给 parser
 * @param {(text: string) => void} [hooks.onEnd] - XHR onload 时, 把剩余 text 喂给 parser
 * @returns {Promise<{abort: () => void, totalBytes: number | undefined}>}
 */
export function streamXhrRead(uri, { onProgress, onChunk, onEnd }) {
  return new Promise((resolve, reject) => {
    let lastResponseText = '';
    const xhr = new XMLHttpRequest();
    xhr.open('GET', uri, true);
    if (!xhr.overrideMimeType) {
      try { xhr.overrideMimeType('text/plain; charset=utf-8'); } catch (e) { /* ignore */ }
    }
    let lastTotal = 0;
    xhr.onprogress = (e) => {
      try {
        const cur = xhr.responseText || '';
        if (cur.length > lastResponseText.length) {
          const delta = cur.slice(lastResponseText.length);
          lastResponseText = cur;
          onChunk(delta);
        }
        if (typeof e.loaded === 'number') lastTotal = e.loaded;
        onProgress({ read: e.loaded, total: e.total, phase: 'downloading' });
      } catch (err) {
        // ignore
      }
    };
    xhr.onload = () => {
      try {
        const cur = xhr.responseText || '';
        if (cur.length > lastResponseText.length) {
          const delta = cur.slice(lastResponseText.length);
          onChunk(delta);
          lastResponseText = cur;
        }
        if (onEnd) onEnd('');
        onProgress({ read: cur.length, total: lastTotal, phase: 'done' });
        resolve({ abort: () => { try { xhr.abort(); } catch (e) {} }, totalBytes: cur.length });
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = (e) => {
      try {
        const cur = xhr.responseText || '';
        if (cur.length > 0) {
          if (cur.length > lastResponseText.length) {
            onChunk(cur.slice(lastResponseText.length));
            lastResponseText = cur;
          }
          if (onEnd) onEnd('');
          resolve({ abort: () => { try { xhr.abort(); } catch (e) {} }, totalBytes: cur.length });
          return;
        }
      } catch (e2) { /* ignore */ }
      reject(new Error('XMLHttpRequest 读取失败'));
    };
    try {
      xhr.send();
    } catch (e) {
      reject(e);
    }
  });
}

export default { StreamParser, streamXhrRead, streamFetchChunked, streamReadFileChunked, openImportBytes, STATE };
