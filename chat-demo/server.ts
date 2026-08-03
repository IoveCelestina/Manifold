// Manifold chat-demo 服务器：静态文件 + 服务端推理 + cookie 鉴权 + 同源反向代理。
//
// 浏览器只跟本服务同源通信，且不再持有 key/JWT —— 凭证活在服务端 session（见 db.ts），
// 浏览器仅持一个 httpOnly cookie。
//   /api/session/*      登录 / 2FA / 免登录贴 key / 登出 / me（服务端会话）
//   /api/keys[/select]  账户 key 列表 / 选定（key 明文不出服务端）
//   /api/models         透传上游 /v1/models（服务端用 session.api_key 调）
//   /api/conversations/:id/messages  聊天 SSE（服务端注入系统提示 + 用 session.api_key 调上游）
//   /api/conversations/:id/videos    方舟视频后台任务（持久化、可重连、成片落私有 blob）
//   /store/*            会话存储（按 session.uid 隔离，沿用整条 JSON blob 模型）
//   /api/v1/* /v1/*     旧的同源代理（迁移期保留，0d 下线）
//
// 用法：node server.ts  ｜  SUB2API_BASE=https://zstuacm.xyz PORT=8787 node server.ts
//
// 本文件是 TS：Node 24 的 type stripping 直接执行（仅擦类型、无构建）。沿用 CommonJS 的
// require/module，只补类型注解；req/res 等 Node 类型用 import type 引入（编译期擦除）。

import type { IncomingMessage, ServerResponse } from 'node:http';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');

const BASE: string = (process.env.SUB2API_BASE || 'https://zstuacm.xyz').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 8787);

// 豆包生图（chat-demo 直连火山方舟出图 + 计费回扣到用户的 sub2api 余额）
const ARK_BASE: string = (process.env.ARK_BASE || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
const ARK_API_KEY: string = process.env.ARK_API_KEY || '';
const SUB2API_ADMIN_KEY: string = process.env.SUB2API_ADMIN_KEY || '';
const DOUBAO_PRICE_USD: number = Number(process.env.DOUBAO_PRICE_USD || 0.10);   // 每张扣多少 USD（先一口价）
// 豆包视频 2.0：使用现有方舟 Key，任务完成后按返回的 completion_tokens 与 sub2api 余额结算。
const SEEDANCE_MODEL: string = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-260128';
const SEEDANCE_PRICE_USD_PER_M_TOKENS = Number(process.env.SEEDANCE_PRICE_USD_PER_M_TOKENS || 46);
// 官方资源包给出的量级约为 700 万 Tokens / 28 个 480P 视频；以 5 秒为基准做保守预授权。
const SEEDANCE_BASE_TOKENS_480P_5S = Number(process.env.SEEDANCE_BASE_TOKENS_480P_5S || 250_000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// 静态资源版本号 = app.js/style.css 内容哈希。部署后内容变 → index.html 引用的 ?v= 变 →
// 浏览器/CF 强制取新版前端，免手动 Purge（CF 对 .js/.css 的边缘缓存常导致部署后仍跑旧前端）。
let ASSET_VER = '0';
try {
  const h = crypto.createHash('sha256');
  for (const f of ['app.js', 'style.css']) h.update(fs.readFileSync(path.join(PUBLIC_DIR, f)));
  ASSET_VER = h.digest('hex').slice(0, 10);
} catch { /* 文件缺失则用默认值 */ }

// 旧的浏览器直打代理（/api/v1/* 与 /v1/*）。前端 0b 起已全改走 /api/*，不再用它。
// 迁移期默认保留作回退；生产灰度确认新链路无误后，设 LEGACY_PROXY=off 即下线（无需改代码、可随时回退）。
const LEGACY_PROXY = (process.env.LEGACY_PROXY || 'on').toLowerCase() !== 'off';

// 旧的整段会话存储（/store/*）。Phase 1 前端已改走 /api/conversations，不再用它。
// 跑完迁移（migrate-phase1.ts）+ 灰度确认后，设 LEGACY_STORE=off 下线（可回退）。
const LEGACY_STORE = (process.env.LEGACY_STORE || 'on').toLowerCase() !== 'off';

// ── 会话存储 + 服务端 session（node:sqlite 单文件）──────────────────
const db = require('./db.ts');
function positiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

// 请求体按用途分档。blob 不走内存聚合，另由 BLOB_MAX_BYTES 流式限制。
const AUTH_MAX_BODY = positiveIntEnv('AUTH_MAX_BODY_BYTES', 16 * 1024);
const SMALL_JSON_MAX_BODY = positiveIntEnv('SMALL_JSON_MAX_BODY_BYTES', 64 * 1024);
const CHAT_MAX_BODY = positiveIntEnv('CHAT_MAX_BODY_BYTES', 2 * 1024 * 1024);
const IMAGE_MAX_BODY = positiveIntEnv('IMAGE_MAX_BODY_BYTES', 16 * 1024 * 1024);
const MAX_BODY = positiveIntEnv('MAX_JSON_BODY_BYTES', 16 * 1024 * 1024);
const STORE_MAX_BODY = positiveIntEnv('STORE_MAX_BODY_BYTES', 16 * 1024 * 1024);
const API_KEY_MAX_LENGTH = positiveIntEnv('API_KEY_MAX_LENGTH', 512);
const BLOB_MAX_BYTES = positiveIntEnv('BLOB_MAX_BYTES', 8 * 1024 * 1024);
const BLOB_MAX_COUNT_PER_USER = positiveIntEnv('BLOB_MAX_COUNT_PER_USER', 1000);
const BLOB_MAX_BYTES_PER_USER = positiveIntEnv('BLOB_MAX_BYTES_PER_USER', 500 * 1024 * 1024);
const BLOB_MAX_BYTES_TOTAL = positiveIntEnv('BLOB_MAX_BYTES_TOTAL', 20 * 1024 * 1024 * 1024);
const BLOB_MAX_CONCURRENT_PER_USER = positiveIntEnv('BLOB_MAX_CONCURRENT_PER_USER', 2);
const BLOB_MAX_CONCURRENT_TOTAL = positiveIntEnv('BLOB_MAX_CONCURRENT_TOTAL', 16);
const VIDEO_MAX_BYTES = positiveIntEnv('VIDEO_MAX_BYTES', 200 * 1024 * 1024);
const VIDEO_POLL_INTERVAL_MS = positiveIntEnv('VIDEO_POLL_INTERVAL_MS', 5000);
const VIDEO_TASK_TIMEOUT_MS = positiveIntEnv('VIDEO_TASK_TIMEOUT_MS', 45 * 60 * 1000);
const VIDEO_MAX_CONCURRENT_PER_USER = positiveIntEnv('VIDEO_MAX_CONCURRENT_PER_USER', 1);
const VIDEO_MAX_CONCURRENT_TOTAL = positiveIntEnv('VIDEO_MAX_CONCURRENT_TOTAL', 4);
const REQUEST_TIMEOUT_MS = positiveIntEnv('REQUEST_TIMEOUT_MS', 2 * 60 * 1000);
const MAX_MESSAGE_TEXT_BYTES = positiveIntEnv('MAX_MESSAGE_TEXT_BYTES', 200 * 1024);
const MAX_CONV_TITLE_LENGTH = positiveIntEnv('MAX_CONV_TITLE_LENGTH', 200);
const MAX_ATTACHMENTS = positiveIntEnv('MAX_ATTACHMENTS', 4);
const CONV_ID_RE = /^[A-Za-z0-9_-]{1,128}$/; // 合法会话 id（与前端 c_xxx 命名一致）
const HASH_RE = /^[a-f0-9]{64}$/;            // sha256 hex，校验 /api/blobs/:hash 防路径穿越

// blob 二进制存储：内容寻址，落 BLOB_DIR（默认与 DB 同目录的 blobs/，生产命名卷 /data/blobs）。
const BLOB_DIR: string = process.env.BLOB_DIR || path.join(path.dirname(db.DB_PATH), 'blobs');
fs.mkdirSync(BLOB_DIR, { recursive: true });
function blobPath(hash: string): string { return path.join(BLOB_DIR, hash); }
function sha256(buf: Buffer): string { return crypto.createHash('sha256').update(buf).digest('hex'); }

// 只有能由短魔数明确识别的位图才允许同源内联。SVG/HTML/声明与内容不符的文件一律下载。
function sniffSafeImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function sniffSafeVideoMime(buf: Buffer): string | null {
  // ISO Base Media File Format：首个 box 的 type 位于 4..8；Seedance 当前输出 MP4。
  return buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp' ? 'video/mp4' : null;
}

// 服务端生成图片也走同一套用户/全局配额，避免绕过上传端点直接撑满 blob 卷。
function persistBufferBlobForUser(uid: number, buf: Buffer, requestedMime: string): string | null {
  const hash = sha256(buf);
  const finalPath = blobPath(hash);
  const hadMeta = !!db.getBlobMeta(hash);
  let createdFile = false;
  const tempPath = path.join(BLOB_DIR, `.generated-${crypto.randomBytes(16).toString('hex')}.tmp`);
  try {
    if (!fs.existsSync(finalPath)) {
      fs.writeFileSync(tempPath, buf, { flag: 'wx', mode: 0o600 });
      try { fs.linkSync(tempPath, finalPath); createdFile = true; }
      catch (e: any) { if (e?.code !== 'EEXIST') throw e; }
    }
    const mime = sniffSafeImageMime(buf.subarray(0, 32)) || requestedMime || 'application/octet-stream';
    const claim = db.claimBlob(
      uid, hash, mime, buf.length,
      BLOB_MAX_COUNT_PER_USER, BLOB_MAX_BYTES_PER_USER, BLOB_MAX_BYTES_TOTAL
    );
    if (!claim.ok) {
      if (createdFile && !hadMeta && !db.getBlobMeta(hash)) fs.rmSync(finalPath, { force: true });
      console.warn(`[blob-quota] generated image rejected uid=${uid} code=${claim.code}`);
      return null;
    }
    return hash;
  } catch (e: any) {
    if (createdFile && !hadMeta && !db.getBlobMeta(hash)) fs.rmSync(finalPath, { force: true });
    console.error('[blob] generated image persist failed:', e?.message || e);
    return null;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

// Phase 2：纯文本类文件附件——按 UTF-8 读进上下文。单文件注入上限，超出截断。
const FILE_TEXT_MAX = 100_000;
// 文本类扩展名白名单（仅这些 + text/* mime 放行，二进制一律拒/忽略）。
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'jsonl', 'ndjson',
  'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'env', 'sql', 'sh', 'bash', 'zsh',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'py', 'rb', 'php',
  'java', 'kt', 'swift', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'm',
  'html', 'htm', 'css', 'scss', 'less', 'r', 'lua', 'pl', 'dart', 'gradle',
]);
function isTextLike(mime: string, name: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (m === 'application/json' || m === 'application/xml' || m === 'application/x-ndjson') return true;
  if (/\+(json|xml)$/.test(m)) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return TEXT_EXT.has(ext);
}

// cookie 规格：HttpOnly + SameSite=Lax + Path=/。Secure 默认按 X-Forwarded-Proto 自动判定
// （生产经 Caddy/CF 是 https → 带 Secure；本地直连 http → 不带，否则浏览器拒存 cookie）。
// 也可用 COOKIE_SECURE=on/off 强制。
const COOKIE_NAME = 'mf_session';
const COOKIE_SECURE_MODE = (process.env.COOKIE_SECURE || 'auto').toLowerCase();

// Codex 后端默认一副「代码工作区」腔调，会跟用户扯查项目结构/生成文件；用系统提示掰回闲聊场景。
// 0b 起系统提示移到后端，前端再也看不到/改不了。
const CHAT_SYSTEM_PROMPT =
  '你是一个友好的 AI 助手，在网页聊天界面中与用户对话，用用户的语言回复。' +
  '你没有文件系统、代码工作区或运行环境，不能创建/保存/输出文件；' +
  '所有内容都直接以文字和 Markdown 在对话里呈现。' +
  '你自己不能生成图片：用户想要生成或修改图片时，告诉他把右上角模型切换到 gpt-image-2 后直接描述画面（可附参考图）。';

// ── 按 IP 限流（令牌桶）─────────────────────────────────────────
// 本服务设计为只跑在反代（Caddy）后面：真实客户端 IP 由 Caddy 经 X-Forwarded-For 透传进来。
// ⚠ 直接裸暴露到公网时 XFF 可伪造，限流即失效。
//   auth 档    —— 盖所有登录入口（旧 /api/v1/auth/login* 与新 /api/session/login|2fa|keylogin），挡撞密码
//   general 档 —— 盖 /api /v1 /store，挡刷接口 / 爬；静态资源不计
// 每档 burst 个令牌、windowSec 内匀速回满，超额回 429 + Retry-After。RATE_LIMIT=off 可整体关闭。
const RL_ENABLED = (process.env.RATE_LIMIT || 'on').toLowerCase() !== 'off';
const RL_TIERS = {
  auth: {
    burst: Number(process.env.RL_AUTH_BURST || 20),
    windowSec: Number(process.env.RL_AUTH_WINDOW || 600),
  },
  general: {
    burst: Number(process.env.RL_GENERAL_BURST || 120),
    windowSec: Number(process.env.RL_GENERAL_WINDOW || 60),
  },
};
type RlTier = keyof typeof RL_TIERS;
const rlBuckets = new Map<string, { tokens: number; last: number }>();

function rlTierFor(url: string): RlTier | null {
  if (
    url.startsWith('/api/v1/auth/login') ||
    url.startsWith('/api/session/login') ||
    url.startsWith('/api/session/2fa') ||
    url.startsWith('/api/session/keylogin')
  ) return 'auth';                            // 所有登录入口：严格档挡撞密码
  if (url.startsWith('/api/') || url.startsWith('/v1/') || url.startsWith('/store/')) return 'general';
  return null;                                // 静态资源：不限流
}

function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();   // 最左 = 原始客户端（Caddy 只塞一个值）
  return req.socket?.remoteAddress || 'unknown';
}

function rlTake(tier: RlTier, ip: string, now: number): { ok: true } | { ok: false; retryAfter: number } {
  const cfg = RL_TIERS[tier];
  const refillPerSec = cfg.burst / cfg.windowSec;
  const key = `${tier}:${ip}`;
  let b = rlBuckets.get(key);
  if (!b) { b = { tokens: cfg.burst, last: now }; rlBuckets.set(key, b); }
  b.tokens = Math.min(cfg.burst, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / refillPerSec)) };
}

function rateLimited(req: IncomingMessage, res: ServerResponse): boolean {
  if (!RL_ENABLED) return false;
  const tier = rlTierFor(req.url || '');
  if (!tier) return false;
  const r = rlTake(tier, clientIp(req), Date.now());
  if (r.ok) return false;
  res.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(r.retryAfter),
    'Connection': 'close',
  });
  res.end(JSON.stringify({ error: { message: `请求过于频繁，请约 ${r.retryAfter}s 后再试`, type: 'rate_limited' } }));
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, b] of rlBuckets) if (b.last < cutoff) rlBuckets.delete(k);
}, 10 * 60 * 1000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

// CSP：DOMPurify 之上的兜底——脚本/连接/样式全锁同源；图片和媒体各自只放必要来源。
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// 只透传这些请求头给旧代理；host/origin/cookie 等一律不带。
const FORWARD_REQ_HEADERS = [
  'content-type',
  'authorization',
  'x-api-key',
  'accept',
  'accept-language',
  'x-forwarded-for',
  'x-real-ip',
];

// 这些响应头不能照抄：fetch 已解压、长度和编码由本服务重新决定。
const SKIP_RES_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'set-cookie',
]);

function collectBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (c: Buffer) => {
      if (settled) return; // 超限后继续丢弃已在途的数据，先让 413 响应正常写回。
      total += c.length;
      if (total > limit) {
        settled = true;
        chunks.length = 0;
        reject(Object.assign(new Error(`请求体超过 ${Math.round(limit / 1024 / 1024)}MB 上限`), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (err: Error) => { if (!settled) { settled = true; reject(err); } });
  });
}

async function readJsonBody(req: IncomingMessage, limit = MAX_BODY): Promise<any> {
  const buf = await collectBody(req, limit);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function sendBodyError(res: ServerResponse, err: any, fallback = '请求体非法'): void {
  const status = err?.statusCode === 413 ? 413 : 400;
  if (status === 413) res.setHeader('Connection', 'close');
  sendJson(res, status, { error: { message: status === 413 ? err.message : fallback } });
}

function bodyTextTooLarge(value: unknown, maxBytes = MAX_MESSAGE_TEXT_BYTES): boolean {
  return Buffer.byteLength(String(value ?? ''), 'utf8') > maxBytes;
}

// 背压泵：把上游 web ReadableStream 转发到 res，客户端消费慢时停一拍。返回中断原因（空串=正常）。
async function pumpBody(webBody: any, res: ServerResponse): Promise<string> {
  let truncatedBy = '';
  for await (const chunk of Readable.fromWeb(webBody)) {
    if (res.destroyed) { truncatedBy = 'client-destroyed'; break; }
    if (!res.write(chunk)) {
      const drained = await new Promise<boolean>((resolve) => {
        const onDrain = () => { cleanup(); resolve(true); };
        const onClose = () => { cleanup(); resolve(false); };
        const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); };
        res.once('drain', onDrain);
        res.once('close', onClose);
      });
      if (!drained) { truncatedBy = 'client-closed'; break; }
    }
  }
  return truncatedBy;
}

// ── 旧同源代理（/api/v1/* /v1/*；迁移期保留，0d 下线）──────────────
async function proxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const target = BASE + req.url;
  const headers: Record<string, string> = {};
  for (const h of FORWARD_REQ_HEADERS) {
    const v = req.headers[h];
    if (v) headers[h] = Array.isArray(v) ? v.join(', ') : v;
  }
  headers['accept-encoding'] = 'identity';

  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await collectBody(req);
    } catch (err: any) {
      res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json; charset=utf-8', 'Connection': 'close' });
      res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
      return;
    }
    if (body.length === 0) body = undefined;
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error('上游超时')), 10 * 60 * 1000);
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort(new Error('客户端断开'));
  });

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual', signal: ctrl.signal });
  } catch (err: any) {
    clearTimeout(timeout);
    console.error(`[proxy] ${req.method} ${req.url} -> FAIL ${err.message} (${Date.now() - started}ms)`);
    if (!res.writableEnded) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Connection': 'close' });
      res.end(JSON.stringify({ error: { message: `代理到上游失败: ${err.message}`, type: 'proxy_error', upstream: BASE } }));
    }
    return;
  }

  const resHeaders: Record<string, string> = {};
  upstream.headers.forEach((v: string, k: string) => {
    if (!SKIP_RES_HEADERS.has(k.toLowerCase())) resHeaders[k] = v;
  });
  res.writeHead(upstream.status, resHeaders);

  // 生图链路诊断：记录响应头尾片段，定位截断/格式问题
  const diag = (req.url || '').startsWith('/v1/images/');
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let total = 0;
  let truncatedBy = '';

  if (upstream.body) {
    res.flushHeaders();
    try {
      for await (const chunk of Readable.fromWeb(upstream.body)) {
        total += chunk.length;
        if (diag) {
          if (head.length < 160) head = Buffer.concat([head, chunk]).subarray(0, 160);
          tail = Buffer.concat([tail, chunk]).subarray(-160);
        }
        if (res.destroyed) { truncatedBy = 'client-destroyed'; break; }
        if (!res.write(chunk)) {
          const drained = await new Promise((resolve) => {
            const onDrain = () => { cleanup(); resolve(true); };
            const onClose = () => { cleanup(); resolve(false); };
            const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); };
            res.once('drain', onDrain);
            res.once('close', onClose);
          });
          if (!drained) { truncatedBy = 'client-closed'; break; }
        }
      }
    } catch (err: any) {
      truncatedBy = `upstream: ${err.message}`;
      console.error(`[proxy] ${req.method} ${req.url} stream interrupted: ${err.message}`);
    }
  }
  clearTimeout(timeout);
  res.end();
  console.log(`[proxy] ${req.method} ${req.url} -> ${upstream.status} (${Date.now() - started}ms)`);
  if (diag) {
    console.log(`[diag] ${req.url} status=${upstream.status} type=${upstream.headers.get('content-type')} bytes=${total} truncated=${truncatedBy || 'no'}`);
    console.log(`[diag] head: ${head.toString('utf8').replace(/\n/g, '\\n')}`);
    console.log(`[diag] tail: ${tail.toString('utf8').replace(/\n/g, '\\n')}`);
  }
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ── cookie / session 工具 ──────────────────────────────────────────
function parseCookies(req: IncomingMessage): Record<string, string> {
  const h = req.headers['cookie'];
  if (!h) return {};
  const out: Record<string, string> = {};
  for (const part of String(h).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function getSessionToken(req: IncomingMessage): string | null {
  return parseCookies(req)[COOKIE_NAME] || null;
}
function cookieSecure(req: IncomingMessage): boolean {
  if (COOKIE_SECURE_MODE === 'on') return true;
  if (COOKIE_SECURE_MODE === 'off') return false;
  return String(req.headers['x-forwarded-proto'] || '').includes('https'); // auto
}
function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string, maxAgeMs: number): void {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// 写操作 CSRF 兜底：浏览器对跨站写一定带 Origin；同源或无 Origin 放行。配合 SameSite=Lax 双保险。
function sameOrigin(req: IncomingMessage): boolean {
  const o = req.headers['origin'];
  if (!o) return true;
  try { return new URL(o).host === req.headers['host']; } catch { return false; }
}

function maskKey(k: string | null | undefined): string {
  if (!k) return '';
  return k.length <= 12 ? k : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

// ── 上游（sub2api）调用辅助 ─────────────────────────────────────────
// 复刻前端 unwrap：sub2api 业务接口返回 {code,message,data}，也兼容裸返回。
function unwrapUpstream(json: any): any {
  if (json && typeof json === 'object' && 'code' in json) {
    const ok = json.code === 0 || json.code === 200 || json.success === true;
    if (!ok) throw Object.assign(new Error(json.message || `上游错误 code=${json.code}`), { status: 400 });
    return json.data;
  }
  return json;
}

interface UpstreamOpts { token?: string | null; body?: any }
async function upstreamJson(method: string, pathStr: string, opts: UpstreamOpts = {}): Promise<any> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const r = await fetch(BASE + pathStr, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* 空 body */ }
  if (!r.ok) {
    const msg = json?.message || json?.error?.message || `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return unwrapUpstream(json);
}

// 服务端 refresh（移植前端 tryRefresh）：用 session.refresh 换新 jwt，并发 401 共享同一次刷新。
const refreshInflight = new Map<string, Promise<boolean>>();
async function refreshSession(session: any): Promise<boolean> {
  if (!session?.token || !session.refresh) return false;
  let p = refreshInflight.get(session.token);
  if (!p) {
    p = (async () => {
      try {
        const data = await upstreamJson('POST', '/api/v1/auth/refresh', { body: { refresh_token: session.refresh } });
        if (!data?.access_token) return false;
        const newRefresh = data.refresh_token || session.refresh;
        db.updateSessionTokens(session.token, data.access_token, newRefresh);
        session.jwt = data.access_token;          // 更新内存副本，后续重试即用新 jwt
        session.refresh = newRefresh;
        return true;
      } catch { return false; }
      finally { refreshInflight.delete(session.token); }
    })();
    refreshInflight.set(session.token, p);
  }
  return p;
}

// 带 jwt 调上游，遇 401 自动刷新一次再重试。
async function upstreamJsonAuth(session: any, method: string, pathStr: string, body?: any): Promise<any> {
  try {
    return await upstreamJson(method, pathStr, { token: session.jwt, body });
  } catch (e: any) {
    if (e.status === 401 && await refreshSession(session)) {
      return await upstreamJson(method, pathStr, { token: session.jwt, body });
    }
    throw e;
  }
}

function parseApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || key.length > API_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(key)) return null;
  return key;
}

// 在凭证进入本地 session 前向上游做一次只读鉴权；不读取/记录响应体，避免 key 泄露。
async function validateApiKey(key: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error('key 验证超时')), 10_000);
  try {
    const r = await fetch(BASE + '/v1/models', {
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    try { await r.body?.cancel(); } catch { /* response body is irrelevant */ }
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401, message: 'key 无效或无权访问' };
    return { ok: false, status: 502, message: `上游暂时无法验证 key（HTTP ${r.status}）` };
  } catch (e: any) {
    return { ok: false, status: 502, message: e?.name === 'AbortError' ? 'key 验证超时' : '无法连接上游验证 key' };
  } finally {
    clearTimeout(timeout);
  }
}

// 解析 sub2api 的 key 列表（复刻前端 loadAccountKeys）：openai 平台排前。
function parseKeys(keysData: any, groupsData: any): any[] {
  const arr = Array.isArray(keysData) ? keysData : (keysData?.items || keysData?.list || keysData?.keys || []);
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData?.items || groupsData?.list || groupsData?.groups || []);
  const platformByGroup: Record<string, string> = {};
  for (const g of groups) if (g && g.id !== undefined) platformByGroup[g.id] = g.platform || '';
  const keys = arr.map((k: any) => ({
    id: k.id,
    key: k.key || '',
    name: k.name || `key-${k.id}`,
    platform: platformByGroup[k.group_id] || k.platform || k.group?.platform || '',
    status: k.status,
  }));
  keys.sort((a: any, b: any) => Number(b.platform === 'openai') - Number(a.platform === 'openai'));
  return keys;
}
async function fetchKeysByToken(jwt: string): Promise<any[]> {
  const [k, g] = await Promise.all([
    upstreamJson('GET', '/api/v1/keys?page=1&page_size=100', { token: jwt }),
    upstreamJson('GET', '/api/v1/groups/available', { token: jwt }).catch(() => null),
  ]);
  return parseKeys(k, g);
}
async function fetchKeysAuth(session: any): Promise<any[]> {
  const [k, g] = await Promise.all([
    upstreamJsonAuth(session, 'GET', '/api/v1/keys?page=1&page_size=100'),
    upstreamJsonAuth(session, 'GET', '/api/v1/groups/available').catch(() => null),
  ]);
  return parseKeys(k, g);
}

// ── /api/* 应用路由（服务端推理 + cookie 鉴权）────────────────────────

// 登录成功 → 取 uid/email、选 key、建 session、种 cookie。
async function establishSession(req: IncomingMessage, res: ServerResponse, data: any): Promise<void> {
  const jwt = data?.access_token;
  if (!jwt) { sendJson(res, 502, { error: { message: '上游未返回 access_token' } }); return; }
  const refresh = data.refresh_token || null;

  let uid: number | null = null;
  let email: string | null = data?.user?.email || null;
  try {
    const me = await upstreamJson('GET', '/api/v1/auth/me', { token: jwt });
    const raw = me?.id ?? me?.user_id ?? me?.user?.id;
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) uid = Number(raw);
    email = me?.email || email;
  } catch { /* me 失败不阻塞登录 */ }

  // 选 key：唯一/首个有明文的 key（openai 已排前）。账户无 key 时留空，前端引导去设置。
  let apiKey: string | null = null, keyLabel: string | null = null, keyPlatform: string | null = null;
  try {
    const usable = (await fetchKeysByToken(jwt)).filter((k) => k.key);
    if (usable[0]) { apiKey = usable[0].key; keyLabel = usable[0].name; keyPlatform = usable[0].platform; }
  } catch { /* key 拉取失败不阻塞登录 */ }

  const token = db.createSession({
    uid, jwt, refresh, api_key: apiKey, email, key_label: keyLabel, key_platform: keyPlatform,
    key_validated: !!apiKey,
  });
  setSessionCookie(req, res, token, db.SESSION_TTL_MS);
  sendJson(res, 200, { ok: true });
}

async function apiLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try { body = await readJsonBody(req, AUTH_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  if (typeof body.email !== 'string' || body.email.length > 320 || typeof body.password !== 'string' || body.password.length > 1024) {
    sendJson(res, 400, { error: { message: '邮箱或密码格式非法' } }); return;
  }
  try {
    const data = await upstreamJson('POST', '/api/v1/auth/login', { body: { email: body.email, password: body.password } });
    if (data?.temp_token && !data?.access_token) { sendJson(res, 200, { need_2fa: true, ticket: data.temp_token }); return; }
    await establishSession(req, res, data);
  } catch (e: any) {
    sendJson(res, e.status || 502, { error: { message: e.message || '登录失败' } });
  }
}

async function api2fa(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try { body = await readJsonBody(req, AUTH_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  if (typeof body.ticket !== 'string' || body.ticket.length > 4096 || typeof body.code !== 'string' || body.code.length > 32) {
    sendJson(res, 400, { error: { message: '二次验证参数格式非法' } }); return;
  }
  try {
    const data = await upstreamJson('POST', '/api/v1/auth/login/2fa', { body: { temp_token: body.ticket, totp_code: body.code } });
    await establishSession(req, res, data);
  } catch (e: any) {
    sendJson(res, e.status || 502, { error: { message: e.message || '验证失败' } });
  }
}

async function apiKeylogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try { body = await readJsonBody(req, AUTH_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  const key = parseApiKey(body.key);
  if (!key) { sendJson(res, 400, { error: { message: `key 不能为空、不能含控制字符且最长 ${API_KEY_MAX_LENGTH} 字符` } }); return; }
  const checked = await validateApiKey(key);
  if (!checked.ok) { sendJson(res, checked.status, { error: { message: checked.message } }); return; }
  const token = db.createSession({ api_key: key, key_label: maskKey(key), key_validated: true });
  setSessionCookie(req, res, token, db.SESSION_TTL_MS);
  sendJson(res, 200, { ok: true });
}

async function apiLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = db.readSession(getSessionToken(req));
  if (session) {
    if (session.refresh) {
      upstreamJson('POST', '/api/v1/auth/logout', { token: session.jwt, body: { refresh_token: session.refresh } }).catch(() => {});
    }
    db.deleteSession(session.token);
  }
  clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
}

function apiMe(res: ServerResponse, session: any): void {
  sendJson(res, 200, {
    email: session.email || null,
    uid: session.uid,
    key: session.api_key ? { label: session.key_label, platform: session.key_platform, masked: maskKey(session.api_key) } : null,
  });
}

async function apiKeys(res: ServerResponse, session: any): Promise<void> {
  if (session.uid === null) { sendJson(res, 200, { keys: [] }); return; } // 贴 key 模式没有账户 key 列表
  try {
    const keys = await fetchKeysAuth(session);
    sendJson(res, 200, {
      keys: keys.map((k) => ({
        id: k.id, label: k.name, platform: k.platform, masked: maskKey(k.key),
        hasKey: !!k.key, selected: !!k.key && k.key === session.api_key,
      })),
    });
  } catch (e: any) {
    sendJson(res, e.status || 502, { error: { message: e.message || '拉取 key 失败' } });
  }
}

async function apiKeysSelect(req: IncomingMessage, res: ServerResponse, session: any): Promise<void> {
  let body: any;
  try { body = await readJsonBody(req, SMALL_JSON_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  if (session.uid === null) { sendJson(res, 400, { error: { message: '贴 key 模式不支持切换账户 key' } }); return; }
  try {
    const k = (await fetchKeysAuth(session)).find((x) => String(x.id) === String(body.id));
    if (!k || !k.key) { sendJson(res, 400, { error: { message: 'key 不存在或不可用' } }); return; }
    db.updateSessionKey(session.token, k.key, k.name, k.platform);
    sendJson(res, 200, { ok: true });
  } catch (e: any) {
    sendJson(res, e.status || 502, { error: { message: e.message || '切换 key 失败' } });
  }
}

// 手动贴 key：把任意 key 存进当前 session（登录态 / keyonly 都可用）。key 进后端 session，不回浏览器。
async function apiKeysManual(req: IncomingMessage, res: ServerResponse, session: any): Promise<void> {
  let body: any;
  try { body = await readJsonBody(req, AUTH_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  const key = parseApiKey(body.key);
  if (!key) { sendJson(res, 400, { error: { message: `key 不能为空、不能含控制字符且最长 ${API_KEY_MAX_LENGTH} 字符` } }); return; }
  const checked = await validateApiKey(key);
  if (!checked.ok) { sendJson(res, checked.status, { error: { message: checked.message } }); return; }
  db.updateSessionKey(session.token, key, maskKey(key), 'manual');
  sendJson(res, 200, { ok: true });
}

async function apiModels(res: ServerResponse, session: any): Promise<void> {
  if (!session.api_key) { sendJson(res, 200, { data: [] }); return; } // 无 key → 空列表，前端有兜底
  try {
    const r = await fetch(BASE + '/v1/models', { headers: { 'Authorization': `Bearer ${session.api_key}`, 'Accept': 'application/json' } });
    const json = await r.json().catch(() => ({ data: [] }));
    sendJson(res, r.ok ? 200 : r.status, json);
  } catch (e: any) {
    sendJson(res, 502, { error: { message: '拉取模型失败: ' + e.message } });
  }
}

// 从新表的 messages 组装上游 /v1/chat/completions 入参：系统提示 + 历史；图片读 blob 转 base64 image_url。
function buildUpstreamMessages(history: any[]): any[] {
  const out: any[] = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];
  for (const m of history) {
    if (m.kind === 'error') continue;
    if (m.role === 'user') {
      if (m.blobs && m.blobs.length) {
        const parts: any[] = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        for (const b of m.blobs) {
          // 兼容迁移期旧数据：blob 元素可能是裸 hash 字符串（按图片处理）。
          const hash = typeof b === 'string' ? b : b.hash;
          const meta = db.getBlobMeta(hash);
          if (!meta) continue;
          const name = (typeof b === 'string' ? '' : b.name) || '';
          if (meta.mime.startsWith('image/')) {
            try {
              const b64 = fs.readFileSync(blobPath(hash)).toString('base64');
              parts.push({ type: 'image_url', image_url: { url: `data:${meta.mime};base64,${b64}` } });
            } catch { /* blob 文件缺失则跳过该图 */ }
          } else if (isTextLike(meta.mime, name)) {
            try {
              let content = fs.readFileSync(blobPath(hash)).toString('utf8');
              if (content.length > FILE_TEXT_MAX) content = content.slice(0, FILE_TEXT_MAX) + '\n…（内容过长已截断）';
              parts.push({ type: 'text', text: `\n[附件文件: ${name || hash}]\n\`\`\`\n${content}\n\`\`\`\n` });
            } catch { /* blob 文件缺失则跳过该文件 */ }
          } else {
            // 非图非文本（本轮上传路径不该出现），仅标注、不读 bytes。
            parts.push({ type: 'text', text: `\n[附件: ${name || hash}（二进制，已忽略内容）]\n` });
          }
        }
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.text || '' });
      }
    } else {
      // assistant：只回文本（生成的图不回灌，多数后端不收 assistant 图片 part）
      if (m.text && m.kind !== 'image') out.push({ role: 'assistant', content: m.text });
    }
  }
  return out;
}

const newMsgId = (): string => 'm_' + crypto.randomBytes(8).toString('hex');

// ── /api/conversations（会话 CRUD，新表；均 readSession 鉴权、uid 隔离）──────────
function apiConvList(res: ServerResponse, session: any): void {
  if (session.uid === null) { sendJson(res, 200, { conversations: [] }); return; } // keyonly 用本地存储
  sendJson(res, 200, { conversations: db.listConvs(session.uid) });
}
async function apiConvCreate(req: IncomingMessage, res: ServerResponse, session: any): Promise<void> {
  if (session.uid === null) { sendJson(res, 400, { error: { message: '贴 key 模式会话存本地' } }); return; }
  let body: any;
  try { body = await readJsonBody(req, SMALL_JSON_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  const id = (typeof body.id === 'string' && CONV_ID_RE.test(body.id)) ? body.id : ('c_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
  const title = String(body.title || '新对话').slice(0, MAX_CONV_TITLE_LENGTH);
  if (!db.getConvMeta(session.uid, id)) db.createConv(session.uid, id, title);
  sendJson(res, 200, { id, title });
}
function apiConvGet(res: ServerResponse, session: any, convId: string): void {
  if (session.uid === null) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  const meta = db.getConvMeta(session.uid, convId);
  if (!meta) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  // 在途生成标记：前端据此决定是否开 /stream 重连，接上还没跑完的回复。
  const task = inflight.get(taskKey(session.uid, convId));
  const durableVideo = !task || task.done ? db.getActiveVideoTask(session.uid, convId) : null;
  const inflightInfo = task && !task.done
    ? { kind: task.kind }
    : durableVideo ? { kind: 'video', status: durableVideo.status } : null;
  sendJson(res, 200, { ...meta, messages: db.getMessages(convId, session.uid), inflight: inflightInfo });
}

// 重连在途生成流：有未完成任务 → 回放已生成部分 + 续播 live 到结束；否则 204（前端回退用 DB 最终结果）。
function apiConvStream(res: ServerResponse, session: any, convId: string): void {
  if (session.uid === null) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  if (!db.getConvMeta(session.uid, convId)) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  const key = taskKey(session.uid, convId);
  let task = inflight.get(key);
  if (!task || task.done) {
    const durable = db.getActiveVideoTask(session.uid, convId);
    if (durable) task = ensureVideoTaskRunning(durable);
  }
  if (!task || task.done) { res.writeHead(204); res.end(); return; }
  taskAttach(task, res);
}

// 取消在途生成：用户点「停止」时调，真正 abort 上游请求（任务随即 taskFinish，done=true，不再挡新消息）。
// 幂等：无在途任务也回 200。
function apiConvCancel(res: ServerResponse, session: any, convId: string): void {
  if (session.uid === null) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  const key = taskKey(session.uid, convId);
  let task = inflight.get(key);
  if (!task || task.done) {
    const durable = db.getActiveVideoTask(session.uid, convId);
    if (durable) task = ensureVideoTaskRunning(durable);
  }
  if (task && !task.done && task.cancel) task.cancel();
  sendJson(res, 200, { ok: true });
}
async function apiConvPatch(req: IncomingMessage, res: ServerResponse, session: any, convId: string): Promise<void> {
  if (session.uid === null || !db.getConvMeta(session.uid, convId)) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  let body: any;
  try { body = await readJsonBody(req, SMALL_JSON_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  db.renameConv(session.uid, convId, String(body.title || '').slice(0, MAX_CONV_TITLE_LENGTH));
  sendJson(res, 200, { ok: true });
}
function apiConvDelete(res: ServerResponse, session: any, convId: string): void {
  if (session.uid !== null) {
    if (isGenerating(taskKey(session.uid, convId)) || db.getActiveVideoTask(session.uid, convId)) {
      sendJson(res, 409, { error: { message: '该对话仍有内容在生成，完成或取消后才能删除' } }); return;
    }
    db.deleteConv(session.uid, convId);
  }
  sendJson(res, 200, { ok: true });
}

// ── 在途生成任务注册表（登录态）─────────────────────────────────────────
// 把「生成」做成脱离单条连接的后台任务：任务自己拉上游、累积、落库；客户端只是订阅者。
// 刷新/断开只是少一个订阅者，生成照常跑完 → 解决「进行中刷新就丢」。每会话至多一条在途。
type GenTask = {
  key: string; convId: string; uid: number; kind: 'chat' | 'image' | 'video';
  raw: Buffer[]; rawBytes: number;          // 累计「发给客户端的原始 SSE 字节」，供重连回放
  subs: Set<ServerResponse>;                // 当前在看的连接（可 0 个：纯后台跑）
  done: boolean; error: string | null; startedAt: number;
  cancel?: () => void;                      // 外部取消通道：abort 上游请求（用户点「停止」时调）
  canceled?: boolean;                       // 标记「用户主动取消」，与上游错误区分，避免误报
  videoTaskId?: string;                     // 视频任务持久化主键（重启恢复 / 方舟取消用）
};
const inflight = new Map<string, GenTask>();
const TASK_RAW_MAX = 8 * 1024 * 1024;       // raw 回放缓冲上限（生图 partial 较大，超限丢早段留末段）
const TASK_GRACE_MS = 60 * 1000;            // 完成后保留时长，应对收尾瞬间的重连

function taskKey(uid: number, convId: string): string { return `${uid}:${convId}`; }

// 同一会话是否有「仍在生成（未完成）」的任务。已完成但还在 TASK_GRACE_MS 宽限期内的不算——
// 那段保留只为 /stream 重连重放结果，不该把新一轮生成误判成「上一条还在生成」。
function isGenerating(key: string): boolean {
  const t = inflight.get(key);
  return !!t && !t.done;
}

// 给任务绑定取消通道：abort 上游并标记「用户主动取消」（与上游错误区分，避免误报）。
// 独立函数定义是有意为之——闭包只捕获 task/ctrl，不会连带各 runner 作用域里的大对象
// （如 apiImages 的 refBlobs 参考图 Buffer、parser、doRequest）被 inflight 保活整个宽限期。
function bindCancel(task: GenTask, ctrl: AbortController): void {
  task.cancel = () => { task.canceled = true; ctrl.abort(new Error('用户取消')); };
}

const SSE_HEAD: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};
function sseHead(res: ServerResponse): void {
  if (!res.headersSent) { res.writeHead(200, SSE_HEAD); res.flushHeaders(); }
}
function sseData(obj: any): string { return `data: ${JSON.stringify(obj)}\n\n`; }
// 安全写：socket 已关/已结束就跳过，避免 write-after-end / EPIPE。
function safeWrite(res: ServerResponse, chunk: Buffer | string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try { return res.write(chunk); } catch { return false; }
}

// 生成产出一段原始 SSE 字节：累积供回放 + 广播给所有订阅者。
function taskWrite(task: GenTask, chunk: Buffer): void {
  task.raw.push(chunk); task.rawBytes += chunk.length;
  while (task.rawBytes > TASK_RAW_MAX && task.raw.length > 1) {
    task.rawBytes -= (task.raw.shift() as Buffer).length;   // 超限丢最早的（生图早期 partial 可丢）
  }
  for (const r of task.subs) safeWrite(r, chunk);
}
// 一个连接订阅任务：发 SSE 头 → 回放已生成部分 → 续播 live；若已完成则补 [DONE] 即结束。
function taskAttach(task: GenTask, res: ServerResponse): void {
  sseHead(res);
  for (const chunk of task.raw) safeWrite(res, chunk);
  if (task.done) {
    if (task.error) safeWrite(res, sseData({ error: { message: task.error } }));
    safeWrite(res, 'data: [DONE]\n\n');
    if (!res.writableEnded) res.end();
    return;
  }
  task.subs.add(res);
  res.on('close', () => task.subs.delete(res));
}
// 生成结束：标记完成、给在看的订阅者补 [DONE]/错误并收尾，留宽限期后从注册表 GC。
function taskFinish(task: GenTask): void {
  task.done = true;
  for (const r of task.subs) {
    if (task.error) safeWrite(r, sseData({ error: { message: task.error } }));
    safeWrite(r, 'data: [DONE]\n\n');
    if (!r.writableEnded) r.end();
  }
  task.subs.clear();
  task.cancel = undefined;   // 已完成，取消通道作废 → 释放对 ctrl 的捕获，不必留到宽限期结束
  setTimeout(() => { if (inflight.get(task.key) === task) inflight.delete(task.key); }, TASK_GRACE_MS).unref();
}

// 转发上游 chat SSE 给前端；若传 persist 回调，则边转发边累积 assistant 文本，流结束时调 persist 落库。
async function streamChatUpstream(res: ServerResponse, apiKey: string, model: any, messages: any[], persist: ((text: string) => void) | null): Promise<void> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error('上游超时')), 10 * 60 * 1000);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('客户端断开')); });

  let upstream: Response;
  try {
    upstream = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'text/event-stream', 'accept-encoding': 'identity' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    sendJson(res, 502, { error: { message: '上游不可达: ' + e.message } });
    return;
  }

  const resHeaders: Record<string, string> = {};
  upstream.headers.forEach((v: string, k: string) => { if (!SKIP_RES_HEADERS.has(k.toLowerCase())) resHeaders[k] = v; });
  res.writeHead(upstream.status, resHeaders);

  let assistantText = '';
  if (upstream.body && upstream.ok) {
    res.flushHeaders();
    const decoder = new TextDecoder();
    let sbuf = '';
    const parse = (chunkText: string) => {
      sbuf += chunkText;
      const lines = sbuf.split('\n'); sbuf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const p = t.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try { const d = JSON.parse(p)?.choices?.[0]?.delta?.content; if (d) assistantText += d; } catch { /* 非 JSON delta */ }
      }
    };
    try {
      for await (const chunk of Readable.fromWeb(upstream.body)) {
        if (res.destroyed) break;
        parse(decoder.decode(chunk, { stream: true }));
        if (!res.write(chunk)) { if (!await drainOnce(res)) break; }
      }
    } catch (e: any) { console.error(`[messages] stream interrupted: ${e.message}`); }
    if (persist && assistantText) persist(assistantText);
  } else if (upstream.body) {
    res.flushHeaders();                       // 上游错误（非 200）：转发错误体
    try { await pumpBody(upstream.body, res); } catch { /* ignore */ }
  }
  clearTimeout(timeout);
  res.end();
}

// 登录态聊天：把生成喂进任务（脱离单条连接）。上游不再因某个订阅者断开而中断，只受 10 分钟超时约束；
// 流结束累积出完整 assistant 文本，先 persist 落库再 taskFinish。
async function runChatTask(task: GenTask, apiKey: string, model: any, messages: any[], persist: (text: string) => void): Promise<void> {
  const ctrl = new AbortController();
  bindCancel(task, ctrl);
  const timeout = setTimeout(() => ctrl.abort(new Error('上游超时')), 10 * 60 * 1000);
  let upstream: Response;
  try {
    upstream = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'text/event-stream', 'accept-encoding': 'identity' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (!task.canceled) task.error = '上游不可达: ' + e.message;   // 用户取消不算错误
    taskFinish(task); return;
  }

  let assistantText = '';
  if (upstream.body && upstream.ok) {
    const decoder = new TextDecoder();
    let sbuf = '';
    const parse = (chunkText: string) => {
      sbuf += chunkText;
      const lines = sbuf.split('\n'); sbuf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const p = t.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try { const d = JSON.parse(p)?.choices?.[0]?.delta?.content; if (d) assistantText += d; } catch { /* 非 JSON delta */ }
      }
    };
    try {
      for await (const chunk of Readable.fromWeb(upstream.body)) {
        const b = Buffer.from(chunk);
        parse(decoder.decode(b, { stream: true }));
        taskWrite(task, b);                       // 原样转发上游 SSE 字节（供 live + 回放）
      }
    } catch (e: any) { console.error(`[chat-task] stream interrupted: ${e.message}`); }
    // 完整回复落库（即便所有订阅者都已断开）；空响应不落库也不算错（前端按「（空响应）」显示）。
    if (assistantText) { try { persist(assistantText); } catch (e: any) { console.error(`[chat-task] persist failed: ${e.message}`); } }
  } else {
    const errText = upstream.body ? await upstream.text().catch(() => '') : '';
    task.error = (errText || `上游错误 ${upstream.status}`).slice(0, 2000);
  }
  clearTimeout(timeout);
  taskFinish(task);
}

// 聊天：登录态落库（{text,attachments:[hash]} → 落 user/assistant、后端组装上下文）；
// keyonly（无 uid）走代理模式（前端拼 {messages}，不落库）。系统提示统一后端注入。
async function apiMessages(req: IncomingMessage, res: ServerResponse, session: any, convId: string): Promise<void> {
  if (!session.api_key) { sendJson(res, 400, { error: { message: '尚未设置 key，请先在设置里选/贴一个 key' } }); return; }
  let body: any;
  // key-only 会随请求重发本地历史（可能含压缩后的 dataURL）；有效 key 已在建 session 前验证，给其较高但有限的档位。
  const bodyLimit = session.uid === null ? IMAGE_MAX_BODY : CHAT_MAX_BODY;
  try { body = await readJsonBody(req, bodyLimit); } catch (e: any) { sendBodyError(res, e); return; }
  if (typeof body.model !== 'string' || !body.model || body.model.length > 200) {
    sendJson(res, 400, { error: { message: '模型参数格式非法' } }); return;
  }
  const model = body.model;

  // keyonly：会话存本地，不落后端库；前端拼好的 messages 直接转发。
  if (session.uid === null) {
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (history.length > 500) { sendJson(res, 413, { error: { message: '消息历史条数过多' } }); return; }
    await streamChatUpstream(res, session.api_key, model, [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...history], null);
    return;
  }

  // 登录态：落 user 消息 → 后端组装上下文 → 落 assistant。
  const uid = session.uid;
  const text = String(body.text || '');
  if (bodyTextTooLarge(text)) { sendJson(res, 413, { error: { message: '消息文本过大' } }); return; }
  // attachments 线格式：[{hash,name}]（兼容旧版裸 hash 字符串，按无名处理）。
  const rawAttachments: any[] = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    sendJson(res, 413, { error: { message: `单条消息最多 ${MAX_ATTACHMENTS} 个附件` } }); return;
  }
  const attachments: { hash: string; name: string }[] = rawAttachments.length
    ? rawAttachments
        .map((a: any) => (typeof a === 'string' ? { hash: a, name: '' } : { hash: a?.hash, name: String(a?.name || '').slice(0, 200) }))
        .filter((a: any) => typeof a.hash === 'string' && HASH_RE.test(a.hash))
    : [];
  if (attachments.length !== rawAttachments.length) { sendJson(res, 400, { error: { message: '附件参数非法' } }); return; }
  if (attachments.some((a) => !db.userOwnsBlob(uid, a.hash))) {
    sendJson(res, 404, { error: { message: '附件不存在' } }); return;
  }
  if (!text && !attachments.length) { sendJson(res, 400, { error: { message: '空消息' } }); return; }
  // 并发护栏：同一会话已有在途生成 → 拒绝（须在落 user 消息前，避免插一条没回复的）。
  const key = taskKey(uid, convId);
  if (isGenerating(key)) { sendJson(res, 409, { error: { message: '上一条还在生成中，请稍候' } }); return; }

  if (!db.getConvMeta(uid, convId)) db.createConv(uid, convId, text.slice(0, 24) || '新对话');
  const seq = db.nextSeq(convId, uid);
  const userMsgId = newMsgId();
  db.insertMessage({ id: userMsgId, convId, uid, seq, role: 'user', kind: 'chat', text });
  attachments.forEach((a, i) => db.linkBlob(userMsgId, a.hash, i, a.name));
  if (seq === 0 && text) db.renameConv(uid, convId, text.slice(0, 24));
  db.touchConv(uid, convId);

  const messages = buildUpstreamMessages(db.getMessages(convId, uid));
  // 建任务、当前客户端作首个订阅者（即时 SSE）、后台跑生成（脱离本连接）。
  const task: GenTask = { key, convId, uid, kind: 'chat', raw: [], rawBytes: 0, subs: new Set(), done: false, error: null, startedAt: Date.now() };
  inflight.set(key, task);
  taskAttach(task, res);
  await runChatTask(task, session.api_key, model, messages, (aText) => {
    db.insertMessage({ id: newMsgId(), convId, uid, seq: db.nextSeq(convId, uid), role: 'assistant', kind: 'chat', model, text: aText });
    db.touchConv(uid, convId);
  });
}

// 背压：单次 drain 等待（客户端消费慢时停一拍）。返回 false 表示连接已关。
function drainOnce(res: ServerResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); };
    res.once('drain', onDrain); res.once('close', onClose);
  });
}

// 解析上游生图响应（SSE 逐事件 或 整包 JSON），累积出最终图。复刻前端 readImageSse 的宽容逻辑。
function makeImageParser() {
  const images: { b64?: string; url?: string }[] = [];   // 收集所有最终图（组图会有多张，按到达顺序）
  let lastPartialB64: string | null = null;              // 最近一次渐进预览，无 succeeded 时兜底
  let revised = '', mime = 'image/png';
  let sbuf = '';
  const pushImg = (b64?: string, url?: string) => { if (b64) images.push({ b64 }); else if (url) images.push({ url }); };
  const handle = (j: any) => {
    if (!j || typeof j !== 'object') return;
    if (j.output_format) mime = 'image/' + j.output_format;
    if (j.revised_prompt) revised = j.revised_prompt;
    // 整包非流式：data:[{b64_json|url}]（组图可能多张）
    if (Array.isArray(j.data) && j.data.length) {
      for (const d of j.data) { if (d.revised_prompt) revised = d.revised_prompt; pushImg(d.b64_json, d.url); }
      return;
    }
    const type = j.type || '';
    const b64 = typeof j.b64_json === 'string' ? j.b64_json : '';
    const url = typeof j.url === 'string' ? j.url : '';
    if (!b64 && !url) return;
    // 渐进预览（partial_image，非 succeeded）：只记预览、不算最终
    if (type.includes('partial') && !type.includes('succeeded')) { if (b64) lastPartialB64 = b64; return; }
    // partial_succeeded（火山组图一张最终）/ completed（gpt-image 最终）/ 裸最终
    pushImg(b64, url);
  };
  return {
    feedSse(chunkText: string) {
      sbuf += chunkText;
      const lines = sbuf.split('\n'); sbuf = lines.pop() || '';
      for (const line of lines) { const t = line.trim(); if (!t.startsWith('data:')) continue; const p = t.slice(5).trim(); if (!p || p === '[DONE]') continue; try { handle(JSON.parse(p)); } catch { /* */ } }
    },
    feedJson(s: string) { try { handle(JSON.parse(s)); } catch { /* */ } },
    result() {
      const imgs = images.length ? images : (lastPartialB64 ? [{ b64: lastPartialB64 }] : []);
      return { images: imgs, revised, mime };
    },
  };
}

// 把 dataURL 还原成 {buf,mime}（keyonly 参考图用）。
function dataUrlToBuf(dataUrl: string): { buf: Buffer; mime: string } {
  const i = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, i);
  const mime = (head.match(/^data:(.*?)[;,]/) || [])[1] || 'image/png';
  return { buf: Buffer.from(dataUrl.slice(i + 1), 'base64'), mime };
}

// 拉上游生图：流式逐块转发 / 非流式整包（包成单个 SSE data 事件，前端统一按 SSE 解析）。
// 每块经 onChunk 输出（登录态→taskWrite；keyonly 走另一条直连路径不用它），并喂 parser 解析最终图。
// 返回上游错误时不输出任何 body，交由调用方决定如何呈现。
async function pumpImageUpstream(
  doRequest: (stream: boolean) => Promise<Response>,
  parser: ReturnType<typeof makeImageParser>,
  onChunk: (b: Buffer) => void,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  let upstream = await doRequest(true);
  if (!upstream.ok) {
    const errText = await upstream.text();
    if ((upstream.status === 400 || upstream.status === 422) && /stream|partial/i.test(errText)) {
      upstream = await doRequest(false);
      if (!upstream.ok) return { ok: false, status: upstream.status, text: await upstream.text() };
    } else {
      return { ok: false, status: upstream.status, text: errText };
    }
  }
  const ctype = upstream.headers.get('content-type') || '';
  if (upstream.body) {
    if (ctype.includes('event-stream')) {
      const decoder = new TextDecoder();
      let sbuf = '';
      // 逐行处理上游 SSE：喂 parser + 只把「非渐进预览帧」转发给客户端。
      // 火山流式每张图会发多个 partial_image 渐进帧（每帧都是整张 b64），组图时累积可达数十 MB，
      // 经 CF 传给国内客户端会中途断（浏览器 network error）。丢弃渐进帧后，响应体从「N×多帧」降到「N×1 张」。
      const consume = (text: string, last: boolean) => {
        sbuf += text;
        const lines = sbuf.split('\n');
        sbuf = last ? '' : (lines.pop() || '');
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          parser.feedSse(line + '\n');
          const p = t.slice(5).trim();
          if (!p) continue;
          if (p === '[DONE]') { onChunk(Buffer.from('data: [DONE]\n\n')); continue; }
          let drop = false;
          try { const ty = JSON.parse(p).type || ''; if (ty.includes('partial') && !ty.includes('succeeded')) drop = true; } catch { /* 非 JSON 一律转发 */ }
          if (!drop) onChunk(Buffer.from('data: ' + p + '\n\n'));
        }
      };
      try {
        for await (const chunk of Readable.fromWeb(upstream.body)) {
          consume(decoder.decode(Buffer.from(chunk), { stream: true }), false);
        }
        consume(decoder.decode(), true);
      } catch (e: any) { console.error(`[image-task] stream interrupted: ${e.message}`); }
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      parser.feedJson(buf.toString('utf8'));
      onChunk(Buffer.from(`data: ${buf.toString('utf8')}\n\n`));   // 非流式整包 → 包成 SSE 事件
    }
  }
  return { ok: true };
}

// ── 豆包生图（火山方舟直连 + sub2api 余额扣费）──────────────────────────
const DOUBAO_MODEL_RE = /^doubao-seedream-/i;
function isDoubaoModel(m: any): boolean { return typeof m === 'string' && DOUBAO_MODEL_RE.test(m); }

// 各豆包模型的能力 + 单价（USD）。关键事实：火山按「模型 × 成功出图张数」计费，与分辨率无关，
// 所以这里单价即每张价；¥官价数字直接当 $（4.0 ¥0.20→$0.20 / 5.0lite ¥0.22→$0.22 / 4.5 ¥0.25→$0.25），
// 可用 env 覆盖。sizes/formats 用于「只给该模型支持的参数」（含后端兜底校验）。
const DOUBAO_CAPS: Record<string, { sizes: string[]; formats: string[]; price: number; webSearch: boolean; fast: boolean }> = {
  'doubao-seedream-5-0-260128': { sizes: ['2K', '3K', '4K'], formats: ['png', 'jpeg'], price: Number(process.env.DOUBAO_PRICE_5_0_LITE || 0.22), webSearch: true,  fast: false },
  'doubao-seedream-4-5-251128': { sizes: ['2K', '4K'],       formats: ['jpeg'],        price: Number(process.env.DOUBAO_PRICE_4_5 || 0.25),     webSearch: false, fast: false },
  'doubao-seedream-4-0-250828': { sizes: ['1K', '2K', '4K'], formats: ['jpeg'],        price: Number(process.env.DOUBAO_PRICE_4_0 || 0.20),     webSearch: false, fast: true  },
};
function doubaoPrice(model: string): number { return DOUBAO_CAPS[model]?.price ?? DOUBAO_PRICE_USD; }

// 组图一次最多出几张（火山约束：参考图数 + 生成数 ≤ 15）。默认上限 10，可 env 覆盖。
const DOUBAO_MAX_IMAGES = Number(process.env.DOUBAO_MAX_IMAGES || 10);
function doubaoCount(reqCount: any, refsLen: number): number {
  const cap = Math.max(1, Math.min(DOUBAO_MAX_IMAGES, 15 - refsLen));
  const n = Math.floor(Number(reqCount) || 1);
  return Math.max(1, Math.min(cap, n));
}

// 前端尺寸档 → 火山 size：接受 1K/2K/3K/4K（方式1，按模型校验，非法档退 2K/首档）或 WxH（方式2，像素透传）；
// auto/空 → null（交火山默认 2K）。挡住「gpt 的 1024x1024 透传给 5.0lite/4.5 触发最小像素报错」这类问题。
function mapDoubaoSize(size: any, model: string): string | null {
  const s = String(size || '').trim();
  if (!s || s.toLowerCase() === 'auto') return null;
  const caps = DOUBAO_CAPS[model];
  const tok = s.toUpperCase();
  if (/^[1-4]K$/.test(tok)) {
    if (!caps || caps.sizes.includes(tok)) return tok;
    return caps.sizes.includes('2K') ? '2K' : caps.sizes[0];
  }
  if (/^\d{3,4}x\d{3,4}$/i.test(s)) return s.toLowerCase();
  return null;
}

// 豆包有效输出格式：5.0 lite 支持 png/jpeg（默认 png）；4.5/4.0 固定 jpeg。用于发火山 + 定持久化 mime。
function doubaoFormat(reqFmt: any, model: string): string {
  const caps = DOUBAO_CAPS[model];
  if (caps && caps.formats.length > 1) {
    const f = String(reqFmt || '').trim().toLowerCase();
    return caps.formats.includes(f) ? f : caps.formats[0];
  }
  return caps ? caps.formats[0] : 'png';
}

// 组装发给火山方舟的 payload（覆盖全部能力：文/图生图、多图融合、组图、联网搜索、fast 提词、流式）。
// count 已由 doubaoCount clamp 好；refDataUrls 是参考图的 base64 data URL（0/1/多张）。
function doubaoBuildPayload(model: string, prompt: string, size: any, body: any, refDataUrls: string[], count: number, stream: boolean): any {
  const caps = DOUBAO_CAPS[model];
  const payload: any = { model, prompt, response_format: 'b64_json', watermark: false };
  const s = mapDoubaoSize(size, model); if (s) payload.size = s;
  // 仅 5.0 lite 支持自定义输出格式；4.5/4.0 固定 jpeg，不发该字段。
  if (caps && caps.formats.length > 1) payload.output_format = doubaoFormat(body.output_format, model);
  // 参考图：单张 → 字符串，多张 → 数组（图生图 / 多图融合 / 图生组图）。
  if (refDataUrls.length === 1) payload.image = refDataUrls[0];
  else if (refDataUrls.length > 1) payload.image = refDataUrls;
  // 组图：count>1 → 顺序生成 auto + max_images；否则显式 disabled（单图）。
  if (count > 1) { payload.sequential_image_generation = 'auto'; payload.sequential_image_generation_options = { max_images: count }; }
  else payload.sequential_image_generation = 'disabled';
  // 联网搜索（仅 5.0 lite 支持，融合实时信息）。
  if (caps && caps.webSearch && body.web_search === true) payload.tools = [{ type: 'web_search' }];
  // fast 提词模式（仅 4.0 支持；5.0lite/4.5 仅 standard）。
  if (caps && caps.fast && String(body.prompt_mode) === 'fast') payload.optimize_prompt_options = { mode: 'fast' };
  if (stream) payload.stream = true;
  return payload;
}
// 调 sub2api 管理接口调整某用户余额（operation: subtract 扣 / add 退）。金额单位 USD。
// x-api-key 仅用于鉴权（证明有权操作）；扣的是 URL 里 {uid} 那个用户，与 admin 自身余额无关。
async function adjustUserBalance(uid: number, amountUsd: number, operation: 'subtract' | 'add', idemKey: string, notes: string): Promise<void> {
  const r = await fetch(`${BASE}/api/v1/admin/users/${uid}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SUB2API_ADMIN_KEY, 'Idempotency-Key': idemKey },
    body: JSON.stringify({ balance: amountUsd, operation, notes }),
  });
  let j: any = null;
  try { j = await r.json(); } catch { /* 空 body */ }
  if (!r.ok) throw new Error(j?.error?.message || j?.message || `余额接口 HTTP ${r.status}`);
}

// 查某用户当前余额（USD）。用于豆包扣费前预检：sub2api 0.1.145 起「余额不足」被包装成 500 且
// 不返回具体消息，无法从响应区分「余额不足」与真正的服务错误，故先查余额、够才扣、不足直接明确提示。
async function doubaoUserBalance(uid: number): Promise<number> {
  const r = await fetch(`${BASE}/api/v1/admin/users/${uid}`, { headers: { 'x-api-key': SUB2API_ADMIN_KEY } });
  let j: any = null;
  try { j = await r.json(); } catch { /* 空 body */ }
  if (!r.ok) throw new Error(j?.message || `查余额 HTTP ${r.status}`);
  return Number(j?.data?.balance ?? NaN);
}

// 生图：登录态落 user 消息 + 结果存 blob 落 kind=image，并走后台任务（脱离连接、可刷新重连）；
// keyonly（无 uid）保持原直连代理（dataURL 参考图、不落库）。上游 generations/edits，流式绕 CF 100s。
async function apiImages(req: IncomingMessage, res: ServerResponse, session: any, convId: string): Promise<void> {
  if (!session.api_key) { sendJson(res, 400, { error: { message: '尚未设置 key，请先在设置里选/贴一个 key' } }); return; }
  let body: any;
  try { body = await readJsonBody(req, IMAGE_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  const { model, prompt, size, quality } = body;
  if (typeof prompt !== 'string' || !prompt) { sendJson(res, 400, { error: { message: '缺少 prompt' } }); return; }
  if (typeof model !== 'string' || !model || model.length > 200 || bodyTextTooLarge(prompt)) {
    sendJson(res, 413, { error: { message: '模型参数或 prompt 过大' } }); return;
  }
  const rawRefs: any[] = Array.isArray(body.refs) ? body.refs : [];
  if (rawRefs.length > MAX_ATTACHMENTS) {
    sendJson(res, 413, { error: { message: `参考图最多 ${MAX_ATTACHMENTS} 张` } }); return;
  }
  const keyonly = session.uid === null;

  // 豆包生图：直连火山、需登录（要按 uid 扣费）、需配置齐全。keyonly / 未配置直接挡回。
  const doubao = isDoubaoModel(model);
  let doubaoCharge: { idemKey: string; count: number; price: number } | null = null;
  let doubaoImgCount = 1;   // 豆包组图张数（= 预扣张数，doRequest 组 payload 用）
  // 豆包出图的有效文件格式（用于发火山 + 定持久化 mime）：5.0lite png/jpeg、4.5/4.0 jpeg。
  const doubaoMime: string | null = doubao ? ('image/' + doubaoFormat(body.output_format, model)) : null;
  if (doubao && keyonly) { sendJson(res, 400, { error: { message: '豆包生图需登录账号后使用' } }); return; }
  if (doubao && (!ARK_API_KEY || !SUB2API_ADMIN_KEY)) { sendJson(res, 500, { error: { message: '豆包生图未配置（缺 ARK_API_KEY / SUB2API_ADMIN_KEY）' } }); return; }

  // 登录态：并发护栏须在落 user 消息前。
  let key = '';
  if (!keyonly) {
    key = taskKey(session.uid, convId);
    if (isGenerating(key)) { sendJson(res, 409, { error: { message: '上一条还在生成中，请稍候' } }); return; }
  }

  // 参考图统一成 [{buf,mime}]：keyonly 来自 dataURL；登录态来自 blob hash（并落 user 消息）。
  let refBlobs: { buf: Buffer; mime: string }[] = [];
  if (keyonly) {
    refBlobs = rawRefs
      .filter((u: any) => typeof u === 'string' && u.startsWith('data:'))
      .map((u: string) => { try { return dataUrlToBuf(u); } catch { return null; } })
      .filter(Boolean) as { buf: Buffer; mime: string }[];
  } else {
    const uid = session.uid;
    const refs: string[] = rawRefs.filter((h: any) => typeof h === 'string' && HASH_RE.test(h));
    if (refs.length !== rawRefs.length) { sendJson(res, 400, { error: { message: '参考图参数非法' } }); return; }
    if (refs.some((h) => !db.userOwnsBlob(uid, h))) {
      sendJson(res, 404, { error: { message: '参考图不存在' } }); return;
    }
    // 豆包：先扣费闸门 —— 组图按张数预扣（count 受参考图数与上限约束）；余额不足时 sub2api 拒绝
    // （balance 不能为负），此时不落 user 消息、不出图。出图后按实际成功张数退差额。
    if (doubao) {
      doubaoImgCount = doubaoCount(body.count, refs.length);
      const price = doubaoPrice(model);
      const need = price * doubaoImgCount;
      // 先查余额：0.1.145 起 subtract 对「余额不足」返回 500 internal error（不带具体文字），
      // 无法从响应区分「余额不足」与真正服务错误，故扣费前先查、不足直接明确提示充值。
      try {
        const bal = await doubaoUserBalance(uid);
        if (Number.isFinite(bal) && bal < need) {
          sendJson(res, 402, { error: { message: `余额不足（本次需 $${need.toFixed(2)}，当前余额 $${bal.toFixed(2)}），请充值后再试` } });
          return;
        }
      } catch { /* 查余额失败不阻塞，继续走扣费（扣费自身仍有余额闸门）*/ }
      const idemKey = 'dbimg_' + crypto.randomBytes(8).toString('hex');
      try {
        await adjustUserBalance(uid, need, 'subtract', idemKey, `豆包生图 ${model} ×${doubaoImgCount}`);
        doubaoCharge = { idemKey, count: doubaoImgCount, price };
      } catch (e: any) {
        const msg = String(e?.message || '');
        // 0.1.145 余额不足 = 500 "internal error"；先查已挡住绝大多数，这里把它一并当余额不足兜底。
        const insufficient = /negative|不足|insufficient|internal error/i.test(msg);
        sendJson(res, insufficient ? 402 : 502, { error: { message: insufficient ? '余额不足，请充值后再试' : ('扣费失败：' + msg) } });
        return;
      }
    }
    if (!db.getConvMeta(uid, convId)) db.createConv(uid, convId, String(prompt).slice(0, 24));
    const seq = db.nextSeq(convId, uid);
    const userMsgId = newMsgId();
    db.insertMessage({ id: userMsgId, convId, uid, seq, role: 'user', kind: 'chat', text: String(prompt) });
    refs.forEach((h, i) => db.linkBlob(userMsgId, h, i));
    if (seq === 0) db.renameConv(uid, convId, String(prompt).slice(0, 24));
    db.touchConv(uid, convId);
    refBlobs = refs
      .map((h) => { try { const meta = db.getBlobMeta(h); return meta ? { buf: fs.readFileSync(blobPath(h)), mime: meta.mime } : null; } catch { return null; } })
      .filter(Boolean) as { buf: Buffer; mime: string }[];
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error('上游超时')), 10 * 60 * 1000);

  // 豆包参考图 → base64 data URL（图生图 / 多图融合 / 图生组图）；mime 用小写（火山要求）。
  const doubaoRefDataUrls: string[] = doubao
    ? refBlobs.map((b) => `data:${(b.mime || 'image/png').toLowerCase()};base64,${b.buf.toString('base64')}`)
    : [];

  const doRequest = (stream: boolean): Promise<Response> => {
    // 豆包：直连火山方舟（b64_json、关水印、可流式），不经 sub2api。覆盖文/图生图、多图融合、组图、联网搜索、fast。
    if (doubao) {
      const payload = doubaoBuildPayload(model, prompt, size, body, doubaoRefDataUrls, doubaoImgCount, stream);
      return fetch(ARK_BASE + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ARK_API_KEY}` },
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
    }
    if (refBlobs.length) {
      const fd = new FormData();
      fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size); fd.append('n', '1');
      if (quality && quality !== 'auto') fd.append('quality', quality);
      if (stream) { fd.append('stream', 'true'); fd.append('partial_images', '2'); }
      if (refBlobs.length === 1) {
        fd.append('image', new Blob([refBlobs[0].buf], { type: refBlobs[0].mime }), 'ref-1.png');
      } else {
        refBlobs.forEach((b, i) => fd.append('image[]', new Blob([b.buf], { type: b.mime }), `ref-${i + 1}.png`));
      }
      return fetch(BASE + '/v1/images/edits', { method: 'POST', headers: { 'Authorization': `Bearer ${session.api_key}` }, body: fd, signal: ctrl.signal });
    }
    const payload: any = { model, prompt, size, n: 1 };
    if (quality && quality !== 'auto') payload.quality = quality;
    if (stream) { payload.stream = true; payload.partial_images = 2; }
    return fetch(BASE + '/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.api_key}` }, body: JSON.stringify(payload), signal: ctrl.signal });
  };

  const parser = makeImageParser();
  // 把最终图存 blob + 落 kind=image 消息（仅登录态调用）。组图多张 → 一条消息挂多个 blob。
  // 返回实际持久化张数（= 成功出图张数，供豆包按张退差额）。
  const persistImage = (): number => {
    const uid = session.uid;
    const { images, revised, mime } = parser.result();
    const bufs: { buf: Buffer; mime: string }[] = [];
    for (const im of images) {
      let buf: Buffer | null = null, m = doubaoMime || mime;
      if (im.b64) { buf = Buffer.from(im.b64, 'base64'); }
      else if (im.url && im.url.startsWith('data:')) {
        const ci = im.url.indexOf(','); const semi = im.url.indexOf(';');
        m = (semi > 5 ? im.url.slice(5, semi) : m); buf = Buffer.from(im.url.slice(ci + 1), 'base64');
      }
      if (buf && buf.length) bufs.push({ buf, mime: m });
    }
    if (!bufs.length) return 0;
    // 同一条消息内按内容去重：火山对「硬凑张数的组图」有时返回多张完全相同的图（字节一致 → 同 hash）。
    // 只落唯一图、只对唯一图计费（返回唯一张数，多预扣的在 finally 退差额）。
    const seen = new Set<string>();
    const stored: string[] = [];
    bufs.forEach((b) => {
      const h = sha256(b.buf);
      if (seen.has(h)) return;             // 本条消息内重复图：跳过（不重复 link、不重复计费）
      seen.add(h);
      const persisted = persistBufferBlobForUser(uid, b.buf, b.mime || 'image/png');
      if (persisted) stored.push(persisted);
    });
    if (!stored.length) return 0;
    const aid = newMsgId();
    db.insertMessage({ id: aid, convId, uid, seq: db.nextSeq(convId, uid), role: 'assistant', kind: 'image', model, text: revised ? `*${revised}*` : '' });
    stored.forEach((h, i) => db.linkBlob(aid, h, i));
    db.touchConv(uid, convId);
    return stored.length;                   // 成功持久化的唯一图数 = 计费张数
  };

  // ── keyonly：原直连路径（断开即掐、不落库）──
  if (keyonly) {
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('客户端断开')); });
    const forwardError = (status: number, ctype: string | null, text: string) => {
      clearTimeout(timeout);
      if (res.headersSent) { res.end(); return; }
      res.writeHead(status, { 'Content-Type': ctype || 'application/json; charset=utf-8' });
      res.end(text);
    };
    try {
      let upstream = await doRequest(true);
      if (!upstream.ok) {
        const errText = await upstream.text();
        if ((upstream.status === 400 || upstream.status === 422) && /stream|partial/i.test(errText)) {
          upstream = await doRequest(false);
          if (!upstream.ok) { forwardError(upstream.status, upstream.headers.get('content-type'), await upstream.text()); return; }
        } else { forwardError(upstream.status, upstream.headers.get('content-type'), errText); return; }
      }
      const resHeaders: Record<string, string> = {};
      upstream.headers.forEach((v: string, k: string) => { if (!SKIP_RES_HEADERS.has(k.toLowerCase())) resHeaders[k] = v; });
      res.writeHead(upstream.status, resHeaders);
      const ctype = upstream.headers.get('content-type') || '';
      if (upstream.body) {
        res.flushHeaders();
        if (ctype.includes('event-stream')) {
          const decoder = new TextDecoder();
          try {
            for await (const chunk of Readable.fromWeb(upstream.body)) {
              if (res.destroyed) break;
              parser.feedSse(decoder.decode(chunk, { stream: true }));
              if (!res.write(chunk)) { if (!await drainOnce(res)) break; }
            }
          } catch (e: any) { console.error(`[images] stream interrupted: ${e.message}`); }
        } else {
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.write(buf);
          parser.feedJson(buf.toString('utf8'));
        }
      }
      clearTimeout(timeout);
      res.end();
    } catch (e: any) {
      clearTimeout(timeout);
      if (!res.writableEnded) {
        if (!res.headersSent) sendJson(res, 502, { error: { message: '生图失败: ' + e.message } });
        else res.end();
      }
    }
    return;
  }

  // ── 登录态：后台任务（当前客户端作首订阅者；断开不掐，生成跑完落库）──
  const task: GenTask = { key, convId, uid: session.uid, kind: 'image', raw: [], rawBytes: 0, subs: new Set(), done: false, error: null, startedAt: Date.now() };
  inflight.set(key, task);
  bindCancel(task, ctrl);
  taskAttach(task, res);
  let persistedCount = 0;   // 实际成功出图 + 落库张数（豆包退差额用）
  try {
    const r = await pumpImageUpstream(doRequest, parser, (b) => taskWrite(task, b));
    if (task.canceled) { /* 用户取消：不落半成品图、不报错 */ }
    else if (r.ok) {
      if (parser.result().images.length) { persistedCount = persistImage(); }
      else task.error = '生图未返回图片';
    }
    else task.error = (r.text || `上游错误 ${r.status}`).slice(0, 2000);
  } catch (e: any) {
    if (!task.canceled) task.error = '生图失败: ' + e.message;
  } finally {
    clearTimeout(timeout);
    // 豆包按张退差额：预扣 count 张，实际出 persistedCount 张 → 退 (count − 出图数) 张（含全失败=全退）。
    if (doubaoCharge) {
      const dc = doubaoCharge;
      const refundN = dc.count - persistedCount;
      if (refundN > 0) {
        adjustUserBalance(session.uid, dc.price * refundN, 'add', dc.idemKey + '_rf', `豆包生图退款 ${refundN}张 ${model}`)
          .catch((e: any) => console.error(`[doubao] 退款失败 uid=${session.uid} idem=${dc.idemKey}: ${e.message}`));
      }
    }
    taskFinish(task);
  }
}

// ── 豆包视频 2.0（持久化异步任务 + 私有成片）──────────────────────────────
const VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p']);
const VIDEO_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
const VIDEO_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'create_unknown']);
const VIDEO_CLIENT_REQUEST_RE = /^[A-Za-z0-9_-]{8,128}$/;

function roundMoney(n: number): number { return Math.round(n * 1_000_000) / 1_000_000; }
function videoReserveUsd(resolution: string, duration: number): number {
  const pixelFactor: Record<string, number> = { '480p': 1, '720p': 2.25, '1080p': 5.0625 };
  const tokens = SEEDANCE_BASE_TOKENS_480P_5S * (duration / 5) * (pixelFactor[resolution] || 1);
  return roundMoney(tokens * SEEDANCE_PRICE_USD_PER_M_TOKENS / 1_000_000);
}
function videoEvent(task: GenTask, status: string, message = '', extra: any = {}): void {
  taskWrite(task, Buffer.from(sseData({ type: 'video.status', status, message, ...extra })));
}
function newVideoTaskRunner(row: any): GenTask {
  return {
    key: taskKey(row.uid, row.convId), convId: row.convId, uid: row.uid, kind: 'video',
    raw: [], rawBytes: 0, subs: new Set(), done: false, error: null, startedAt: Date.now(),
    videoTaskId: row.id,
  };
}
function sleepMs(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function arkHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ARK_API_KEY}` };
}

async function refundVideoReserve(row: any, reason: string): Promise<string> {
  const latest = db.getVideoTask(row.id) || row;
  if (latest.billingStatus !== 'reserved' && latest.billingStatus !== 'refund_pending') return latest.billingStatus;
  try {
    await adjustUserBalance(
      latest.uid, latest.reservedUsd, 'add', `dbvid_${latest.id}_refund`,
      `豆包视频退款 ${latest.model} · ${reason}`
    );
    db.setVideoTaskBilling(latest.id, 'refunded', 0);
    return 'refunded';
  } catch (e: any) {
    db.setVideoTaskBilling(latest.id, 'refund_pending', null);
    console.error(`[seedance] 退款待重试 task=${latest.id}: ${e.message}`);
    return 'refund_pending';
  }
}

async function settleVideoCharge(row: any, completionTokens: number): Promise<{ actualUsd: number; billingStatus: string }> {
  // 极少数异常响应可能缺 usage。此时宁可保留预授权并标记待核，不可把已产生的方舟成本全退掉。
  if (!Number.isFinite(completionTokens) || completionTokens <= 0) {
    return { actualUsd: row.reservedUsd, billingStatus: 'usage_missing' };
  }
  const actualUsd = roundMoney(Math.max(0, completionTokens) * row.pricePerMTokens / 1_000_000);
  const delta = roundMoney(row.reservedUsd - actualUsd);
  let billingStatus = 'settled';
  try {
    if (delta > 0.000001) {
      await adjustUserBalance(row.uid, delta, 'add', `dbvid_${row.id}_settle_add`, `豆包视频结算退款 ${row.model}`);
    } else if (delta < -0.000001) {
      await adjustUserBalance(row.uid, -delta, 'subtract', `dbvid_${row.id}_settle_sub`, `豆包视频结算补扣 ${row.model}`);
    }
  } catch (e: any) {
    billingStatus = delta >= 0 ? 'refund_pending' : 'settlement_due';
    console.error(`[seedance] 结算待处理 task=${row.id} status=${billingStatus}: ${e.message}`);
  }
  return { actualUsd, billingStatus };
}

// 方舟返回的成片 URL 有时效，必须马上流式拉回私有 blob；全过程不把大视频聚合进内存。
async function persistRemoteVideoForUser(uid: number, sourceUrl: string): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(sourceUrl); } catch { throw new Error('方舟返回了非法视频地址'); }
  const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1');
  if (parsed.protocol !== 'https:' && !localHttp) throw new Error('方舟返回了不安全的视频地址');

  const upstream = await fetch(parsed, { headers: { 'Accept': 'video/mp4' }, redirect: 'follow', signal: AbortSignal.timeout(2 * 60 * 1000) });
  if (!upstream.ok || !upstream.body) throw new Error(`下载成片失败（HTTP ${upstream.status}）`);
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > VIDEO_MAX_BYTES) throw new Error(`成片超过 ${Math.ceil(VIDEO_MAX_BYTES / 1024 / 1024)}MB 存储上限`);

  const tempPath = path.join(BLOB_DIR, `.video-${crypto.randomBytes(16).toString('hex')}.tmp`);
  const digest = crypto.createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    const meter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
        const b = Buffer.from(chunk);
        if (size + b.length > VIDEO_MAX_BYTES) { callback(new Error(`成片超过 ${Math.ceil(VIDEO_MAX_BYTES / 1024 / 1024)}MB 存储上限`)); return; }
        size += b.length; digest.update(b);
        if (head.length < 32) head = Buffer.concat([head, b]).subarray(0, 32);
        callback(null, b);
      },
    });
    await pipeline(Readable.fromWeb(upstream.body), meter, fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
    if (!size || !sniffSafeVideoMime(head)) throw new Error('方舟成片不是有效的 MP4 文件');

    const hash = digest.digest('hex');
    const finalPath = blobPath(hash);
    const hadMeta = !!db.getBlobMeta(hash);
    let createdFile = false;
    if (!fs.existsSync(finalPath)) {
      try { fs.linkSync(tempPath, finalPath); createdFile = true; }
      catch (e: any) { if (e?.code !== 'EEXIST') throw e; }
    }
    const claim = db.claimBlob(
      uid, hash, 'video/mp4', size,
      BLOB_MAX_COUNT_PER_USER, BLOB_MAX_BYTES_PER_USER, BLOB_MAX_BYTES_TOTAL
    );
    if (!claim.ok) {
      if (createdFile && !hadMeta && !db.getBlobMeta(hash)) fs.rmSync(finalPath, { force: true });
      const msg = claim.code === 'quota_total' ? '服务器视频存储空间已满' : '账号视频存储配额不足';
      throw new Error(msg);
    }
    return hash;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

async function finishVideoFailure(task: GenTask, row: any, status: 'failed' | 'cancelled', message: string, refund: boolean): Promise<void> {
  if (task.done) return;
  db.setVideoTaskStatus(row.id, status, message || null);
  if (refund) await refundVideoReserve(row, status === 'cancelled' ? '用户取消' : '生成失败');
  videoEvent(task, status, message);
  if (status === 'failed') task.error = message;
  taskFinish(task);
}

function bindVideoCancel(task: GenTask): void {
  let canceling = false;
  task.cancel = () => {
    if (canceling || task.done) return;
    canceling = true; task.canceled = true;
    void (async () => {
      const row = db.getVideoTask(task.videoTaskId || '');
      if (!row || VIDEO_TERMINAL.has(row.status)) return;
      if (!row.providerTaskId) {
        videoEvent(task, 'submitting', '创建请求正在提交，暂时无法安全取消');
        task.canceled = false;
        return;
      }
      try {
        const r = await fetch(`${ARK_BASE}/contents/generations/tasks/${encodeURIComponent(row.providerTaskId)}`, {
          method: 'DELETE', headers: arkHeaders(), signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
        await finishVideoFailure(task, row, 'cancelled', '', true);
      } catch (e: any) {
        task.canceled = false;
        videoEvent(task, row.status, `取消失败，任务仍在后台运行：${e.message}`);
      } finally { canceling = false; }
    })();
  };
}

async function runVideoTask(task: GenTask): Promise<void> {
  bindVideoCancel(task);
  let consecutiveErrors = 0;
  while (!task.done) {
    const row = db.getVideoTask(task.videoTaskId || '');
    if (!row) { task.error = '视频任务记录缺失'; taskFinish(task); return; }
    if (!row.providerTaskId) {
      const held = row.billingStatus === 'reserved';
      if (row.billingStatus === 'pending') {
        // 进程可能恰好死在管理接口成功与本地状态更新之间。用同一个幂等键确认预授权，随后原额退回。
        try {
          await adjustUserBalance(row.uid, row.reservedUsd, 'subtract', `dbvid_${row.id}_reserve`, `豆包视频预授权恢复 ${row.model}`);
          db.setVideoTaskBilling(row.id, 'reserved', null);
          await refundVideoReserve({ ...row, billingStatus: 'reserved' }, '任务未完成提交');
        } catch (e: any) {
          db.setVideoTaskBilling(row.id, 'review_required', null);
          console.error(`[seedance] 未提交任务账务待核 task=${row.id}: ${e.message}`);
        }
      }
      db.setVideoTaskStatus(row.id, held ? 'create_unknown' : 'failed', '服务重启时未找到方舟任务 ID');
      if (held) db.setVideoTaskBilling(row.id, 'review_required', null);
      task.error = held ? '方舟创建结果未知，已保留预授权并等待人工核对' : '视频任务尚未提交成功';
      taskFinish(task); return;
    }
    if (Date.now() - row.createdAt > VIDEO_TASK_TIMEOUT_MS) {
      task.cancel?.();
      await sleepMs(1000);
      continue;
    }

    try {
      const r = await fetch(`${ARK_BASE}/contents/generations/tasks/${encodeURIComponent(row.providerTaskId)}`, {
        headers: arkHeaders(), signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`查询方舟任务 HTTP ${r.status}`);
      const j: any = await r.json();
      if (task.done) return;
      consecutiveErrors = 0;
      const status = String(j.status || '').toLowerCase();
      if (status === 'queued' || status === 'running') {
        db.setVideoTaskStatus(row.id, status, null);
        videoEvent(task, status, status === 'queued' ? '排队中' : '正在生成', { progress: j.progress ?? null });
      } else if (status === 'succeeded') {
        db.setVideoTaskStatus(row.id, 'finalizing', null);
        videoEvent(task, 'finalizing', '成片已生成，正在安全保存');
        const videoUrl = j?.content?.video_url || (Array.isArray(j?.content) ? j.content[0]?.video_url : '');
        const completionTokens = Math.max(0, Math.floor(Number(j?.usage?.completion_tokens || 0)));
        if (!videoUrl) {
          const settled = await settleVideoCharge(row, completionTokens);
          db.setVideoTaskBilling(row.id, settled.billingStatus, settled.actualUsd);
          await finishVideoFailure(task, row, 'failed', '方舟任务成功但未返回成片地址', false);
          return;
        }
        let hash = '';
        let lastError: any = null;
        for (let attempt = 0; attempt < 3 && !hash; attempt++) {
          try { hash = await persistRemoteVideoForUser(row.uid, videoUrl); }
          catch (e: any) { lastError = e; if (attempt < 2) await sleepMs(1500 * (attempt + 1)); }
        }
        const settled = await settleVideoCharge(row, completionTokens);
        if (!hash) {
          db.setVideoTaskBilling(row.id, settled.billingStatus, settled.actualUsd);
          await finishVideoFailure(task, row, 'failed', `成片保存失败：${lastError?.message || '未知错误'}`, false);
          return;
        }
        const messageId = `m_${row.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}_video`;
        if (!db.messageExists(messageId, row.uid)) {
          db.insertMessage({
            id: messageId, convId: row.convId, uid: row.uid, seq: db.nextSeq(row.convId, row.uid),
            role: 'assistant', kind: 'video', model: row.model,
            text: `${row.resolution} · ${row.duration}s · ${row.ratio}`,
          });
        }
        db.linkBlob(messageId, hash, 0, `seedance-${row.duration}s-${row.resolution}.mp4`);
        db.touchConv(row.uid, row.convId);
        db.completeVideoTask(row.id, hash, completionTokens, settled.actualUsd, settled.billingStatus);
        videoEvent(task, 'succeeded', '成片已保存', { completion_tokens: completionTokens });
        taskFinish(task); return;
      } else if (status === 'failed') {
        const message = String(j?.error?.message || '方舟视频生成失败').slice(0, 1000);
        await finishVideoFailure(task, row, 'failed', message, true); return;
      } else if (status === 'cancelled' || status === 'canceled') {
        await finishVideoFailure(task, row, 'cancelled', '', true); return;
      } else {
        videoEvent(task, row.status, '等待方舟更新任务状态');
      }
    } catch (e: any) {
      consecutiveErrors++;
      if (consecutiveErrors === 1 || consecutiveErrors % 6 === 0) {
        videoEvent(task, row.status, `网络波动，正在重试（${e.message}）`);
      }
    }
    await sleepMs(VIDEO_POLL_INTERVAL_MS);
  }
}

function ensureVideoTaskRunning(row: any): GenTask {
  const key = taskKey(row.uid, row.convId);
  const existing = inflight.get(key);
  if (existing && !existing.done) return existing;
  const task = newVideoTaskRunner(row);
  inflight.set(key, task);
  videoEvent(task, row.status, row.status === 'submitting' ? '正在恢复任务' : '已恢复后台生成');
  void runVideoTask(task).catch((e: any) => {
    task.error = `视频任务异常：${e.message}`;
    taskFinish(task);
  });
  return task;
}

function sendVideoTerminalSse(res: ServerResponse, row: any): void {
  sseHead(res);
  safeWrite(res, sseData({ type: 'video.status', status: row.status, message: row.error || '' }));
  safeWrite(res, 'data: [DONE]\n\n');
  res.end();
}

async function apiVideos(req: IncomingMessage, res: ServerResponse, session: any, convId: string): Promise<void> {
  if (session.uid === null) { sendJson(res, 403, { error: { message: '视频生成需登录账号后使用' } }); return; }
  if (!ARK_API_KEY || !SUB2API_ADMIN_KEY) { sendJson(res, 500, { error: { message: '视频生成未配置（缺 ARK_API_KEY / SUB2API_ADMIN_KEY）' } }); return; }
  let body: any;
  try { body = await readJsonBody(req, IMAGE_MAX_BODY); } catch (e: any) { sendBodyError(res, e); return; }
  const uid = session.uid;
  const prompt = String(body.prompt || '').trim();
  const model = String(body.model || '');
  const clientRequestId = String(body.client_request_id || '');
  const resolution = String(body.resolution || '720p').toLowerCase();
  const ratio = String(body.ratio || '16:9');
  const duration = Math.floor(Number(body.duration || 5));
  if (!prompt || bodyTextTooLarge(prompt)) { sendJson(res, 400, { error: { message: '请填写有效的视频描述' } }); return; }
  if (model !== SEEDANCE_MODEL) { sendJson(res, 400, { error: { message: '当前仅支持豆包 Seedance 2.0' } }); return; }
  if (!VIDEO_CLIENT_REQUEST_RE.test(clientRequestId)) { sendJson(res, 400, { error: { message: 'client_request_id 格式非法' } }); return; }
  if (!VIDEO_RESOLUTIONS.has(resolution) || !VIDEO_RATIOS.has(ratio) || duration < 4 || duration > 15) {
    sendJson(res, 400, { error: { message: '视频规格非法（支持 480p/720p/1080p、4–15 秒）' } }); return;
  }

  const prior = db.getVideoTaskByClient(uid, clientRequestId);
  if (prior) {
    if (prior.convId !== convId) { sendJson(res, 409, { error: { message: '请求 ID 已用于其他对话' } }); return; }
    if (VIDEO_TERMINAL.has(prior.status)) sendVideoTerminalSse(res, prior);
    else taskAttach(ensureVideoTaskRunning(prior), res);
    return;
  }
  const key = taskKey(uid, convId);
  if (isGenerating(key) || db.getActiveVideoTask(uid, convId)) {
    sendJson(res, 409, { error: { message: '该对话已有内容在生成，请稍候' } }); return;
  }
  if (db.countActiveVideoTasks(uid) >= VIDEO_MAX_CONCURRENT_PER_USER || db.countActiveVideoTasks() >= VIDEO_MAX_CONCURRENT_TOTAL) {
    sendJson(res, 429, { error: { message: '视频生成队列已满，请稍后再试' } }); return;
  }

  const rawRefs: any[] = Array.isArray(body.refs) ? body.refs : [];
  if (rawRefs.length > MAX_ATTACHMENTS || rawRefs.some((h) => typeof h !== 'string' || !HASH_RE.test(h))) {
    sendJson(res, 400, { error: { message: `参考图最多 ${MAX_ATTACHMENTS} 张，且必须是已上传图片` } }); return;
  }
  const refDataUrls: string[] = [];
  for (const hash of rawRefs) {
    if (!db.userOwnsBlob(uid, hash)) { sendJson(res, 404, { error: { message: '参考图不存在' } }); return; }
    try {
      const buf = fs.readFileSync(blobPath(hash));
      const mime = sniffSafeImageMime(buf.subarray(0, 32));
      if (!mime) { sendJson(res, 400, { error: { message: '视频参考素材目前仅支持 PNG/JPEG/GIF/WebP 图片' } }); return; }
      refDataUrls.push(`data:${mime};base64,${buf.toString('base64')}`);
    } catch { sendJson(res, 404, { error: { message: '参考图文件缺失' } }); return; }
  }

  const reservedUsd = videoReserveUsd(resolution, duration);
  // 在第一次 await 前同步落一条 active 记录：并发请求随后会被上面的 DB 计数挡住，
  // 避免两次余额查询同时让同一用户越过「最多一个视频任务」的闸门。
  const taskId = 'v_' + crypto.randomBytes(12).toString('hex');
  const row = db.createVideoTask({
    id: taskId, uid, convId, clientRequestId, model, resolution, ratio, duration,
    reservedUsd, pricePerMTokens: SEEDANCE_PRICE_USD_PER_M_TOKENS,
  });
  if (row.id !== taskId) {
    if (VIDEO_TERMINAL.has(row.status)) sendVideoTerminalSse(res, row);
    else taskAttach(ensureVideoTaskRunning(row), res);
    return;
  }
  const task = newVideoTaskRunner(row);
  inflight.set(key, task);
  videoEvent(task, 'submitting', '正在校验余额与任务额度');
  task.cancel = () => { task.canceled = true; };
  try {
    const bal = await doubaoUserBalance(uid);
    if (task.canceled) {
      db.setVideoTaskStatus(taskId, 'cancelled', null);
      db.setVideoTaskBilling(taskId, 'not_charged', null);
      taskFinish(task);
      if (!res.destroyed && !res.writableEnded) sendJson(res, 409, { error: { message: '视频任务已取消' } });
      return;
    }
    if (Number.isFinite(bal) && bal < reservedUsd) {
      db.setVideoTaskStatus(taskId, 'failed', '余额不足');
      db.setVideoTaskBilling(taskId, 'not_charged', null);
      task.error = '余额不足'; taskFinish(task);
      sendJson(res, 402, { error: { message: `余额不足（本次预授权 $${reservedUsd.toFixed(2)}，当前余额 $${bal.toFixed(2)}），任务完成后会按实际 Tokens 结算` } });
      return;
    }
  } catch { /* 查询失败不越权放行，实际扣费接口仍是最终闸门 */ }
  if (task.canceled) {
    db.setVideoTaskStatus(taskId, 'cancelled', null);
    db.setVideoTaskBilling(taskId, 'not_charged', null);
    taskFinish(task);
    if (!res.destroyed && !res.writableEnded) sendJson(res, 409, { error: { message: '视频任务已取消' } });
    return;
  }
  try {
    await adjustUserBalance(uid, reservedUsd, 'subtract', `dbvid_${taskId}_reserve`, `豆包视频预授权 ${resolution} ${duration}s ${ratio}`);
    db.setVideoTaskBilling(taskId, 'reserved', null);
  } catch (e: any) {
    db.setVideoTaskStatus(taskId, 'failed', '预授权失败');
    db.setVideoTaskBilling(taskId, 'charge_failed', null);
    const insufficient = /negative|不足|insufficient|internal error/i.test(String(e?.message || ''));
    task.error = insufficient ? '余额不足' : `视频预授权失败：${e.message}`; taskFinish(task);
    sendJson(res, insufficient ? 402 : 502, { error: { message: task.error } });
    return;
  }
  if (task.canceled) {
    await finishVideoFailure(task, row, 'cancelled', '', true);
    if (!res.destroyed && !res.writableEnded) sendJson(res, 409, { error: { message: '视频任务已取消' } });
    return;
  }

  if (!db.getConvMeta(uid, convId)) db.createConv(uid, convId, prompt.slice(0, 24));
  const userMessageId = `m_${taskId.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}_user`;
  if (!db.messageExists(userMessageId, uid)) {
    const seq = db.nextSeq(convId, uid);
    db.insertMessage({ id: userMessageId, convId, uid, seq, role: 'user', kind: 'chat', text: prompt });
    rawRefs.forEach((h, i) => db.linkBlob(userMessageId, h, i));
    if (seq === 0) db.renameConv(uid, convId, prompt.slice(0, 24));
    db.touchConv(uid, convId);
  }

  taskAttach(task, res);
  videoEvent(task, 'submitting', '正在提交方舟视频任务');
  const createCtrl = new AbortController();
  const createTimeout = setTimeout(() => createCtrl.abort(new Error('方舟创建任务超时')), 90_000);
  task.cancel = () => { task.canceled = true; createCtrl.abort(new Error('用户取消')); };
  const textPrompt = `${prompt} --ratio ${ratio} --resolution ${resolution} --duration ${duration} --watermark false`;
  const content: any[] = [{ type: 'text', text: textPrompt }];
  refDataUrls.forEach((url) => content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' }));
  let created: Response;
  try {
    created = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
      method: 'POST', headers: arkHeaders(), body: JSON.stringify({ model, content }), signal: createCtrl.signal,
    });
  } catch (e: any) {
    clearTimeout(createTimeout);
    db.setVideoTaskStatus(taskId, 'create_unknown', String(e.message || '创建结果未知').slice(0, 1000));
    db.setVideoTaskBilling(taskId, 'review_required', null);
    task.error = '方舟创建结果未知；为避免重复付费不会自动重试，预授权已保留待核对';
    taskFinish(task); return;
  }
  clearTimeout(createTimeout);
  if (!created.ok) {
    const errText = (await created.text().catch(() => '')).slice(0, 1000) || `方舟创建任务 HTTP ${created.status}`;
    await finishVideoFailure(task, row, 'failed', errText, true); return;
  }
  let createdJson: any = null;
  try { createdJson = await created.json(); } catch { /* handled below */ }
  const providerTaskId = String(createdJson?.id || '');
  if (!providerTaskId) {
    db.setVideoTaskStatus(taskId, 'create_unknown', '方舟响应缺少任务 ID');
    db.setVideoTaskBilling(taskId, 'review_required', null);
    task.error = '方舟创建结果未知；响应缺少任务 ID，预授权已保留待核对';
    taskFinish(task); return;
  }
  db.setVideoTaskProvider(taskId, providerTaskId, 'queued');
  task.cancel = undefined;
  bindVideoCancel(task);
  videoEvent(task, 'queued', '已提交，等待方舟调度');
  void runVideoTask(task).catch((e: any) => {
    task.error = `视频任务异常：${e.message}`;
    taskFinish(task);
  });
}

const activeBlobUploads = new Map<number, number>();
let activeBlobUploadsTotal = 0;

function uploadSlot(uid: number): boolean {
  const userActive = activeBlobUploads.get(uid) || 0;
  if (activeBlobUploadsTotal >= BLOB_MAX_CONCURRENT_TOTAL || userActive >= BLOB_MAX_CONCURRENT_PER_USER) return false;
  activeBlobUploadsTotal++;
  activeBlobUploads.set(uid, userActive + 1);
  return true;
}

function releaseUploadSlot(uid: number): void {
  activeBlobUploadsTotal = Math.max(0, activeBlobUploadsTotal - 1);
  const n = (activeBlobUploads.get(uid) || 1) - 1;
  if (n > 0) activeBlobUploads.set(uid, n); else activeBlobUploads.delete(uid);
}

function normalizedUploadMime(req: IncomingMessage, head: Buffer): string {
  const imageMime = sniffSafeImageMime(head);
  if (imageMime) return imageMime;
  const claimed = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return claimed.length <= 100 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(claimed)
    ? claimed
    : 'application/octet-stream';
}

async function streamBlobToTemp(req: IncomingMessage, tempPath: string): Promise<{ hash: string; size: number; head: Buffer }> {
  const lengthHeader = req.headers['content-length'];
  if (lengthHeader !== undefined) {
    const declared = Number(lengthHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) throw Object.assign(new Error('Content-Length 非法'), { statusCode: 400 });
    if (declared > BLOB_MAX_BYTES) {
      throw Object.assign(new Error(`文件超过 ${Math.ceil(BLOB_MAX_BYTES / 1024 / 1024)}MB 上限`), { statusCode: 413 });
    }
  }

  const digest = crypto.createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let overLimit = false;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
      const b = Buffer.from(chunk);
      if (overLimit || size + b.length > BLOB_MAX_BYTES) {
        overLimit = true;
        callback(null); // chunked 超限时停止落盘并排空请求，保证 413 能正常写回。
        return;
      }
      size += b.length;
      digest.update(b);
      if (head.length < 32) head = Buffer.concat([head, b]).subarray(0, 32);
      callback(null, b);
    },
  });
  await pipeline(req, meter, fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
  if (overLimit) throw Object.assign(new Error(`文件超过 ${Math.ceil(BLOB_MAX_BYTES / 1024 / 1024)}MB 上限`), { statusCode: 413 });
  if (!size) throw Object.assign(new Error('空请求体'), { statusCode: 400 });
  return { hash: digest.digest('hex'), size, head };
}

// 上传 blob：仅账号登录态可用；流式写临时文件，hash/配额确认后以硬链接原子落盘。
async function apiBlobUpload(req: IncomingMessage, res: ServerResponse, session: any): Promise<void> {
  if (session.uid === null) { sendJson(res, 403, { error: { message: '贴 key 模式不允许服务端存储附件' } }); return; }
  const uid = session.uid;
  if (!uploadSlot(uid)) {
    sendJson(res, 429, { error: { message: '同时上传的文件过多，请稍后重试' } }); return;
  }

  const tempPath = path.join(BLOB_DIR, `.upload-${crypto.randomBytes(16).toString('hex')}.tmp`);
  let createdFile = false;
  let hadMeta = false;
  let finalPath: string | null = null;
  let blobHash: string | null = null;
  try {
    const streamed = await streamBlobToTemp(req, tempPath);
    blobHash = streamed.hash;
    const mime = normalizedUploadMime(req, streamed.head);
    finalPath = blobPath(streamed.hash);
    hadMeta = !!db.getBlobMeta(streamed.hash);
    try {
      fs.linkSync(tempPath, finalPath); // 同目录硬链接：不覆盖已有内容，且不会暴露半写文件。
      createdFile = true;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
    }
    fs.rmSync(tempPath, { force: true });

    const claim = db.claimBlob(
      uid,
      streamed.hash,
      mime,
      streamed.size,
      BLOB_MAX_COUNT_PER_USER,
      BLOB_MAX_BYTES_PER_USER,
      BLOB_MAX_BYTES_TOTAL
    );
    if (!claim.ok) {
      if (createdFile && !hadMeta && !db.getBlobMeta(streamed.hash)) fs.rmSync(finalPath, { force: true });
      const msg = claim.code === 'quota_count'
        ? `附件数量已达账号上限（${claim.limit} 个）`
        : claim.code === 'quota_total'
          ? '服务器附件存储空间已满'
          : `账号附件存储已达上限（${Math.round(claim.limit / 1024 / 1024)}MB）`;
      sendJson(res, 413, { error: { message: msg, type: claim.code } });
      return;
    }
    sendJson(res, 200, { hash: claim.hash, mime: claim.mime, size: claim.size });
  } catch (err: any) {
    if (createdFile && !hadMeta && finalPath && blobHash && !db.getBlobMeta(blobHash)) fs.rmSync(finalPath, { force: true });
    if (err?.statusCode === 400 || err?.statusCode === 413) sendBodyError(res, err, err.message);
    else {
      console.error('[blob-upload] failed:', err?.message || err);
      sendJson(res, 500, { error: { message: '附件上传失败' } });
    }
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* already moved/removed */ }
    releaseUploadSlot(uid);
  }
}

// 读 blob：grant/消息归属鉴权；只有魔数确认的位图/MP4 可内联。MP4 支持单段 Range，
// 否则 iOS/Android 的原生播放器无法拖动进度，也常常不会开始播放。
async function apiBlobGet(req: IncomingMessage, res: ServerResponse, session: any, hash: string): Promise<void> {
  if (session.uid === null || !db.userOwnsBlob(session.uid, hash)) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  const meta = db.getBlobMeta(hash);
  if (!meta) { sendJson(res, 404, { error: { message: 'not found' } }); return; }

  const filePath = blobPath(hash);
  let stat: any;
  let head = Buffer.alloc(32);
  let bytesRead = 0;
  try {
    stat = await fs.promises.stat(filePath);
    const fh = await fs.promises.open(filePath, 'r');
    try { ({ bytesRead } = await fh.read(head, 0, head.length, 0)); } finally { await fh.close(); }
  } catch {
    sendJson(res, 404, { error: { message: 'blob 文件缺失' } }); return;
  }
  const imageMime = sniffSafeImageMime(head.subarray(0, bytesRead));
  const videoMime = sniffSafeVideoMime(head.subarray(0, bytesRead));
  const inlineMime = imageMime || videoMime;
  let start = 0, end = Math.max(0, stat.size - 1), partial = false;
  const range = String(req.headers.range || '');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, ...SECURITY_HEADERS }); res.end(); return;
    }
    if (m[1]) {
      start = Number(m[1]); end = m[2] ? Number(m[2]) : stat.size - 1;
    } else {
      const suffix = Number(m[2]); start = Math.max(0, stat.size - suffix); end = stat.size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, ...SECURITY_HEADERS }); res.end(); return;
    }
    end = Math.min(end, stat.size - 1); partial = true;
  }
  const headers: Record<string, string> = {
    'Content-Type': inlineMime || 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...SECURITY_HEADERS,
  };
  if (inlineMime) headers['Accept-Ranges'] = 'bytes';
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  if (!inlineMime) headers['Content-Disposition'] = `attachment; filename="${hash}"`;
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// /api/* 路由分发。返回 true 表示已接管。
async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url || '').split('?')[0];
  const method = req.method || 'GET';

  // CSRF：写操作校验同源
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    sendJson(res, 403, { error: { message: '跨站请求被拒绝' } }); return;
  }

  // 公开路由（无需 session）
  if (url === '/api/session/login' && method === 'POST') return apiLogin(req, res);
  if (url === '/api/session/2fa' && method === 'POST') return api2fa(req, res);
  if (url === '/api/session/keylogin' && method === 'POST') return apiKeylogin(req, res);
  if (url === '/api/session/logout' && method === 'POST') return apiLogout(req, res);

  const session = db.readSession(getSessionToken(req));

  // me：未登录返回空对象（前端据此判断登录态），不报 401
  if (url === '/api/session/me' && method === 'GET') {
    if (!session) { sendJson(res, 200, { email: null, uid: null, key: null }); return; }
    return apiMe(res, session);
  }

  if (!session) { sendJson(res, 401, { error: { message: '未登录或登录已过期' } }); return; }

  if (url === '/api/keys' && method === 'GET') return apiKeys(res, session);
  if (url === '/api/keys/select' && method === 'POST') return apiKeysSelect(req, res, session);
  if (url === '/api/keys/manual' && method === 'POST') return apiKeysManual(req, res, session);
  if (url === '/api/models' && method === 'GET') return apiModels(res, session);
  if (url === '/api/blobs' && method === 'POST') return apiBlobUpload(req, res, session);
  const mBlob = /^\/api\/blobs\/([^/]+)$/.exec(url);
  if (mBlob && (method === 'GET' || method === 'HEAD')) {
    const h = decodeURIComponent(mBlob[1]);
    if (!HASH_RE.test(h)) { sendJson(res, 400, { error: { message: '非法 blob hash' } }); return; }
    return apiBlobGet(req, res, session, h);
  }

  // 会话集合
  if (url === '/api/conversations' && method === 'GET') return apiConvList(res, session);
  if (url === '/api/conversations' && method === 'POST') return apiConvCreate(req, res, session);
  // 会话子路由：消息 / 生图（两段路径，先于单条会话匹配）
  const mMsg = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url);
  if (mMsg && method === 'POST') {
    const cid = decodeURIComponent(mMsg[1]);
    if (!CONV_ID_RE.test(cid)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }
    return apiMessages(req, res, session, cid);
  }
  const mImg = /^\/api\/conversations\/([^/]+)\/images$/.exec(url);
  if (mImg && method === 'POST') {
    const cid = decodeURIComponent(mImg[1]);
    if (!CONV_ID_RE.test(cid)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }
    return apiImages(req, res, session, cid);
  }
  const mVideo = /^\/api\/conversations\/([^/]+)\/videos$/.exec(url);
  if (mVideo && method === 'POST') {
    const cid = decodeURIComponent(mVideo[1]);
    if (!CONV_ID_RE.test(cid)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }
    return apiVideos(req, res, session, cid);
  }
  // 重连在途生成流（刷新后接上还没跑完的回复）
  const mStream = /^\/api\/conversations\/([^/]+)\/stream$/.exec(url);
  if (mStream && (method === 'GET' || method === 'DELETE')) {
    const cid = decodeURIComponent(mStream[1]);
    if (!CONV_ID_RE.test(cid)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }
    return method === 'DELETE' ? apiConvCancel(res, session, cid) : apiConvStream(res, session, cid);
  }
  // 单条会话：GET / PATCH / DELETE
  const mConv = /^\/api\/conversations\/([^/]+)$/.exec(url);
  if (mConv) {
    const cid = decodeURIComponent(mConv[1]);
    if (!CONV_ID_RE.test(cid)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }
    if (method === 'GET') return apiConvGet(res, session, cid);
    if (method === 'PATCH') return apiConvPatch(req, res, session, cid);
    if (method === 'DELETE') return apiConvDelete(res, session, cid);
  }

  sendJson(res, 404, { error: { message: 'not found' } });
}

// 这些 /api 前缀归本服务应用路由处理；其余 /api/v1/* /v1/* 仍走旧代理。
function isOwnApi(url: string): boolean {
  return url.startsWith('/api/session/')
    || url === '/api/keys' || url === '/api/keys/select' || url === '/api/keys/manual'
    || url === '/api/models'
    || url === '/api/blobs' || /^\/api\/blobs\/[^/]+$/.test(url)
    || url === '/api/conversations' || /^\/api\/conversations\/[^/]+/.test(url);
}

// ── 会话存储 /store/*（按 session.uid 隔离）─────────────────────────
// /store/conversations          GET   列表（仅元数据）
// /store/conversations/<id>     GET 单条 / PUT 写入 / DELETE 删除
async function handleStore(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = db.readSession(getSessionToken(req));
  const uid = session?.uid ?? null;             // 贴 key 模式 uid=NULL → 不走服务端存储
  if (uid === null) { sendJson(res, 401, { error: { message: '未登录或登录已过期' } }); return; }

  const segs = (req.url || '').split('?')[0].split('/').filter(Boolean); // ['store','conversations', id?]
  if (segs[1] !== 'conversations') { sendJson(res, 404, { error: { message: 'not found' } }); return; }
  const convId = segs[2] || null;
  if (convId && !CONV_ID_RE.test(convId)) { sendJson(res, 400, { error: { message: '非法会话 id' } }); return; }

  if (!convId) {
    if (req.method === 'GET') { sendJson(res, 200, { conversations: db.listMeta(uid) }); return; }
    sendJson(res, 405, { error: { message: 'method not allowed' } });
    return;
  }

  if (req.method === 'GET') {
    const conv = db.getOne(uid, convId);
    if (!conv) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
    sendJson(res, 200, conv);
    return;
  }
  if (req.method === 'DELETE') {
    db.del(uid, convId);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'PUT') {
    let bodyBuf: Buffer;
    try { bodyBuf = await collectBody(req, STORE_MAX_BODY); }
    catch (err: any) { sendJson(res, err.statusCode || 400, { error: { message: err.message } }); return; }
    let conv: any;
    try { conv = JSON.parse(bodyBuf.toString('utf8')); }
    catch { sendJson(res, 400, { error: { message: 'body 不是合法 JSON' } }); return; }
    if (!conv || conv.id !== convId) { sendJson(res, 400, { error: { message: 'body.id 与路径不一致' } }); return; }
    const result = db.upsert(uid, conv);
    if (!result.ok) {
      const msg = result.code === 'quota_conversations'
        ? `保存失败：对话数量已达账号上限（${result.limit} 条），请删除一些旧对话后重试`
        : `保存失败：账号存储已达上限（${Math.round(result.limit / 1024 / 1024)}MB），请删掉旧对话或含图对话后重试`;
      sendJson(res, 413, { error: { message: msg, type: result.code } });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { error: { message: 'method not allowed' } });
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  // 畸形百分号编码（如 /%、/%ZZ）会让 decodeURIComponent 抛 URIError；必须就地拦成 400。
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  if (urlPath === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(`window.__CHAT_CONFIG__ = ${JSON.stringify({ upstream: BASE })};`);
    return;
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err: NodeJS.ErrnoException | null, data: Buffer) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers: Record<string, string> = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    };
    let body = data;
    if (ext === '.html') {
      headers['Content-Security-Policy'] = CSP;
      headers['X-Frame-Options'] = 'DENY';
      // 给本地 app.js/style.css 引用注入版本号，部署后强制取新版（绕开 CF/浏览器对 .js/.css 的缓存）
      body = Buffer.from(data.toString('utf8').replace(/(\/(?:app\.js|style\.css))(["'])/g, `$1?v=${ASSET_VER}$2`), 'utf8');
    }
    res.writeHead(200, headers);
    res.end(body);
  });
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  try {
    if (rateLimited(req, res)) return;   // 限流闸门：挡在所有路由之前
    const url = req.url || '';
    if (url.startsWith('/store/')) {
      if (!LEGACY_STORE) {   // 旧整段存储已下线（LEGACY_STORE=off）
        sendJson(res, 404, { error: { message: '该端点已下线（旧 /store），请使用 /api/conversations', type: 'legacy_disabled' } });
        return;
      }
      handleStore(req, res).catch((err: any) => {
        console.error('[store] unhandled:', err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end();
      });
    } else if (isOwnApi(url)) {
      handleApi(req, res).catch((err: any) => {
        console.error('[api] unhandled:', err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end();
      });
    } else if (url.startsWith('/api/') || url.startsWith('/v1/')) {
      if (!LEGACY_PROXY) {   // 旧直打链路已下线（LEGACY_PROXY=off）
        sendJson(res, 404, { error: { message: '该端点已下线，请使用 /api/* 应用接口', type: 'legacy_disabled' } });
        return;
      }
      proxy(req, res).catch((err: any) => {
        console.error('[proxy] unhandled:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    console.error('[request] unhandled:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end();
  }
});

// requestTimeout 只约束客户端送完请求体的时间；请求收完后的 SSE/生图响应不受影响。
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(60 * 1000, REQUEST_TIMEOUT_MS);

// 最后一道兜底：未预料到的异常 / Promise 拒绝只记录，不让进程无声退出。
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

// ── 优雅关闭 ────────────────────────────────────────────────────────
// 后端已进关键路径（持 session、转发在途 SSE 流）：重启不能再硬掐所有人的流。
// SIGTERM/SIGINT → 停止接新连接、关掉空闲 keep-alive、等在途请求/流自然结束、刷 WAL、退出。
// Docker 默认只给 10s 宽限，长流式（生图）要排空需在 compose 配 stop_grace_period（见 DEPLOY.md）。
let shuttingDown = false;
function gracefulShutdown(sig: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] 收到 ${sig}，开始优雅关闭…`);
  server.close(() => {
    db.checkpoint();
    console.log('[shutdown] 在途请求已排空、WAL 已刷，退出');
    process.exit(0);
  });
  server.closeIdleConnections?.();   // 关掉空闲 keep-alive，否则 close 回调会一直等它们
  const ms = Number(process.env.SHUTDOWN_TIMEOUT_MS || 30000);
  setTimeout(() => {
    console.error(`[shutdown] ${ms}ms 内未排空，强制退出`);
    try { db.checkpoint(); } catch { /* ignore */ }
    process.exit(1);
  }, ms).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`Manifold chat-demo 已启动: http://localhost:${PORT}`);
  console.log(`上游 sub2api: ${BASE}`);
  if (ARK_API_KEY && SUB2API_ADMIN_KEY) {
    const recoverable = db.listRecoverableVideoTasks();
    for (const row of recoverable) ensureVideoTaskRunning(row);
    if (recoverable.length) console.log(`[seedance] 已恢复 ${recoverable.length} 个视频任务`);
  }
});

// ── Blob GC：周期清理孤儿 blob ────────────────────────────────────
// 删会话会连带删 messages/message_blobs，其引用的图/文件 blob 随之变孤儿（§3）。
// 带宽限期：只清 created_at 早于 now-GRACE 的，避免误删「刚上传拿到 hash、还没发消息挂载」的 blob。
const BLOB_GC_GRACE_MS = Number(process.env.BLOB_GC_GRACE_MS || 60 * 60 * 1000);        // 1h 宽限
const BLOB_GC_INTERVAL_MS = Number(process.env.BLOB_GC_INTERVAL_MS || 6 * 60 * 60 * 1000); // 每 6h 扫一次
function gcBlobs(): void {
  try {
    const hashes = db.orphanBlobs(Date.now() - BLOB_GC_GRACE_MS);
    let removed = 0;
    for (const h of hashes) {
      if (!HASH_RE.test(h)) continue;        // 防御：非法 hash 绝不碰文件系统
      try { fs.rmSync(blobPath(h), { force: true }); } catch { /* 文件已不在也无妨 */ }
      db.deleteBlob(h);
      removed++;
    }
    if (removed) console.log(`[blob-gc] 清理孤儿 blob ${removed} 个`);
  } catch (e: any) {
    console.error('[blob-gc] 失败:', e.message);
  }
}
setTimeout(gcBlobs, 5 * 60 * 1000).unref();          // 启动 5 分钟后跑一次（错开冷启动）
setInterval(gcBlobs, BLOB_GC_INTERVAL_MS).unref();   // 之后周期跑；unref 不阻塞优雅关闭
