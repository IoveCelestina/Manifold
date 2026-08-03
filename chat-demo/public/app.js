/* Manifold · 对话、图像与视频创作 demo
 *
 * 0b 起：浏览器不再持 key/JWT —— 凭证活在服务端 session，浏览器只有一个 httpOnly cookie。
 * 所有推理/登录/key 操作都走本服务同源 /api/*（cookie 自动随请求带上）。
 * 账号登录的会话存服务端 /api/conversations（messages/blobs 表）；免登录贴 key（keyonly）存本地 IndexedDB。
 */
'use strict';

const $ = (id) => document.getElementById(id);
const UPSTREAM = (window.__CHAT_CONFIG__ && window.__CHAT_CONFIG__.upstream) || '(未配置)';
const DEFAULT_FILE_ACCEPT = $('file-input')?.getAttribute('accept') || 'image/*,text/*';

const LS_MODEL = 'mfchat_model';      // 仅保留模型偏好（非敏感）；token/key 一律不进浏览器

const IMAGE_MODEL_PREFIX = 'gpt-image';
const FALLBACK_IMAGE_MODEL = 'gpt-image-2';
const VIDEO_MODEL = 'doubao-seedance-2-0-260128';
// 豆包生图模型能力表（sub2api /v1/models 不返回，登录态前端手动挂；后端 apiImages 直连火山出图+扣费）。
// 每个模型只暴露它支持的参数：分辨率档 sizes、输出格式 formats（仅 5.0 lite 可 png/jpeg，4.5/4.0 固定 jpeg）。
// 计费在后端（按模型单价×出图张数），前端不涉及金额。
const DOUBAO_CAPS = {
  'doubao-seedream-5-0-260128': { label: 'Seedream 5.0 lite', sizes: ['2K', '3K', '4K'], formats: ['png', 'jpeg'], webSearch: true,  fast: false },
  'doubao-seedream-4-5-251128': { label: 'Seedream 4.5',      sizes: ['2K', '4K'],       formats: ['jpeg'],        webSearch: false, fast: false },
  'doubao-seedream-4-0-250828': { label: 'Seedream 4.0',      sizes: ['1K', '2K', '4K'], formats: ['jpeg'],        webSearch: false, fast: true  },
};
const DOUBAO_IMAGE_MODELS = Object.keys(DOUBAO_CAPS);
const DOUBAO_MAX_IMAGES = 10;   // 组图一次最多张数（与后端一致；实际上限还受「参考图数 + 生成数 ≤ 15」约束）
// gpt-image 的尺寸档（豆包各用自己的 sizes；见 syncImagegenControls）
const GPT_SIZES = [
  { v: 'auto', t: 'auto' }, { v: '1024x1024', t: '1024×1024' }, { v: '1536x1024', t: '1536×1024' },
  { v: '1024x1536', t: '1024×1536' }, { v: '2048x2048', t: '2048×2048' }, { v: '2048x1152', t: '2048×1152' },
  { v: '3840x2160', t: '3840×2160' }, { v: '2160x3840', t: '2160×3840' },
];
// 豆包：分辨率档 × 宽高比 → 精确像素（火山「方式2」，官方推荐宽高像素值表）。
// 让用户直接选比例，不必在 prompt 里写「横版/竖屏」；档位由各模型 sizes 决定支持哪些。
const DOUBAO_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const DOUBAO_PIXELS = {
  '1K': { '1:1': '1024x1024', '16:9': '1312x736', '9:16': '736x1312', '4:3': '1152x864', '3:4': '864x1152', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1568x672' },
  '2K': { '1:1': '2048x2048', '16:9': '2848x1600', '9:16': '1600x2848', '4:3': '2304x1728', '3:4': '1728x2304', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' },
  '3K': { '1:1': '3072x3072', '16:9': '4096x2304', '9:16': '2304x4096', '4:3': '3456x2592', '3:4': '2592x3456', '3:2': '3744x2496', '2:3': '2496x3744', '21:9': '4704x2016' },
  '4K': { '1:1': '4096x4096', '16:9': '5504x3040', '9:16': '3040x5504', '4:3': '4704x3520', '3:4': '3520x4704', '3:2': '4992x3328', '2:3': '3328x4992', '21:9': '6240x2656' },
};
// 是否图片生成模型：gpt-image 系 或 豆包 seedream 系
function isImageModelId(id) { const s = id || ''; return s.startsWith(IMAGE_MODEL_PREFIX) || s.startsWith('doubao-seedream'); }
function isVideoModelId(id) { return id === VIDEO_MODEL; }
// 下拉 / 气泡里的友好名（豆包显示 Seedream x.x，其它用原始 id）
function imageModelLabel(id) { return DOUBAO_CAPS[id]?.label || id; }
const MAX_ATTACH = 4;
const ATTACH_MAX_EDGE = 1568;
const FILE_MAX_BYTES = 1024 * 1024;   // 单个文本文件上限 1MB（防上下文撑爆）
// 文本类扩展名白名单（与后端 server.ts TEXT_EXT 保持一致）
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'jsonl', 'ndjson',
  'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'env', 'sql', 'sh', 'bash', 'zsh',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'py', 'rb', 'php',
  'java', 'kt', 'swift', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'm',
  'html', 'htm', 'css', 'scss', 'less', 'r', 'lua', 'pl', 'dart', 'gradle',
]);
function isTextLike(mime, name) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (m === 'application/json' || m === 'application/xml' || m === 'application/x-ndjson') return true;
  if (/\+(json|xml)$/.test(m)) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return TEXT_EXT.has(ext);
}
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
// 消息时间戳 → 绝对日期（本地时区），形如 2026/06/16 14:30:45。
function fmtMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// 在消息元素末尾挂/更新「一行小字」时间。无 ts 则不显示。
function setMsgTime(msgEl, ts) {
  if (!msgEl || !ts) return;
  let el = msgEl.querySelector(':scope > .msg-time');
  if (!el) {
    el = document.createElement('div');
    el.className = 'msg-time';
    msgEl.appendChild(el);
  }
  el.textContent = fmtMsgTime(ts);
}

/* ───────────────────────── 状态 ───────────────────────── */

const state = {
  me: null,                         // {email, uid, key:{label,platform,masked}} | null —— 来自 /api/session/me
  convs: [],                        // 会话元数据+消息（内存镜像）
  currentId: null,
  models: [],
  attachments: [],                  // [{dataUrl}]
  gens: new Map(),                  // convId → {ctrl,kind} —— 每个对话独立的进行中生成
  keysCache: null,                  // 账户 key 列表缓存
};
let genSeq = 0;
const newGenId = () => 'g_' + (++genSeq);   // 生成中消息的稳定 DOM 定位 id（data-genid）

// 是否已认证（账号登录或 keyonly 都算）
function isAuthed() { return !!state.me; }
// 是否有可用 key（决定能否聊天/生图）
function hasKey() { return !!state.me?.key; }

/* ───────────────────────── IndexedDB ───────────────────────── */

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('manifold-chat', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('conv', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idbAll() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction('conv').objectStore('conv').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(conv) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('conv', 'readwrite');
    tx.objectStore('conv').put(conv);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入事务被中止'));
  });
}
async function idbDel(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('conv', 'readwrite');
    tx.objectStore('conv').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 删除事务被中止'));
  });
}
async function idbClear() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('conv', 'readwrite');
    tx.objectStore('conv').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 清空事务被中止'));
  });
}

/* ───────────────────── 同源 API 调用（cookie 自带） ───────────────────── */

// POST JSON：用于登录/2fa/keylogin/logout/key 操作。失败抛错（不自动踢登录），由调用处显示。
async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 空 body */ }
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
  return json || {};
}

// 需登录态的请求（/api/conversations、/api/keys 等）：401 视为 session 失效 → 踢回登录页。
async function authedFetch(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { handleSessionExpired(); throw new Error('登录已过期'); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || j?.message || msg; } catch { /* 非 JSON */ }
    throw new Error(msg);
  }
  try { return await res.json(); } catch { return null; }
}

// 拉当前登录态：未登录返回 {email:null,uid:null,key:null} → state.me 置 null。
async function loadSession() {
  try {
    const me = await (await fetch('/api/session/me')).json();
    state.me = (me && (me.uid != null || me.key != null)) ? me : null;
  } catch { state.me = null; }
}

function handleSessionExpired() {
  abortAllGens();
  state.me = null;
  state.keysCache = null;
  state.convs = [];
  state.currentId = null;
  idbClear().catch(() => {});
  showLogin('登录已过期，请重新登录');
}

/* ─────────────── 会话存储抽象（登录→后端 /api/conversations / keyonly→本地 IndexedDB） ─────────────── */

// 账号登录（有 uid）→ 走后端 /api/conversations；keyonly（无 uid）→ 走本地 IndexedDB。
function useServer() { return state.me?.uid != null; }

const store = {
  async list() {
    if (useServer()) {
      const data = await authedFetch('/api/conversations');
      return (data?.conversations || []).map((c) => ({ ...c, messages: null }));
    }
    return await idbAll();
  },
  async get(id) {
    if (useServer()) return await authedFetch(`/api/conversations/${encodeURIComponent(id)}`);
    return state.convs.find((c) => c.id === id) || null;
  },
  async del(id) {
    if (useServer()) { await authedFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); return; }
    await idbDel(id);
  },
};

// dataURL → Blob（手动解析；不能用 fetch(data:)，会被 CSP connect-src 'self' 拦成 Failed to fetch）。
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/^data:(.*?)[;,]/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 把 Blob 上传到 /api/blobs，返回内容寻址 hash。
async function uploadBlob(blob, fallbackMime) {
  const res = await fetch('/api/blobs', { method: 'POST', headers: { 'Content-Type': blob.type || fallbackMime || 'application/octet-stream' }, body: blob });
  if (!res.ok) { let m = '上传失败'; try { m = (await res.json())?.error?.message || m; } catch { /* 非 JSON */ } throw new Error(m); }
  return (await res.json()).hash;
}
// 把 dataURL 图片上传到 /api/blobs（登录态用：base64 不再进会话 JSON）。
async function uploadDataUrl(dataUrl) {
  return uploadBlob(dataUrlToBlob(dataUrl), 'image/png');
}
// 把文本文件内容上传到 /api/blobs（登录态用）。
async function uploadText(text, mime) {
  return uploadBlob(new Blob([text], { type: mime || 'text/plain' }), 'text/plain');
}

// 按需加载：把某会话 messages 从后端补全（本地模式或已加载则直接返回）
async function ensureMessages(conv) {
  if (!conv || Array.isArray(conv.messages)) return;
  if (!useServer()) { conv.messages = []; return; }
  try {
    const full = await store.get(conv.id);
    conv.messages = (full && full.messages) || [];
    conv._inflight = full?.inflight || null;   // 在途生成标记：openConv 据此重连 /stream
  } catch (e) {
    conv.messages = [];
    console.warn('加载会话正文失败', e);
  }
}

// 切到某会话并确保正文已加载（流式中不切，避免写串）
async function openConv(id) {
  // 多对话并行：随时可切换。切走的对话若在生成，其 reader 仍在后台跑（只更新数据），切回照常显示。
  state.currentId = id;
  renderConvList();
  renderMessages();
  syncComposer();          // 按钮跟随目标对话的生成状态
  closeDrawer();           // 移动端：选中会话后收起抽屉
  const conv = currentConv();
  if (conv && !Array.isArray(conv.messages)) {
    await ensureMessages(conv);
    if (state.currentId === id) { renderMessages(); syncComposer(); }
  }
  // 目标对话有后端在途生成、但前端此刻没有活跃 reader（如刷新后）→ 重连接上
  if (conv && conv._inflight && state.currentId === id && !state.gens.has(id)) {
    reconnectInflight(conv);   // 不 await：已加载的消息先渲染，再续接在途流
  }
}

// 重连在途生成：刷新/重开会话后接上后台还没跑完的回复（聊天、生图或视频任务）。
// 后端已把生成做成脱离连接的任务，这里只是重新订阅；结束后从 DB 重拉同步规范状态。
async function reconnectInflight(conv) {
  const kind = conv._inflight?.kind;
  conv._inflight = null;                 // 只触发一次
  if (!kind || state.gens.has(conv.id)) return;

  const ctrl = beginGen(conv, kind);

  // 临时占位消息（进行中）；跑完从 DB 重拉规范状态覆盖。数据驱动 → 期间可自由切换对话。
  const aMsg = { role: 'assistant', kind, model: '', text: '', images: [], _genid: newGenId(), _pending: true, _meta: '接上后台生成…' };
  conv.messages.push(aMsg);
  patchGen(conv, aMsg);   // 首次渲染（数据驱动、增量；不在当前对话则跳过）

  let res;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(conv.id)}/stream`, { signal: ctrl.signal });
    if (res.status !== 204 && res.ok && res.body) {
      if (kind === 'image') {
        await readImageSse(res, (imgs) => { aMsg.images = imgs; patchGen(conv, aMsg); });
      } else if (kind === 'video') {
        await readVideoSse(res, (event) => {
          aMsg._status = event.status;
          aMsg._meta = event.message || videoStatusLabel(event.status);
          patchGen(conv, aMsg);
        });
      } else {
        let last = 0;
        await pumpChatSse(res, (d) => {
          aMsg.text += d;
          const now = Date.now();
          if (now - last > 90) { last = now; patchGen(conv, aMsg); }
        });
      }
    }
  } catch { /* 出错/中止由下方 DB 同步纠正 */ }

  // 收尾：移除临时占位 + 从 DB 重拉规范状态（后端已落库）
  dropMsg(conv, aMsg);
  endGen(conv);
  conv.messages = null;
  await ensureMessages(conv);
  if (state.currentId === conv.id) renderMessages();
}

// 统一加载会话列表（按 useServer 选后端/本地），并设好 currentId
async function loadConversations() {
  try {
    const all = await store.list();
    state.convs = all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.warn('加载会话列表失败', e);
    state.convs = [];
  }
  state.currentId = state.convs[0]?.id || null;
}

// Phase 1：登录态会话用后端新数据模型（messages/blobs 表）。把本地 IndexedDB 会话（keyonly 时存的）
// 自动导入到账号需要后端迁移支持，暂缓——本地副本保留不动，登录态用后端会话。
// （0b 的「整段 PUT /store 导入」随 /store 下线一并移除。）
async function maybeMigrateLocal() { /* no-op：见上说明 */ }

/* ───────────────────────── 登录视图 ───────────────────────── */

function showLogin(err) {
  $('view-login').classList.remove('hidden');
  $('view-app').classList.add('hidden');
  loginError(err || null);
  $('login-form').classList.remove('hidden');
  $('totp-form').classList.add('hidden');
}
function showApp() {
  $('view-login').classList.add('hidden');
  $('view-app').classList.remove('hidden');
  renderMe();
  renderKeyChip();
  loadModels();
  if (!state.currentId) state.currentId = state.convs[0]?.id || null;
  if (state.currentId) {
    openConv(state.currentId);
  } else {
    renderConvList();
    renderMessages();
  }
  if (state.me?.uid != null) loadAccountKeys().catch(() => {});
}
function loginError(msg) {
  const el = $('login-error');
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

// 登录/2fa/keylogin 成功后的统一收尾：拉 me、加载会话、进入 app。
async function afterAuth() {
  await loadSession();
  await loadConversations();
  showApp();
  maybeMigrateLocal();
  if (state.me?.uid != null && !state.me.key) openSettings(); // 账号登录但还没 key → 引导去设置
}

let pendingTicket = null;

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError(null);
  const btn = $('login-submit');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    const data = await postJson('/api/session/login', {
      email: $('login-email').value.trim(), password: $('login-password').value,
    });
    if (data?.need_2fa) {
      pendingTicket = data.ticket;
      $('login-form').classList.add('hidden');
      $('totp-form').classList.remove('hidden');
      $('totp-code').focus();
    } else {
      await afterAuth();
    }
  } catch (err) {
    loginError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = '登 录';
  }
});

$('totp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError(null);
  try {
    await postJson('/api/session/2fa', { ticket: pendingTicket, code: $('totp-code').value.trim() });
    await afterAuth();
  } catch (err) {
    loginError(err.message);
  }
});

$('totp-back').addEventListener('click', () => {
  pendingTicket = null;
  $('totp-form').classList.add('hidden');
  $('login-form').classList.remove('hidden');
});

$('keyonly-toggle').addEventListener('click', () => {
  $('keyonly-form').classList.toggle('hidden');
  $('keyonly-input').focus();
});
$('keyonly-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $('keyonly-input').value.trim();
  if (!k) return;
  try {
    await postJson('/api/session/keylogin', { key: k });
    $('keyonly-input').value = '';
    await afterAuth();
  } catch (err) {
    loginError(err.message);
  }
});

$('btn-logout').addEventListener('click', async () => {
  abortAllGens();
  try { await postJson('/api/session/logout', {}); } catch { /* 忽略 */ }
  state.me = null;
  state.keysCache = null;
  state.convs = [];
  state.currentId = null;
  idbClear().catch(() => {});      // 清本地缓存的会话，避免共享设备泄露
  showLogin();
});

/* ───────────────────────── 账户 key 管理 ───────────────────────── */

// 账户 key 列表（脱敏，不含明文）。仅账号登录可用；keyonly 无账户列表。
async function loadAccountKeys() {
  if (state.me?.uid == null) return [];
  const data = await authedFetch('/api/keys');
  const keys = (data?.keys || []).map((k) => ({
    id: k.id, name: k.label, platform: k.platform, masked: k.masked, hasKey: k.hasKey, selected: k.selected,
  }));
  state.keysCache = keys;
  renderKeyList();
  return keys;
}

// 选定账户里的某个 key（明文在服务端取，不进浏览器）
async function selectKey(id) {
  try {
    await postJson('/api/keys/select', { id });
    await loadSession();        // 刷新 me.key
    renderKeyChip();
    await loadAccountKeys();     // 刷新 selected 标记
    loadModels();
  } catch (e) { alert(e.message); }
}

// 手动贴 key：存进当前 session（明文不回浏览器）
async function useManualKey(k) {
  await postJson('/api/keys/manual', { key: k });
  await loadSession();
  renderKeyChip();
  renderKeyList();
  loadModels();
}

const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const SVG_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

function makeKeyRow(k) {
  const plat = (k.platform || '').toLowerCase();
  const known = plat === 'openai' || plat === 'anthropic' || plat === 'gemini';
  const row = document.createElement('button');
  row.className = 'sx-key is-' + (known ? plat : 'other') + (k.selected ? ' selected' : '');
  row.innerHTML =
    '<span class="sx-key-dot"></span>' +
    '<span class="sx-key-main"><span class="sx-key-name"></span><span class="sx-key-id"></span></span>' +
    '<span class="sx-plat' + (known ? ' ' + plat : '') + '"></span>' +
    '<span class="sx-key-check">' + SVG_CHECK + '</span>';
  row.querySelector('.sx-key-name').textContent = k.name;
  row.querySelector('.sx-key-id').textContent = k.masked || '';
  row.querySelector('.sx-plat').textContent = plat || '?';
  row.addEventListener('click', () => {
    if (!k.hasKey) return;
    selectKey(k.id);
  });
  return row;
}

function makeManualRow(maskedLabel) {
  const row = document.createElement('div');
  row.className = 'sx-key is-manual selected';
  row.innerHTML =
    '<span class="sx-key-dot"></span>' +
    '<span class="sx-key-main"><span class="sx-key-name">手动 Key</span><span class="sx-key-id"></span></span>' +
    '<span class="sx-plat manual">' + SVG_PENCIL + '手动</span>' +
    '<span class="sx-key-check">' + SVG_CHECK + '</span>';
  row.querySelector('.sx-key-id').textContent = maskedLabel || '';
  return row;
}

// 当前生效的 key 永远显示为选中行；来源是手动贴 key（platform=manual，不在账户列表）时，顶部补一行“手动”。
function renderKeyList() {
  const list = $('key-list');
  if (!list) return;
  const hint = $('key-hint');
  const refreshBtn = $('btn-refresh-keys');
  const loggedIn = state.me?.uid != null;

  if (refreshBtn) refreshBtn.classList.toggle('hidden', !loggedIn);
  if (hint) hint.classList.toggle('hidden', !loggedIn);

  list.innerHTML = '';
  const keys = loggedIn ? (state.keysCache || []) : [];
  const activeInList = keys.some((k) => k.selected);

  // 当前 key 是手动贴的（platform=manual 或不在账户列表）→ 顶部补“手动”行
  if (state.me?.key && (state.me.key.platform === 'manual' || !activeInList)) {
    list.appendChild(makeManualRow(state.me.key.masked || state.me.key.label));
  }

  if (loggedIn && !keys.length) {
    const p = document.createElement('p');
    p.className = 'sx-empty';
    p.textContent = '账户下没有可用的 key，去 sub2api 控制台创建一个。';
    list.appendChild(p);
  }
  for (const k of keys) list.appendChild(makeKeyRow(k));

  if (!list.children.length) {
    const p = document.createElement('p');
    p.className = 'sx-empty';
    p.textContent = '还没有设置 key —— 在下方粘贴一个开始。';
    list.appendChild(p);
  }
}

$('btn-refresh-keys').addEventListener('click', () => loadAccountKeys().catch((e) => alert(e.message)));
$('btn-use-key').addEventListener('click', async () => {
  const k = $('settings-key-input').value.trim();
  if (!k) return;
  try {
    await useManualKey(k);
    $('settings-key-input').value = '';
  } catch (e) { alert(e.message); }
});

function renderKeyChip() {
  const label = state.me?.key ? (state.me.key.label || state.me.key.masked || 'Key') : '未设置 Key';
  const hasKey = !!state.me?.key;
  const chip = $('key-chip');
  if (chip) {
    chip.textContent = label;
    chip.classList.toggle('unset', !hasKey);
  }
  // 移动端：抽屉底部 Key 入口同步（顶栏 key-chip 在窄屏已收起）
  const keyLabel = $('me-key-label');
  if (keyLabel) {
    keyLabel.textContent = label;
    $('me-key')?.classList.toggle('unset', !hasKey);
  }
}

function renderMe() {
  $('me-label').textContent = state.me?.email || (state.me?.key ? '仅 Key 模式' : '未登录');
}

/* ───────────────────────── 设置弹层 ───────────────────────── */

function openSettings() {
  $('settings-upstream').textContent = UPSTREAM;
  renderKeyList();
  $('settings-mask').classList.remove('hidden');
}
$('key-chip').addEventListener('click', openSettings);
function closeSettings() { $('settings-mask').classList.add('hidden'); }
$('btn-close-settings').addEventListener('click', closeSettings);
$('btn-close-settings-x').addEventListener('click', closeSettings);
$('btn-confirm-settings').addEventListener('click', closeSettings);
$('settings-mask').addEventListener('click', (e) => {
  if (e.target === $('settings-mask')) closeSettings();
});

/* ───────────────────────── 模型 ───────────────────────── */

async function loadModels() {
  const sel = $('model-select');
  let ids = [];
  if (hasKey()) {
    try {
      const res = await fetch('/api/models');
      const json = await res.json();
      if (res.ok) ids = (json.data || []).map((m) => m.id).filter(Boolean).sort();
    } catch { /* 拉不到就用兜底列表 */ }
    if (!ids.includes(FALLBACK_IMAGE_MODEL)) ids.push(FALLBACK_IMAGE_MODEL);
  }
  // 登录态（有 uid，可按账号扣费）才挂豆包生图模型；keyonly 无法扣费，不显示。
  if (useServer()) {
    if (hasKey()) for (const id of DOUBAO_IMAGE_MODELS) if (!ids.includes(id)) ids.push(id);
    if (!ids.includes(VIDEO_MODEL)) ids.push(VIDEO_MODEL); // 视频只用服务端现有方舟 Key，不要求用户另选 key
  }
  if (!ids.length) ids.push(FALLBACK_IMAGE_MODEL);
  state.models = ids;

  const saved = localStorage.getItem(LS_MODEL);
  sel.innerHTML = '';
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = isVideoModelId(id) ? 'Seedance 2.0 ▷视频' : (isImageModelId(id) ? `${imageModelLabel(id)} ✦图` : id);
    sel.appendChild(opt);
  }
  sel.value = saved && ids.includes(saved) ? saved : ids[0];
  syncComposerMode();
}

$('model-select').addEventListener('change', () => {
  localStorage.setItem(LS_MODEL, $('model-select').value);
  syncComposerMode();
});

function currentModel() { return $('model-select').value; }
function isImageMode() { return isImageModelId(currentModel()); }
function isVideoMode() { return isVideoModelId(currentModel()); }

function syncComposerMode() {
  const img = isImageMode();
  const video = isVideoMode();
  $('composer').classList.toggle('mode-image', img);
  $('composer').classList.toggle('mode-video', video);
  $('imagegen-controls').classList.toggle('hidden', !img);
  $('videogen-controls').classList.toggle('hidden', !video);
  $('input-box').placeholder = video ? '描述镜头、动作、节奏与声音…（可附参考图）' : (img ? '描述你想生成的画面…（可附参考图改图）' : '输入消息…');
  $('file-input').accept = (img || video) ? 'image/*' : DEFAULT_FILE_ACCEPT;
  $('btn-attach').title = (img || video) ? '上传参考图片' : '上传图片或文本附件';
  syncComposer();   // 按钮文字/状态跟随当前对话（生成中显示「停止」，否则「生成/发送」）
  $('composer-hint').textContent = video
    ? '视频任务会在后台生成 · 完成后自动保存到本对话 · 按实际 Tokens 结算'
    : (img ? '生图模式 · 直接描述 = 文生图 · 附图 = 按参考图改图' : 'Enter 发送 · Shift+Enter 换行');
  syncImagegenControls();   // 按当前模型出对分辨率/格式档、显隐 quality/输出格式
  syncModelPill();          // 移动端顶栏药丸跟随当前模型
}

/* ── 移动端：顶栏模型药丸 + 底部模型选择弹层（桌面用 header 的 select，不触发弹层）── */
function syncModelPill() {
  const el = $('model-pill-name');
  if (el) el.textContent = isVideoMode() ? 'Seedance 2.0' : (isImageMode() ? imageModelLabel(currentModel()) : (currentModel() || '模型'));
  $('model-pill')?.classList.toggle('is-image', isImageMode());
  $('model-pill')?.classList.toggle('is-video', isVideoMode());
}

function renderModelSheet() {
  const list = $('model-sheet-list');
  if (!list) return;
  const sel = $('model-select');
  const cur = sel.value;
  list.innerHTML = '';
  for (const opt of sel.options) {
    const id = opt.value;
    const isImg = isImageModelId(id);
    const isVideo = isVideoModelId(id);
    const btn = document.createElement('button');
    btn.className = 'sheet-mdl ' + (isVideo ? 'is-video' : (isImg ? 'is-image' : 'is-chat')) + (id === cur ? ' sel' : '');
    btn.innerHTML =
      '<span class="sheet-mdl-dot"></span>' +
      '<span class="sheet-mdl-name"></span>' +
      '<span class="sheet-mdl-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
    btn.querySelector('.sheet-mdl-name').textContent = isVideo ? 'Seedance 2.0' : imageModelLabel(id);
    btn.addEventListener('click', () => {
      if (sel.value !== id) {
        sel.value = id;
        sel.dispatchEvent(new Event('change'));   // 复用现有逻辑：存偏好 + syncComposerMode（含刷新药丸）
      }
      closeModelSheet();
    });
    list.appendChild(btn);
  }
}

function openModelSheet() {
  renderModelSheet();
  $('model-sheet').classList.add('open');
  $('model-sheet-scrim').classList.add('open');
}
function closeModelSheet() {
  $('model-sheet').classList.remove('open');
  $('model-sheet-scrim').classList.remove('open');
}

// 高分尺寸只有文生图 /generations 支持；改图 /edits 只认 auto 和三个原生预设。
const NATIVE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
function syncSizeOptions() {
  if (DOUBAO_CAPS[currentModel()]) return;   // 豆包用自己的分辨率档，不受 gpt /edits 尺寸限制
  const sel = $('size-select');
  const editMode = state.attachments.length > 0;
  for (const opt of sel.options) opt.disabled = editMode && !NATIVE_SIZES.has(opt.value);
  if (editMode && !NATIVE_SIZES.has(sel.value)) sel.value = '1024x1024';
}

// 用 items（[{v,t}]）重填一个 select，尽量保留原选择，否则用 defVal。
function fillSelect(sel, items, defVal) {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.v; o.textContent = it.t;
    sel.appendChild(o);
  }
  sel.value = items.some((i) => i.v === prev) ? prev : defVal;
}

// 当前生图附件里的图片数（豆包参考图；决定组图上限：参考图数 + 生成数 ≤ 15）。
function imgAttachCount() { return state.attachments.filter((a) => a.kind === 'image').length; }

// 按当前模型让生图控件「只暴露该模型支持的参数」：
//   豆包 → 分辨率档 + 宽高比 + 生成数量(组图) + 输出格式(5.0lite) + 联网搜索(5.0lite) + 提词模式(4.0)，隐藏 quality；
//   gpt-image → gpt 尺寸档 + quality，隐藏其余豆包控件。
function syncImagegenControls() {
  if (!isImageMode()) return;
  const model = currentModel();
  const caps = DOUBAO_CAPS[model];
  const sizeSel = $('size-select');
  const qSel = $('quality-select');
  const fSel = $('output-format-select');
  const rSel = $('ratio-select');
  const cSel = $('count-select');
  const wSel = $('websearch-select');
  const pSel = $('promptmode-select');
  if (caps) {
    fillSelect(sizeSel, caps.sizes.map((s) => ({ v: s, t: s })), caps.sizes.includes('2K') ? '2K' : caps.sizes[0]);
    fillSelect(rSel, DOUBAO_RATIOS.map((r) => ({ v: r, t: '比例·' + r })), '1:1');
    rSel.classList.remove('hidden');
    qSel.classList.add('hidden');
    // 生成数量（组图）：上限 = min(10, 15 − 参考图数)
    const maxCount = Math.max(1, Math.min(DOUBAO_MAX_IMAGES, 15 - imgAttachCount()));
    fillSelect(cSel, Array.from({ length: maxCount }, (_, i) => ({ v: String(i + 1), t: i === 0 ? '单张' : `组图·${i + 1}张` })), '1');
    cSel.classList.remove('hidden');
    // 输出格式：仅 5.0 lite 可选 png/jpeg
    if (caps.formats.length > 1) {
      fillSelect(fSel, caps.formats.map((f) => ({ v: f, t: '格式·' + f.toUpperCase() })), caps.formats[0]);
      fSel.classList.remove('hidden');
    } else {
      fSel.classList.add('hidden');   // 4.5/4.0 固定 jpeg，无可选项
    }
    // 联网搜索：仅 5.0 lite
    wSel.classList.toggle('hidden', !caps.webSearch);
    if (!caps.webSearch) wSel.value = 'off';
    // 提词模式：仅 4.0 有 fast
    pSel.classList.toggle('hidden', !caps.fast);
    if (!caps.fast) pSel.value = 'standard';
  } else {
    fillSelect(sizeSel, GPT_SIZES, '1024x1024');
    rSel.classList.add('hidden');      // 宽高比仅豆包用（gpt 用具体像素档）
    cSel.classList.add('hidden');
    wSel.classList.add('hidden');
    pSel.classList.add('hidden');
    qSel.classList.remove('hidden');
    fSel.classList.add('hidden');
    syncSizeOptions();                 // gpt /edits 尺寸限制
  }
}

/* ───────────────────────── 会话 ───────────────────────── */

function newConv() {
  const conv = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.convs.unshift(conv);
  state.currentId = conv.id;
  renderConvList();
  renderMessages();
  syncComposer();         // 新对话没有进行中生成 → 按钮回到「生成/发送」
  closeDrawer();          // 移动端：新建对话后收起抽屉
  return conv;
}

function currentConv() {
  return state.convs.find((c) => c.id === state.currentId) || null;
}

let quotaWarned = false;
let persistWarned = false;

async function persistConv(conv) {
  conv.updatedAt = Date.now();
  // 登录态：消息由后端落库（发消息时），前端不再整段保存，仅刷新侧栏。
  if (useServer()) { renderConvList(); return true; }
  // keyonly：存本地 IndexedDB
  let ok = true;
  try {
    await idbPut(conv);
  } catch (e) {
    ok = false;
    console.warn('persist failed', e);
    if (e?.name === 'QuotaExceededError') {
      if (!quotaWarned) {
        quotaWarned = true;
        alert('浏览器存储空间已满，本次对话无法持久保存。\n建议删掉旧对话（特别是含生成图片的），或把重要图片先下载下来。');
      }
    } else if (!persistWarned) {
      persistWarned = true;
      alert(`对话保存失败：${e?.message || e}\n当前对话本次仍可继续，但刷新页面后可能丢失。`);
    }
  }
  renderConvList();
  return ok;
}

function renderConvList() {
  const nav = $('conv-list');
  nav.innerHTML = '';
  for (const conv of state.convs) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === state.currentId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'conv-item-title';
    title.textContent = conv.title;
    const del = document.createElement('button');
    del.className = 'conv-item-del';
    del.title = '删除对话';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.gens.has(conv.id)) {
        alert('该对话仍在生成中，请先停止或取消任务，再删除。');
        return;
      }
      try { await store.del(conv.id); }
      catch (err) { alert(`删除失败：${err?.message || err}`); return; }
      state.convs = state.convs.filter((c) => c.id !== conv.id);
      if (state.currentId === conv.id) {
        state.currentId = state.convs[0]?.id || null;
        renderMessages();
        syncComposer();
      }
      renderConvList();
    });
    item.appendChild(title);
    item.appendChild(del);
    item.addEventListener('click', () => {
      openConv(conv.id);
    });
    nav.appendChild(item);
  }
}

$('btn-new-chat').addEventListener('click', () => {
  newConv();            // 生成中也能新建：旧对话在后台继续生成，切回可见
  $('input-box').focus();
});

/* ── 移动端抽屉（≤760px 侧栏滑出/收起，桌面无副作用）── */
const openDrawer = () => $('view-app').classList.add('drawer-open');
const closeDrawer = () => $('view-app').classList.remove('drawer-open');
$('btn-menu').addEventListener('click', openDrawer);
$('sidebar-scrim').addEventListener('click', closeDrawer);
$('btn-new-mobile').addEventListener('click', () => {
  newConv();            // newConv 内已收起抽屉；生成中也能新建
  $('input-box').focus();
});
// 移动端：顶栏药丸开模型弹层、抽屉底部 Key 入口开设置
$('model-pill').addEventListener('click', openModelSheet);
$('model-sheet-scrim').addEventListener('click', closeModelSheet);
$('me-key').addEventListener('click', () => { closeDrawer(); openSettings(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDrawer(); closeModelSheet(); }
});

/* ───────────────────────── 消息渲染 ───────────────────────── */

function mdRender(text) {
  const raw = marked.parse(text || '', { breaks: true });
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
}

function renderMessages() {
  const wrap = $('messages');
  wrap.innerHTML = '';
  const conv = currentConv();
  $('header-title').textContent = conv?.title || '新对话';
  if (conv && !Array.isArray(conv.messages)) {
    wrap.appendChild(buildLoadingState());
    return;
  }
  if (!conv || !conv.messages.length) {
    wrap.appendChild(buildEmptyState());
    return;
  }
  for (const m of conv.messages) wrap.appendChild(buildMsgEl(m));
  scrollToBottom(true);
}

function buildLoadingState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = '<p class="empty-title">载入对话中…</p>';
  return div;
}

function buildEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <svg class="empty-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="19" fill="none"/>
      <ellipse cx="24" cy="24" rx="19" ry="11" fill="none"/>
      <ellipse cx="24" cy="24" rx="19" ry="4.5" fill="none"/>
    </svg>
    <p class="empty-title">开始一段对话</p>
    <p class="empty-hint">上传图片让模型识图，切到
      <button class="inline-link mono" data-mode="image">${FALLBACK_IMAGE_MODEL}</button> 创作画面，或用
      <button class="inline-link mono video-link" data-mode="video">Seedance 2.0</button> 生成视频</p>`;
  div.querySelector('[data-mode="image"]').addEventListener('click', () => {
    const sel = $('model-select');
    const target = state.models.find((m) => m.startsWith(IMAGE_MODEL_PREFIX)) || FALLBACK_IMAGE_MODEL;
    sel.value = target;
    sel.dispatchEvent(new Event('change'));
    $('input-box').focus();
  });
  div.querySelector('[data-mode="video"]')?.addEventListener('click', () => {
    const sel = $('model-select');
    if (![...sel.options].some((o) => o.value === VIDEO_MODEL)) return;
    sel.value = VIDEO_MODEL;
    sel.dispatchEvent(new Event('change'));
    $('input-box').focus();
  });
  return div;
}

// 归一化一条消息的附件 → [{kind:'image'|'video'|'file', name, url, mime}]。
// 来源三态：① 登录态持久化 m.blobs=[{hash,name,mime,size}]（兼容旧裸 hash 字符串，按图片）；
//           ② 本地乐观/keyonly m.atts=[{kind,name,mime,dataUrl?}]；③ 旧 IndexedDB m.images=[dataUrl]。
function msgAttachments(m) {
  if (m.blobs?.length) {
    return m.blobs.map((b) => {
      const hash = typeof b === 'string' ? b : b.hash;
      const mime = typeof b === 'string' ? 'image/*' : (b.mime || '');
      const url = `/api/blobs/${encodeURIComponent(hash)}`;
      if (mime.startsWith('image/') || mime === 'image/*') return { kind: 'image', name: (b.name || ''), url, mime };
      if (mime.startsWith('video/')) return { kind: 'video', name: (b.name || 'Seedance 成片'), url, mime };
      return { kind: 'file', name: (b.name || hash), url, mime };
    });
  }
  if (m.atts?.length) {
    return m.atts.map((a) => a.kind === 'file'
      ? { kind: 'file', name: a.name, url: a.url || '', mime: a.mime || 'text/plain' }
      : { kind: 'image', name: a.name || '', url: a.dataUrl || a.url, mime: a.mime || 'image/png' });
  }
  return (m.images || []).map((u) => ({ kind: 'image', name: '', url: u, mime: 'image/png' }));
}

function buildMsgEl(m) {
  const div = document.createElement('div');
  if (m.role === 'user') {
    div.className = 'msg msg-user';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = m.text || '';
    const atts = msgAttachments(m);
    const imgs = atts.filter((a) => a.kind === 'image').map((a) => a.url);
    const filz = atts.filter((a) => a.kind === 'file');
    if (imgs.length) body.appendChild(buildImages(imgs, false));
    if (filz.length) body.appendChild(buildFileChips(filz));
    div.appendChild(body);
  } else if (m.kind === 'error') {
    div.className = 'msg msg-error';
    div.innerHTML = `<div class="msg-role"><span class="msg-role-glyph">✕</span><span class="msg-role-name">错误</span></div>`;
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = m.text || '';
    div.appendChild(body);
  } else {
    div.className = 'msg msg-assistant' + (m.kind === 'image' ? ' is-image' : (m.kind === 'video' ? ' is-video' : ''));
    if (m._genid) div.dataset.genid = m._genid;     // 生成中消息的稳定定位 id（供 patchGen 续画）
    div.innerHTML = `<div class="msg-role">
        <span class="msg-role-glyph">${m.kind === 'image' ? '✦' : (m.kind === 'video' ? '▷' : '∴')}</span>
        <span class="msg-role-name"></span>
      </div>`;
    div.querySelector('.msg-role-name').textContent = m.model || 'assistant';
    const body = document.createElement('div');
    body.className = 'msg-body md';
    if (m.kind === 'image') {
      if (m.text) body.innerHTML = mdRender(m.text);
      const aImgs = msgAttachments(m).filter((a) => a.kind === 'image').map((a) => a.url);
      if (aImgs.length) body.appendChild(buildImages(aImgs, true));
      if (m._pending) {                              // 生图进行中：已出的图 + 转圈
        const pend = document.createElement('div');
        pend.className = 'gen-pending';
        pend.innerHTML = `<div class="gen-rings"><span></span><span></span><span></span></div><div class="gen-pending-text">${aImgs.length ? '继续生成中…' : ('正在生成 ' + (m._meta || ''))}</div>`;
        body.appendChild(pend);
      }
    } else if (m.kind === 'video') {
      const videoAtt = msgAttachments(m).find((a) => a.kind === 'video');
      if (videoAtt) body.appendChild(buildVideoItem(videoAtt, m.text));
      if (m._pending) body.appendChild(buildVideoPending(m._meta || '准备任务'));
    } else {
      body.innerHTML = mdRender(m.text || '') + (m._pending ? '<span class="stream-caret"></span>' : '');
    }
    div.appendChild(body);
  }
  // 一行小字：用户消息=发送时间，助手消息=回复完成时间（流式中还没 createdAt，完成后再补）。
  setMsgTime(div, m.createdAt);
  return div;
}

function buildVideoPending(label) {
  const el = document.createElement('div');
  el.className = 'video-pending';
  el.innerHTML = '<div class="video-time-rail" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><div class="video-pending-copy"><span class="video-live-dot"></span><span class="video-pending-text"></span></div>';
  el.querySelector('.video-pending-text').textContent = label;
  return el;
}

function buildVideoItem(att, spec) {
  const wrap = document.createElement('figure');
  wrap.className = 'msg-video-wrap';
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = att.url;
  video.setAttribute('aria-label', att.name || 'Seedance 生成视频');
  wrap.appendChild(video);
  const cap = document.createElement('figcaption');
  const meta = document.createElement('span');
  meta.className = 'video-spec mono';
  meta.textContent = spec || 'Seedance 2.0';
  const dl = document.createElement('a');
  dl.className = 'video-download'; dl.href = att.url; dl.download = att.name || `seedance-${Date.now()}.mp4`; dl.textContent = '下载 MP4';
  cap.append(meta, dl); wrap.appendChild(cap);
  return wrap;
}

// 单张图片项（.msg-img-wrap）。buildImages 与 patchGen 增量追加共用 —— 已解码的图不被重建。
function buildImageItem(url, i, downloadable) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-img-wrap';
  const img = document.createElement('img');
  img.loading = 'lazy';       // 只加载滚动到可见的图，避免一次性解码整轮对话的大图（4K 图解码极耗内存）
  img.decoding = 'async';     // 异步解码，不阻塞主线程
  img.alt = `图片 ${i + 1}`;
  img.src = url;              // src 在 loading/decoding 之后设，确保懒加载生效
  img.addEventListener('click', () => openLightbox(url));
  wrap.appendChild(img);
  if (downloadable) {
    const a = document.createElement('a');
    a.className = 'img-download';
    a.textContent = '下载';
    a.href = url;
    a.download = `manifold-${Date.now()}-${i + 1}.png`;
    wrap.appendChild(a);
  }
  return wrap;
}
function buildImages(urls, downloadable) {
  const box = document.createElement('div');
  box.className = 'msg-images';
  urls.forEach((u, i) => box.appendChild(buildImageItem(u, i, downloadable)));
  return box;
}

// 消息里的文件附件卡片：有 url（登录态 blob）则可点击下载/查看；keyonly 无 url 仅显示文件名。
function buildFileChips(files) {
  const box = document.createElement('div');
  box.className = 'msg-files';
  files.forEach((f) => {
    const el = document.createElement(f.url ? 'a' : 'div');
    el.className = 'msg-file-chip';
    if (f.url) { el.href = f.url; el.target = '_blank'; el.rel = 'noopener'; }
    el.innerHTML = `<span class="msg-file-icon">📄</span><span class="msg-file-name"></span>`;
    el.querySelector('.msg-file-name').textContent = f.name || '附件';
    box.appendChild(el);
  });
  return box;
}

function openLightbox(url) {
  document.querySelector('.lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'lightbox';
  const img = document.createElement('img');
  img.src = url;
  box.appendChild(img);
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

function scrollToBottom(force) {
  const sc = $('messages-scroll');
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  if (force || nearBottom) sc.scrollTop = sc.scrollHeight;
}

/* ───────────────────────── 附件（识图上传） ───────────────────────── */

$('btn-attach').addEventListener('click', () => $('file-input').click());

$('file-input').addEventListener('change', async (e) => {
  await addFiles(e.target.files);
  e.target.value = '';
});

// 统一入口：点选 / 粘贴 / 拖拽都走这里——图片压缩、文本文件读文本，push、重渲染。返回实际加入数。
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  for (const file of files) {
    if (state.attachments.length >= MAX_ATTACH) break;
    const isImage = (file.type || '').startsWith('image/');
    try {
      if (isImage) {
        const dataUrl = await fileToDataUrl(file);
        state.attachments.push({ kind: 'image', dataUrl, name: file.name || '', mime: file.type || 'image/png', size: file.size });
        added++;
      } else if (isImageMode() || isVideoMode()) {
        alert(`当前创作模式只接受参考图片：${file.name || '未知文件'}`);
      } else if (isTextLike(file.type, file.name || '')) {
        if (file.size > FILE_MAX_BYTES) { alert(`文件「${file.name}」超过 ${fmtBytes(FILE_MAX_BYTES)}，暂不支持。`); continue; }
        const text = await fileToText(file);
        state.attachments.push({ kind: 'file', name: file.name || '未命名', mime: file.type || 'text/plain', size: file.size, text });
        added++;
      } else {
        alert(`暂不支持该文件类型：${file.name || file.type || '未知'}（目前仅图片和纯文本类文件）`);
      }
    } catch (err) {
      alert(`读取文件失败：${err.message}`);
    }
  }
  if (added) renderAttachments();
  return added;
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('读取失败'));
    r.readAsText(file);
  });
}

async function fileToDataUrl(file) {
  const raw = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('不是有效图片'));
    i.src = raw;
  });
  if (Math.max(img.width, img.height) <= ATTACH_MAX_EDGE && raw.length < 2.5 * 1024 * 1024) return raw;
  const scale = Math.min(1, ATTACH_MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return raw;
  }
}

function renderAttachments() {
  const box = $('attach-previews');
  box.innerHTML = '';
  box.classList.toggle('hidden', !state.attachments.length);
  state.attachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip' + (att.kind === 'file' ? ' attach-file' : '');
    if (att.kind === 'file') {
      const info = document.createElement('div');
      info.className = 'attach-file-info';
      info.innerHTML = `<span class="attach-file-icon">📄</span><span class="attach-file-meta"><span class="attach-file-name"></span><span class="attach-file-size"></span></span>`;
      info.querySelector('.attach-file-name').textContent = att.name;
      info.querySelector('.attach-file-size').textContent = fmtBytes(att.size || (att.text || '').length);
      chip.appendChild(info);
    } else {
      const img = document.createElement('img');
      img.src = att.dataUrl;
      chip.appendChild(img);
    }
    const del = document.createElement('button');
    del.textContent = '×';
    del.addEventListener('click', () => {
      state.attachments.splice(idx, 1);
      renderAttachments();
    });
    chip.appendChild(del);
    box.appendChild(chip);
  });
  syncImagegenControls();   // 附件增减 → 重算豆包组图上限（参考图数 + 生成数 ≤ 15）；gpt 内部转 syncSizeOptions
}

// Ctrl/⌘+V 粘贴：剪贴板含图片/文本文件才介入，纯文本粘贴照常进输入框。
document.addEventListener('paste', (e) => {
  if ($('view-app').classList.contains('hidden')) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind !== 'file') continue;            // kind==='string' 是纯文本，留给输入框
    const f = it.getAsFile();
    if (!f) continue;
    if ((it.type || '').startsWith('image/') || isTextLike(f.type, f.name || '')) files.push(f);
  }
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
});

// 拖拽图片到窗口任意处上传；拖拽期间显示提示遮罩。
const dropOverlay = $('drop-overlay');
let dragDepth = 0;
const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
const showDrop = (on) => dropOverlay && dropOverlay.classList.toggle('hidden', !on);

window.addEventListener('dragenter', (e) => {
  if ($('view-app').classList.contains('hidden') || !isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  showDrop(true);
});
window.addEventListener('dragover', (e) => {
  if ($('view-app').classList.contains('hidden') || !isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) showDrop(false);
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  showDrop(false);
  if ($('view-app').classList.contains('hidden')) return;
  addFiles(e.dataTransfer.files);
});

/* ───────────────────────── 发送 ───────────────────────── */

const inputBox = $('input-box');

inputBox.addEventListener('input', () => {
  inputBox.style.height = 'auto';
  inputBox.style.height = Math.min(inputBox.scrollHeight, 220) + 'px';
});
inputBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    onSend();
  }
});
$('btn-send').addEventListener('click', onSend);

function onSend() {
  const cur = currentConv();
  if (cur && state.gens.has(cur.id)) {
    // 当前对话正在生成 → 停止它（只停当前对话，其它对话的生成不受影响 —— 多对话并行的关键）。
    cancelGen(cur.id);
    return;
  }
  const text = inputBox.value.trim();
  if (!text && !state.attachments.length) return;
  if (!hasKey() && !isVideoMode()) { openSettings(); return; }
  if (isImageMode() && !text) return; // 生图必须有描述
  if (isVideoMode() && !text) return;
  if (isVideoMode()) sendVideoGen(text);
  else if (isImageMode()) sendImageGen(text);
  else sendChat(text);
}

// 发送按钮跟随「当前对话是否在生成」（多对话并行：切到哪个对话，按钮就反映哪个的状态）。
function syncComposer() {
  const cur = currentConv();
  const active = cur ? state.gens.get(cur.id) : null;
  const btn = $('btn-send');
  if (active) { btn.textContent = active.kind === 'video' ? '取消任务' : '停止'; btn.classList.add('stop'); }
  else { btn.classList.remove('stop'); btn.textContent = isVideoMode() ? '生成视频' : (isImageMode() ? '生成' : '发送'); }
}
// 生成中更新了某对话的消息数据后，刷新其 DOM —— 仅当正在看该对话时（否则只留数据，切回 renderMessages 会显示）。
function patchGen(conv, aMsg) {
  if (state.currentId !== conv.id) return;
  const el = document.querySelector(`[data-genid="${aMsg._genid}"]`);
  if (!el) { $('messages').appendChild(buildMsgEl(aMsg)); scrollToBottom(true); return; }  // 首次插入
  updateGenEl(el, aMsg);                                                                    // 之后增量
  scrollToBottom(false);
}
// 增量更新一条进行中/刚完成的助手消息 DOM：chat 只改正文；image 只「追加」新到的图并在收尾去转圈。
// 避免每次流式刷新重建整条，尤其避免组图把已解码的 4K 图反复重建（旧写法 O(n²)）。
function updateGenEl(el, m) {
  const body = el.querySelector('.msg-body');
  if (!body) return;
  if (m.kind === 'video') {
    const text = body.querySelector('.video-pending-text');
    if (text) text.textContent = m._meta || videoStatusLabel(m._status);
    if (!m._pending) body.querySelector('.video-pending')?.remove();
  } else if (m.kind !== 'image') {
    body.innerHTML = mdRender(m.text || '') + (m._pending ? '<span class="stream-caret"></span>' : '');
  } else {
    const pend = body.querySelector('.gen-pending');
    const urls = m.images || [];
    if (urls.length) {
      let box = body.querySelector('.msg-images');
      if (!box) { box = document.createElement('div'); box.className = 'msg-images'; body.insertBefore(box, pend); }
      for (let i = box.children.length; i < urls.length; i++) box.appendChild(buildImageItem(urls[i], i, true));
    }
    if (!m._pending) {                       // 完成：去转圈；有修订文案补在最前（只补一次）
      if (pend) pend.remove();
      if (m.text && !body.querySelector('.gen-revised')) {
        const p = document.createElement('div');
        p.className = 'gen-revised md';
        p.innerHTML = mdRender(m.text);
        body.insertBefore(p, body.firstChild);
      }
    }
  }
  if (m.createdAt) setMsgTime(el, m.createdAt);
}
// 起一个生成：建 AbortController、登记到该对话（供停止/切换/并发护栏用）、刷新按钮态。返回 ctrl。
function beginGen(conv, kind = 'chat') {
  const ctrl = new AbortController();
  state.gens.set(conv.id, { ctrl, kind });
  syncComposer();
  return ctrl;
}
// 收尾一个生成：注销登记；若正看着该对话则刷新按钮态。
function endGen(conv) {
  state.gens.delete(conv.id);
  if (state.currentId === conv.id) syncComposer();
}
// 停止某对话的生成：本地 abort + 通知后端取消（否则后端后台任务不会 done、下一条被 409 挡）。
function cancelGen(convId) {
  state.gens.get(convId)?.ctrl.abort();
  if (useServer()) fetch(`/api/conversations/${encodeURIComponent(convId)}/stream`, { method: 'DELETE' }).catch(() => {});
}
// 从对话消息里移除某条（进行中占位消息收尾/出错时用）。
function dropMsg(conv, aMsg) {
  const i = conv.messages.indexOf(aMsg);
  if (i >= 0) conv.messages.splice(i, 1);
}
// 中止所有对话的进行中生成（登出/会话失效时用）。仅断本地观看，后台任务由后端自行收尾。
function abortAllGens() {
  for (const gen of state.gens.values()) { try { gen.ctrl.abort(); } catch { /* ignore */ } }
  state.gens.clear();
}

function pushUserMessage(conv, text) {
  // atts 归一化保存：图片留 dataUrl、文本文件留 text，供乐观渲染与 keyonly 本地持久化。
  const atts = state.attachments.map((a) => ({ ...a }));
  const msg = { role: 'user', text, atts, kind: 'chat', createdAt: Date.now() };
  conv.messages.push(msg);
  if (conv.title === '新对话' && text) conv.title = text.slice(0, 24);
  state.attachments = [];
  renderAttachments();
  inputBox.value = '';
  inputBox.style.height = 'auto';
  if (conv.messages.length === 1) $('messages').innerHTML = '';
  $('messages').appendChild(buildMsgEl(msg));
  $('header-title').textContent = conv.title;
  scrollToBottom(true);
  return msg;
}

function pushErrorMessage(conv, text) {
  const msg = { role: 'assistant', kind: 'error', text };
  conv.messages.push(msg);
  if (state.currentId === conv.id) { $('messages').appendChild(buildMsgEl(msg)); scrollToBottom(true); }
  persistConv(conv);
}

/* —— 聊天（含识图） —— */
// keyonly 用：前端拼上下文（无后端落库）。系统提示由后端注入，这里只传历史。
// 图片走 image_url（dataUrl）；文本文件内联进 text part（与后端 buildUpstreamMessages 注入格式一致）。
function buildApiMessages(conv) {
  const out = [];
  for (const m of conv.messages) {
    if (m.kind === 'error') continue;
    if (m.role === 'user') {
      // 兼容旧 IndexedDB 数据：老消息用 m.images:[dataUrl]，新消息用 m.atts。
      const atts = m.atts || (m.images || []).map((u) => ({ kind: 'image', dataUrl: u }));
      const imgs = atts.filter((a) => a.kind === 'image');
      const files = atts.filter((a) => a.kind === 'file');
      if (imgs.length || files.length) {
        const parts = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        for (const f of files) parts.push({ type: 'text', text: `\n[附件文件: ${f.name || '未命名'}]\n\`\`\`\n${f.text || ''}\n\`\`\`\n` });
        for (const a of imgs) parts.push({ type: 'image_url', image_url: { url: a.dataUrl || a.url } });
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.text || '' });
      }
    } else {
      if (m.text) out.push({ role: 'assistant', content: m.text });
    }
  }
  return out;
}

// 读一条聊天 SSE 流：对每个内容增量调 onDelta；遇 error 事件抛出。发送与重连共用。
async function pumpChatSse(res, onDelta) {
  let sawDone = false;
  const handleLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') { sawDone = true; return; }
    let j;
    try { j = JSON.parse(payload); } catch { return; }
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const delta = j.choices?.[0]?.delta;
    if (delta?.content) onDelta(delta.content);
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) handleLine(line);
    // 收到 [DONE] 立刻收尾：有些上游/代理发完 [DONE] 后迟迟不关连接，
    // 傻等 reader done 会一直卡住（按钮停在「停止」，下次发送被当成中止）
    if (sawDone) { reader.cancel().catch(() => {}); break; }
  }
  buf += decoder.decode();
  for (const line of buf.split('\n')) if (line.trim()) handleLine(line);
}

// 统一 sendChat/sendImageGen 的「生成生命周期」：占位消息 → 流式刷新 → 成功/手动停止/错误收尾。
// 三处（含 reconnectInflight）曾各写一遍，现收成一处。调用方先同步 beginGen(conv) 拿 ctrl（防并发），再传：
//   aMsg     进行中的占位消息（chat 累积 .text、image 累积 .images）
//   doRequest(signal) → Response
//   runReader(res, repaint) 把响应落到 aMsg，每有进展调 repaint()；返回时 aMsg 即最终数据
async function runGen(conv, aMsg, ctrl, doRequest, runReader) {
  conv.messages.push(aMsg);
  patchGen(conv, aMsg);                                // 首次渲染（不在当前对话则跳过；不存在则插入）
  try {
    const res = await doRequest(ctrl.signal);
    if (res.status === 409) throw new Error('上一条还在生成中，请稍候');
    if (!res.ok) throw new Error(formatApiError(res.status, await res.text()));
    await runReader(res, () => patchGen(conv, aMsg));
    aMsg._pending = false;
    aMsg.createdAt = Date.now();
    patchGen(conv, aMsg);
    // 登录态生图完成：流式用的是 base64 dataURL（组图多张 4K 会撑爆浏览器解码内存导致破图，且
    // dataURL 懒加载不生效）。从 DB 重拉规范状态 → 换成 blob 链接（懒加载生效、只解码可见的、已去重）。
    if ((aMsg.kind === 'image' || aMsg.kind === 'video') && useServer()) {
      conv.messages = null;
      await ensureMessages(conv);
      if (state.currentId === conv.id) renderMessages();
    }
  } catch (err) {
    dropMsg(conv, aMsg);
    const kept = aMsg.kind === 'image' ? aMsg.images.length : (aMsg.kind === 'video' ? false : aMsg.text);
    if (err.name === 'AbortError') {
      if (kept) {                                       // 手动停止：保留已生成部分
        aMsg._pending = false;
        if (aMsg.kind !== 'image') aMsg.text += '\n\n*（已手动停止）*';
        aMsg.createdAt = Date.now();
        conv.messages.push(aMsg);
      }
    } else {
      pushErrorMessage(conv, err.message);
    }
    if (state.currentId === conv.id) renderMessages();
  } finally {
    endGen(conv);
    await persistConv(conv);
  }
}

async function sendChat(text) {
  const conv = currentConv() || newConv();
  if (state.gens.has(conv.id)) return;              // 该对话已在生成（前端侧并发护栏）
  const model = currentModel();
  const atts = state.attachments.slice();           // 发送前取（pushUserMessage 会清空 attachments）
  const ctrl = beginGen(conv, 'chat');              // 同步占位：防并发双击 + 让按钮/切换立即反映

  await ensureMessages(conv);
  pushUserMessage(conv, text);                      // 发送时一定在当前对话 → 直接乐观渲染 user 气泡
  await persistConv(conv);

  const aMsg = { role: 'assistant', text: '', kind: 'chat', model, _genid: newGenId(), _pending: true };
  const doRequest = (signal) => useServer()
    ? Promise.all(atts.map(async (a) => ({           // 登录态：附件先传 /api/blobs 拿 hash，后端落库+组装上下文
        hash: a.kind === 'file' ? await uploadText(a.text, a.mime) : await uploadDataUrl(a.dataUrl),
        name: a.name || '',
      }))).then((attachments) => fetch(`/api/conversations/${encodeURIComponent(conv.id)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, text, attachments }), signal,
      }))
    : fetch(`/api/conversations/${encodeURIComponent(conv.id)}/messages`, {   // keyonly：前端拼上下文
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: buildApiMessages(conv) }), signal,
      });
  const runReader = async (res, repaint) => {
    let last = 0;
    await pumpChatSse(res, (d) => {
      aMsg.text += d;
      const now = Date.now(); if (now - last > 90) { last = now; repaint(); }
    });
    if (!aMsg.text) aMsg.text = '（空响应）';
  };
  await runGen(conv, aMsg, ctrl, doRequest, runReader);
}

/* —— 生图 —— */

/** 宽容地解析流式生图 SSE：兼容官方 image_generation.partial_image / image_edit.* 事件，
 *  也接住各种代理自创的 {b64_json} / {data:[{b64_json|url}]} 形态。 */
async function readImageSse(res, onUpdate) {
  const finalImages = [];   // 最终图（dataURL 或 http url）；组图会有多张
  let lastPartialB64 = null;
  let revised = '';
  let mime = 'image/png';

  const emit = () => { if (onUpdate) onUpdate(finalImages.slice(), revised); };
  const pushImg = (b64, url) => {
    if (b64) finalImages.push(`data:${mime};base64,${b64}`);
    else if (url) finalImages.push(url);
    else return;
    emit();   // 逐张到达即回调（调用方据此更新数据 + 逐张显示）
  };

  const handleEvent = (j) => {
    if (!j || typeof j !== 'object') return;
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    if (j.output_format) mime = `image/${j.output_format}`;
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
    // 渐进预览（partial_image，非 succeeded；后端已过滤，一般收不到）：只留兜底、不算最终
    if (type.includes('partial') && !type.includes('succeeded')) { if (b64) lastPartialB64 = b64; return; }
    pushImg(b64, url);   // partial_succeeded（火山组图一张）/ completed（gpt-image）/ 裸最终
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const handleLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let j;
    try { j = JSON.parse(payload); } catch { return; }
    handleEvent(j);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) handleLine(line);
  }
  buf += decoder.decode();
  for (const line of buf.split('\n')) if (line.trim()) handleLine(line);

  const images = finalImages.length ? finalImages : (lastPartialB64 ? [`data:${mime};base64,${lastPartialB64}`] : []);
  if (!images.length) throw new Error('流式响应结束但没有收到图片数据');
  return { images, revised };
}

async function sendImageGen(prompt) {
  if (!prompt) return;
  const conv = currentConv() || newConv();
  if (state.gens.has(conv.id)) return;    // 该对话已在生成（ensureMessages 移到下方 gens 占位之后）
  const model = currentModel();
  const caps = DOUBAO_CAPS[model];
  let size = $('size-select').value;
  let sizeLabel = size;
  // 豆包：分辨率档 + 宽高比 → 精确像素（方式2）；查不到则退回只发档（方式1，比例靠 prompt）。
  if (caps) {
    const ratio = $('ratio-select').value || '1:1';
    sizeLabel = `${size} · ${ratio}`;
    const px = (DOUBAO_PIXELS[size] || {})[ratio];
    if (px) size = px;
  }
  const quality = $('quality-select').value;
  // 输出格式：仅豆包 5.0 lite 有该控件（png/jpeg）；其余模型不传（后端按模型兜底）。
  const outputFormat = caps && caps.formats.length > 1 ? $('output-format-select').value : undefined;
  // 豆包扩展参数：生成数量（组图）、联网搜索（仅 5.0lite）、fast 提词（仅 4.0）。
  let count = 1, webSearch = false, promptMode = 'standard';
  if (caps) {
    count = Math.max(1, Math.min(DOUBAO_MAX_IMAGES, Number($('count-select').value) || 1));
    webSearch = caps.webSearch && $('websearch-select').value === 'on';
    promptMode = (caps.fast && $('promptmode-select').value === 'fast') ? 'fast' : 'standard';
    if (count > 1) sizeLabel += ` · ×${count}`;
  }
  const ctrl = beginGen(conv, 'image');             // 同步占位：防并发双击 + 让按钮/切换立即反映

  await ensureMessages(conv);
  const userMsg = pushUserMessage(conv, prompt);
  // 生图取图片附件作参考图（文本文件忽略）：gpt 走 /edits 改图；豆包走图生图/多图融合/图生组图。
  const refImages = (userMsg.atts || []).filter((a) => a.kind === 'image').map((a) => a.dataUrl);
  if (!caps && refImages.length && !NATIVE_SIZES.has(size)) size = '1024x1024';   // 仅 gpt /edits 尺寸限制
  await persistConv(conv);

  const t0 = Date.now();
  const aMsg = {
    role: 'assistant', kind: 'image', model, text: '', images: [],
    _genid: newGenId(), _pending: true,
    _meta: (!caps && refImages.length) ? `${size} · 按图改图` : sizeLabel,
  };
  const doRequest = async (signal) => {
    // 登录态：参考图先传 /api/blobs 拿 hash（refs:[hash]）；keyonly：直接发 dataURL
    const refs = useServer() && refImages.length ? await Promise.all(refImages.map(uploadDataUrl)) : refImages;
    return fetch(`/api/conversations/${encodeURIComponent(conv.id)}/images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, output_format: outputFormat, refs, count, web_search: webSearch, prompt_mode: promptMode }),
      signal,
    });
  };
  const runReader = async (res, repaint) => {
    let revised = '';
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('event-stream')) {
      const got = await readImageSse(res, (imgs, rev) => { aMsg.images = imgs; if (rev) revised = rev; repaint(); });
      aMsg.images = got.images; revised = got.revised || revised;
    } else {
      const bodyText = await res.text();
      let json;
      try { json = JSON.parse(bodyText); }
      catch {
        throw new Error(
          `响应 JSON 解析失败（共 ${bodyText.length} 字符，疑似被截断）\n` +
          `头部：${bodyText.slice(0, 160)}\n…\n尾部：${bodyText.slice(-160)}`
        );
      }
      const items = json.data || [];
      aMsg.images = items.map((d) => d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url).filter(Boolean);
      revised = items[0]?.revised_prompt || '';
      if (!aMsg.images.length) throw new Error(`响应里没有图片：${bodyText.slice(0, 300)}`);
    }
    aMsg.text = revised ? `*${revised}*` : '';
    aMsg.meta = `${sizeLabel} · ${Math.round((Date.now() - t0) / 1000)}s`;
  };
  await runGen(conv, aMsg, ctrl, doRequest, runReader);
}

/* —— 视频生成（Seedance 2.0）—— */
function videoStatusLabel(status) {
  return ({
    submitting: '正在提交方舟任务', queued: '排队中', running: '正在生成镜头',
    finalizing: '成片生成完毕，正在安全保存', succeeded: '成片已保存',
    cancelled: '任务已取消', failed: '生成失败',
  })[status] || '后台生成中';
}

async function readVideoSse(res, onStatus) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', sawDone = false;
  const handleLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') { sawDone = true; return; }
    if (!payload) return;
    let event;
    try { event = JSON.parse(payload); } catch { return; }
    if (event.error) throw new Error(event.error.message || '视频生成失败');
    if (event.type === 'video.status') onStatus?.(event);
  };
  while (!sawDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) handleLine(line);
  }
  buf += decoder.decode();
  for (const line of buf.split('\n')) if (line.trim()) handleLine(line);
  if (!sawDone) throw new Error('视频进度连接中断；任务仍会在后台继续，可刷新本对话接回');
  reader.cancel().catch(() => {});
}

async function sendVideoGen(prompt) {
  if (!prompt || !useServer()) return;
  const conv = currentConv() || newConv();
  if (state.gens.has(conv.id)) return;
  const resolution = $('video-resolution').value;
  const ratio = $('video-ratio').value;
  const duration = Number($('video-duration').value);
  const ctrl = beginGen(conv, 'video');

  await ensureMessages(conv);
  const userMsg = pushUserMessage(conv, prompt);
  const refImages = (userMsg.atts || []).filter((a) => a.kind === 'image').map((a) => a.dataUrl);
  await persistConv(conv);

  const aMsg = {
    role: 'assistant', kind: 'video', model: VIDEO_MODEL, text: '',
    _genid: newGenId(), _pending: true, _status: 'submitting',
    _meta: `${resolution} · ${duration}s · ${ratio} · 准备提交`,
  };
  const clientRequestId = crypto.randomUUID
    ? crypto.randomUUID()
    : `vreq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const doRequest = async (signal) => {
    const refs = refImages.length ? await Promise.all(refImages.map(uploadDataUrl)) : [];
    return fetch(`/api/conversations/${encodeURIComponent(conv.id)}/videos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        model: VIDEO_MODEL, prompt, resolution, ratio, duration, refs,
        client_request_id: clientRequestId,
      }),
    });
  };
  const runReader = (res, repaint) => readVideoSse(res, (event) => {
    aMsg._status = event.status;
    aMsg._meta = event.message || videoStatusLabel(event.status);
    repaint();
  });
  await runGen(conv, aMsg, ctrl, doRequest, runReader);
}

function formatApiError(status, bodyText) {
  let msg = bodyText;
  try {
    const j = JSON.parse(bodyText);
    msg = j.error?.message || j.message || bodyText;
  } catch {
    if (/<!DOCTYPE|<html/i.test(bodyText)) {
      const title = (bodyText.match(/<title>([^<]*)<\/title>/i) || [])[1];
      msg = title ? `（HTML 错误页）${title.trim()}` : '（HTML 错误页，内容略）';
    }
  }
  const hint =
    status === 401 ? '（未登录或 Key 无效）'
    : status === 403 ? '（无权限 / 被风控拦截）'
    : status === 404 ? '（端点不存在：这把 key 所在分组的平台可能不是 openai）'
    : status === 429 ? '（限流，稍后再试）'
    : status === 524 ? '（Cloudflare 100 秒超时：图还在源站生成，但 CF 先掐了连接——试试降低质量档位）'
    : '';
  return `HTTP ${status} ${hint}\n${String(msg).slice(0, 600)}`;
}

/* ───────────────────────── 启动 ───────────────────────── */

(async function init() {
  document.querySelectorAll('#login-upstream-host, #settings-upstream').forEach((el) => {
    el.textContent = UPSTREAM;
  });

  await loadSession();

  if (state.me) {
    await loadConversations();
    showApp();
    maybeMigrateLocal();
  } else {
    showLogin();
  }
})();
