const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { after, before, describe, test } = require('node:test');

const PROJECT_DIR = path.resolve(__dirname, '..');
const VALID_KEY = 'sk-security-fixture-valid';
const BLOB_LIMIT = 1024;
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MP4_FIXTURE = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x10]), Buffer.from('ftyp'), Buffer.from('isom0000'),
]);

let upstream;
let app;
let appBase;
let tempDir;
let appOutput = '';
const balanceOps = [];
let videoCreatePayload = null;
let videoCreateCount = 0;

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length),
  });
  res.end(data);
}

async function consume(req) {
  for await (const _chunk of req) {
    // The fixture only needs to drain request bodies.
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function reservePort() {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  server.closeIdleConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForApp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`chat-demo exited during startup:\n${appOutput}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {
      // Startup races are expected while the child initializes SQLite.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`chat-demo did not become ready:\n${appOutput}`);
}

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'expected a session cookie');
  return setCookie.split(';', 1)[0];
}

async function keyLogin(key) {
  return fetch(`${appBase}/api/session/keylogin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

async function accountLogin() {
  const res = await fetch(`${appBase}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'security@example.test', password: 'fixture-password' }),
  });
  assert.equal(res.status, 200, await res.text());
  return cookieFrom(res);
}

async function upload(cookie, bytes, mime) {
  return fetch(`${appBase}/api/blobs`, {
    method: 'POST',
    headers: { cookie, 'content-type': mime },
    body: bytes,
  });
}

function blobFiles() {
  return fs.readdirSync(path.join(tempDir, 'blobs'));
}

async function attach(cookie, hash, name, convId) {
  const res = await fetch(`${appBase}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'security-fixture-model',
      text: 'fixture attachment',
      attachments: [{ hash, name }],
    }),
  });
  const body = await res.text();
  assert.equal(res.status, 200, body);
}

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.test');

    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      await consume(req);
      json(res, 200, {
        code: 0,
        data: { access_token: 'fixture-jwt', refresh_token: 'fixture-refresh' },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      json(res, 200, { code: 0, data: { id: 42, email: 'security@example.test' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/keys') {
      json(res, 200, {
        code: 0,
        data: [{ id: 7, key: VALID_KEY, name: 'fixture-key', group_id: 9, status: 'active' }],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/groups/available') {
      json(res, 200, { code: 0, data: [{ id: 9, platform: 'openai' }] });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      if (req.headers.authorization !== `Bearer ${VALID_KEY}`) {
        json(res, 401, { error: { message: 'invalid api key' } });
        return;
      }
      json(res, 200, { data: [{ id: 'security-fixture-model', object: 'model' }] });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await consume(req);
      if (req.headers.authorization !== `Bearer ${VALID_KEY}`) {
        json(res, 401, { error: { message: 'invalid api key' } });
        return;
      }
      const data = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.end(data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/admin/users/42') {
      json(res, 200, { code: 0, data: { balance: 100 } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/admin/users/42/balance') {
      balanceOps.push({ body: await readJson(req), idem: req.headers['idempotency-key'] });
      json(res, 200, { code: 0, data: { balance: 100 } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/contents/generations/tasks') {
      videoCreateCount++;
      videoCreatePayload = await readJson(req);
      json(res, 200, { id: 'fixture-video-task' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/contents/generations/tasks/fixture-video-task') {
      json(res, 200, {
        id: 'fixture-video-task', status: 'succeeded',
        content: { video_url: `http://${req.headers.host}/fixture-video.mp4` },
        usage: { completion_tokens: 250000 },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/fixture-video.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4_FIXTURE.length) });
      res.end(MP4_FIXTURE);
      return;
    }

    await consume(req);
    json(res, 404, { error: { message: 'fixture route not found' } });
  });

  const upstreamPort = await listen(upstream);
  const appPort = await reservePort();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifold-security-'));
  appBase = `http://127.0.0.1:${appPort}`;
  app = spawn(process.execPath, ['server.ts'], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      PORT: String(appPort),
      SUB2API_BASE: `http://127.0.0.1:${upstreamPort}`,
      ARK_BASE: `http://127.0.0.1:${upstreamPort}`,
      ARK_API_KEY: 'fixture-ark-key',
      SUB2API_ADMIN_KEY: 'fixture-admin-key',
      VIDEO_POLL_INTERVAL_MS: '20',
      SEEDANCE_BASE_TOKENS_480P_5S: '250000',
      SEEDANCE_PRICE_USD_PER_M_TOKENS: '46',
      DB_PATH: path.join(tempDir, 'manifold.test.db'),
      BLOB_DIR: path.join(tempDir, 'blobs'),
      BLOB_MAX_BYTES: String(BLOB_LIMIT),
      REQUEST_TIMEOUT_MS: '5000',
      COOKIE_SECURE: 'off',
      RATE_LIMIT: 'off',
      LEGACY_PROXY: 'off',
      LEGACY_STORE: 'off',
      NODE_OPTIONS: '--no-warnings',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (chunk) => { appOutput += chunk; });
  app.stderr.on('data', (chunk) => { appOutput += chunk; });
  await waitForApp(`${appBase}/`);
});

after(async () => {
  if (app && app.exitCode === null) app.kill('SIGTERM');
  await waitForExit(app);
  await closeServer(upstream);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('security boundaries', { concurrency: false }, () => {
  test('key login rejects an invalid API key without creating a session', async () => {
    const res = await keyLogin('sk-security-fixture-invalid');
    const body = await res.text();
    assert.equal(res.status, 401, body);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  test('key-only sessions cannot upload persistent blobs', async () => {
    const login = await keyLogin(VALID_KEY);
    const loginBody = await login.text();
    assert.equal(login.status, 200, loginBody);
    const res = await upload(cookieFrom(login), Buffer.from('key-only upload'), 'text/plain');
    const body = await res.text();
    assert.equal(res.status, 403, body);
    assert.deepEqual(blobFiles(), [], 'rejected key-only upload must not write a blob');
  });

  test('blob upload rejects a body over the configured limit with 413', async () => {
    const cookie = await accountLogin();
    const res = await upload(cookie, Buffer.alloc(BLOB_LIMIT + 1, 0x61), 'application/octet-stream');
    const body = await res.text();
    assert.equal(res.status, 413, body);
    assert.deepEqual(blobFiles(), [], 'oversized upload must remove any partial file');
  });

  test('HTML blobs are forced to download even when mislabeled as an image', async () => {
    const cookie = await accountLogin();
    const html = Buffer.from('<!doctype html><script>document.body.textContent="executed"</script>');
    const uploaded = await upload(cookie, html, 'image/png');
    const uploadBody = await uploaded.text();
    assert.equal(uploaded.status, 200, uploadBody);
    const { hash } = JSON.parse(uploadBody);
    await attach(cookie, hash, 'payload.html', 'c_security_html');

    const res = await fetch(`${appBase}/api/blobs/${hash}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition') || '', /^attachment(?:;|$)/i);
    assert.match(res.headers.get('cache-control') || '', /(?:^|,)\s*private\b/i);
    assert.match(res.headers.get('cache-control') || '', /(?:^|,)\s*no-store\b/i);
    assert.doesNotMatch(res.headers.get('cache-control') || '', /\bpublic\b/i);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), html);
  });

  test('safe image blobs retain their image type and bytes', async () => {
    const cookie = await accountLogin();
    const uploaded = await upload(cookie, PNG_1X1, 'image/png');
    const uploadBody = await uploaded.text();
    assert.equal(uploaded.status, 200, uploadBody);
    const { hash } = JSON.parse(uploadBody);
    await attach(cookie, hash, 'pixel.png', 'c_security_png');

    const res = await fetch(`${appBase}/api/blobs/${hash}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control') || '', /(?:^|,)\s*private\b/i);
    assert.match(res.headers.get('cache-control') || '', /(?:^|,)\s*no-store\b/i);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG_1X1);
  });

  test('key-only sessions cannot spend the shared Ark video key', async () => {
    const login = await keyLogin(VALID_KEY);
    assert.equal(login.status, 200, await login.text());
    const res = await fetch(`${appBase}/api/conversations/c_keyonly_video/videos`, {
      method: 'POST',
      headers: { cookie: cookieFrom(login), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'doubao-seedance-2-0-260128', prompt: 'fixture', resolution: '480p', ratio: '16:9', duration: 4,
        refs: [], client_request_id: 'fixture-keyonly-video-001',
      }),
    });
    assert.equal(res.status, 403, await res.text());
    assert.equal(videoCreateCount, 0);
  });

  test('Seedance tasks are idempotent, settled by actual tokens, and served as private ranged MP4', async () => {
    const cookie = await accountLogin();
    const convId = 'c_security_video';
    const body = {
      model: 'doubao-seedance-2-0-260128', prompt: '一束光穿过雨夜中的旧车站',
      resolution: '720p', ratio: '16:9', duration: 5, refs: [],
      client_request_id: 'fixture-video-request-001',
    };
    const create = await fetch(`${appBase}/api/conversations/${convId}/videos`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const events = await create.text();
    assert.equal(create.status, 200, events);
    assert.match(events, /"status":"succeeded"/);
    assert.match(events, /data: \[DONE\]/);
    assert.equal(videoCreateCount, 1);
    assert.equal(videoCreatePayload.model, body.model);
    assert.match(videoCreatePayload.content[0].text, /--resolution 720p/);

    const convRes = await fetch(`${appBase}/api/conversations/${convId}`, { headers: { cookie } });
    const convText = await convRes.text();
    assert.equal(convRes.status, 200, convText);
    const conv = JSON.parse(convText);
    const videoMessage = conv.messages.find((m) => m.kind === 'video');
    assert.ok(videoMessage, 'completed task must persist a video message');
    assert.equal(videoMessage.blobs.length, 1);
    assert.equal(videoMessage.blobs[0].mime, 'video/mp4');

    const blobUrl = `${appBase}/api/blobs/${videoMessage.blobs[0].hash}`;
    const ranged = await fetch(blobUrl, { headers: { cookie, range: 'bytes=4-11' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-type'), 'video/mp4');
    assert.equal(ranged.headers.get('accept-ranges'), 'bytes');
    assert.equal(ranged.headers.get('content-range'), `bytes 4-11/${MP4_FIXTURE.length}`);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), MP4_FIXTURE.subarray(4, 12));

    assert.equal(balanceOps.length, 2);
    assert.deepEqual(balanceOps.map((op) => op.body.operation), ['subtract', 'add']);
    assert.equal(balanceOps[0].body.balance, 25.875); // 720P 预授权：250k × 2.25 × 46/M
    assert.equal(balanceOps[1].body.balance, 14.375); // 实际 250k Tokens = 11.5，退差额
    assert.notEqual(balanceOps[0].idem, balanceOps[1].idem);

    const replay = await fetch(`${appBase}/api/conversations/${convId}/videos`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(replay.status, 200, await replay.text());
    assert.equal(videoCreateCount, 1, 'same client_request_id must not create another Ark task');
    assert.equal(balanceOps.length, 2, 'idempotent replay must not charge again');
  });
});
