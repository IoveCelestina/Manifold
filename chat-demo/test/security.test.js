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

let upstream;
let app;
let appBase;
let tempDir;
let appOutput = '';

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
});
