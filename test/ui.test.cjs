const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const jwt = require('jsonwebtoken');

const { createUi } = require('../lib/ui.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-ui-'));
const bundlePath = path.join(dir, 'admin.js');
const BUNDLE = 'console.log("admin");\n';
const clientPath = path.join(dir, 'line.js');
const CLIENT = 'export const init = () => {};\n';

fs.writeFileSync(bundlePath, BUNDLE);
fs.writeFileSync(clientPath, CLIENT);

function serve(options = {}) {
  const calls = [];
  const ui = createUi({ bundlePath, clientPath, env: {}, ...options });
  const server = http.createServer(async (req, res) => {
    if (await ui(req, res)) return;
    calls.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ waline: true, url: req.url }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port }));
  });
}

function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const hashOf = (body) => body.match(/admin\.js\?v=([0-9a-f]+)/u)?.[1];

const globalOf = (body, key) => {
  const line = body.split('\n').find((l) => l.trim().startsWith(`window.${key} =`));
  return line && new Function(`return ${line.split(' = ').slice(1).join(' = ').replace(/;\s*$/u, '')}`)();
};

const globalNames = (body) => [...body.matchAll(/^\s*window\.(\w+) = /gmu)].map((m) => m[1]);

const KEY = 'test-jwt-key';
const tokenFor = (id) => jwt.sign(String(id), KEY);

describe('ui router', () => {
  let ctx;

  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.server.close());

  const shellRoutes = ['/', '/login', '/forgot', '/profile', '/migration', '/thread'];

  for (const route of shellRoutes) {
    for (const p of new Set([route, `${route}/`.replace('//', '/'), `${route}?token=abc&x=1`])) {
      test(`GET ${p} serves the shell`, async () => {
        const res = await request(ctx.port, { path: p, headers: { host: 'line.stevehoang.com' } });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
        assert.equal(res.headers['cache-control'], 'no-cache');
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
        assert.equal(res.headers['x-frame-options'], 'DENY');
        assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.match(res.body, /^<!doctype html>/u);
        assert.match(res.body, /<html lang="en">/u);
        assert.match(res.body, /<meta charset="utf-8">/u);
        assert.match(res.body, /name="viewport"/u);
        assert.match(res.body, /<meta name="robots" content="noindex, nofollow">/u);
        assert.match(res.body, /name="theme-color"/u);
        assert.match(res.body, /<link rel="icon" href="https:\/\/stevehoang\.com\/favicon\.ico">/u);
        assert.match(res.body, /<title>Comments · Steve Hoang<\/title>/u);
        assert.match(res.body, /<script type="module" src="\/admin\.js\?v=[0-9a-f]{12}"><\/script>/u);
        assert.equal(globalOf(res.body, 'SITE_URL'), 'https://stevehoang.com');
        assert.equal(globalOf(res.body, 'SITE_NAME'), 'Steve Hoang');
        assert.equal(globalOf(res.body, 'recaptchaV3Key'), undefined);
        assert.equal(globalOf(res.body, 'turnstileKey'), undefined);
        assert.equal(globalOf(res.body, 'serverURL'), 'https://line.stevehoang.com/api/');
        assert.equal(globalOf(res.body, 'AVATAR_PROXY'), undefined);
        assert.deepEqual(globalNames(res.body), ['SITE_URL', 'SITE_NAME', 'recaptchaV3Key', 'turnstileKey', 'serverURL', 'AVATAR_PROXY']);
      });
    }
  }

  test('GET /thread with an encoded post path and focus serves the shell', async () => {
    const paths = [
      `/thread?path=${encodeURIComponent('/posts/xin-chào/')}&focus=42`,
      `/thread/?path=${encodeURIComponent('https://evil.com/phish')}`,
      '/thread?path=%2Fposts%2F%3Cscript%3E%2F',
    ];
    for (const p of paths) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 200, p);
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(ctx.calls.length, before, p);
      assert.doesNotMatch(res.body, /<script>|evil\.com/u);
    }
  });

  test('HEAD /thread returns headers and no body', async () => {
    const res = await request(ctx.port, { method: 'HEAD', path: '/thread?path=%2Fx%2F' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
  });

  test("/user is no longer a page: Waline's un-prefixed user list is refused", async () => {
    for (const p of ['/user', '/user/', '/user?page=2']) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 404, p);
      assert.deepEqual(JSON.parse(res.body), { errno: 404, errmsg: 'The user list is disabled.' });
      assert.equal(ctx.calls.length, before, p);
    }
  });

  test('nested and look-alike thread paths pass through', async () => {
    for (const p of ['/thread/x', '/threads', '/THREAD', '/thread.json']) {
      const res = await request(ctx.port, { path: p });
      assert.equal(JSON.parse(res.body).url, p);
    }
  });

  test('POST /thread passes through to Waline', async () => {
    const res = await request(ctx.port, { method: 'POST', path: '/thread?path=%2Fx' });
    assert.deepEqual(JSON.parse(res.body), { waline: true, url: '/thread?path=%2Fx' });
  });

  test('HEAD / returns headers and no body', async () => {
    const res = await request(ctx.port, { method: 'HEAD', path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(Number(res.headers['content-length']) > 0);
    assert.equal(res.body, '');
  });

  test('unknown pages and nested UI paths pass through', async () => {
    for (const p of ['/loginx', '/login/extra', '/favicon.ico', '/LOGIN']) {
      const res = await request(ctx.port, { path: p });
      assert.equal(JSON.parse(res.body).url, p);
    }
  });

  test("Waline's demo page (its index controller, and rest) is never reached", async () => {
    const cases = [
      ['POST', '/'],
      ['PUT', '/'],
      ['OPTIONS', '/'],
      ['POST', '/?x=1'],
      ['GET', '/api'],
      ['GET', '/api/'],
      ['GET', '/api?path=%2Fx'],
      ['HEAD', '/api'],
      ['POST', '/api'],
      ['GET', '/index'],
      ['GET', '/index.html'],
      ['GET', '/api/index'],
      ['GET', '/api/index/index'],
      ['GET', '/API/INDEX'],
      ['GET', '/api/rest'],
      ['GET', '//api/user'],
      ['GET', '/.netlify/functions/undefined'],
    ];
    for (const [method, p] of cases) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { method, path: p });
      assert.equal(res.status, 404, `${method} ${p}`);
      assert.equal(ctx.calls.length, before, `${method} ${p}`);
    }
  });

  test('GET / is still the admin, and the passkey API is left to its handler however it is spelled', async () => {
    const shell = await request(ctx.port, { path: '/' });
    assert.match(shell.body, /^<!doctype html>/u);
    for (const p of ['/api/passkey', '//api/passkey/login', '/api//passkey/login/options']) {
      const res = await request(ctx.port, { method: 'POST', path: p });
      assert.equal(JSON.parse(res.body).url, p, p);
    }
  });

  test('a request target that is not origin-form is refused before anything reads it', async () => {
    const cases = [
      ['POST', 'http://localhost/api/user/%2e%2e'],
      ['POST', 'http://localhost/api/token/%2e%2e'],
      ['GET', 'http://localhost/api/article/%2e%2e'],
      ['GET', 'http://localhost/ui/%2e%2e'],
      ['GET', 'http://line.stevehoang.com/api/oauth'],
      ['POST', 'http://line.stevehoang.com/api/user'],
      ['GET', 'https://line.stevehoang.com/'],
      ['OPTIONS', '*'],
    ];
    for (const [method, p] of cases) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { method, path: p });
      assert.equal(res.status, 400, `${method} ${p}`);
      assert.equal(ctx.calls.length, before, `${method} ${p}`);
    }
  });

  test('a long last path segment Waline would test with its backtracking id pattern is refused at once', async () => {
    const evil = `${'a'.repeat(40)}!`;
    for (const [method, p] of [['GET', `/api/comment/${evil}`], ['GET', `/api/comment/${evil.replace('!', '%21')}`], ['PUT', `/api/user/${evil}`], ['DELETE', `/api/comment/${'ab,'.repeat(20)}!`], ['GET', `/${evil}`], ['GET', `/api/comment/${evil}.html`]]) {
      const before = ctx.calls.length;
      const started = process.hrtime.bigint();
      const res = await request(ctx.port, { method, path: p });
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.equal(res.status, 404, `${method} ${p}`);
      assert.ok(ms < 100, `${method} ${p} took ${ms}ms`);
      assert.equal(ctx.calls.length, before, `${method} ${p}`);
    }
    for (const p of [`/api/comment/${'a'.repeat(40)}`, `/api/comment/${'a1,'.repeat(20)}`, `/api/comment/${'a'.repeat(15)}!`, `/api/passkey/${'Ab-_'.repeat(10)}`]) {
      const res = await request(ctx.port, { method: 'DELETE', path: p });
      assert.equal(JSON.parse(res.body).url, p, p);
    }
  });

  test('GET /register redirects to /login and keeps the query', async () => {
    for (const [p, location] of [
      ['/register', '/login'],
      ['/register/', '/login'],
      ['/register?redirect=%2Fuser', '/login?redirect=%2Fuser'],
    ]) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.location, location, p);
      assert.equal(ctx.calls.length, before, p);
    }
  });

  test('POST /login passes through', async () => {
    const res = await request(ctx.port, { method: 'POST', path: '/login' });
    assert.equal(JSON.parse(res.body).url, '/login');
  });

  test('/api/* passes through untouched, any method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      const p = '/api/comment?path=%2Fposts%2Fx&lang=en';
      const res = await request(ctx.port, { method, path: p, headers: { origin: 'https://stevehoang.com' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.deepEqual(ctx.calls.at(-1), { method, url: p });
    }
  });

  test('/ui redirects', async () => {
    const cases = {
      '/ui': '/',
      '/ui/': '/',
      '/ui/login': '/login',
      '/ui/profile?token=x': '/profile?token=x',
      '/ui/thread?path=%2Fposts%2Fx%2F&focus=1': '/thread?path=%2Fposts%2Fx%2F&focus=1',
      '/ui/profile/?token=x&a=%20b': '/profile/?token=x&a=%20b',
      '/ui/login?redirect=%2Fui%2Fuser': '/login?redirect=%2Fui%2Fuser',
      '/ui//evil.com': '/evil.com',
      '/ui///evil.com/path': '/evil.com/path',
      '/ui/%2F%2Fevil.com': '/evil.com',
      '/ui/%5C%5Cevil.com': '/evil.com',
      '/ui/%09/evil.com': '/%09/evil.com',
      '/ui/user?page=2': '/user?page=2',
    };

    for (const [from, to] of Object.entries(cases)) {
      for (const method of ['GET', 'HEAD']) {
        const res = await request(ctx.port, { method, path: from });
        assert.equal(res.status, 301, `${method} ${from}`);
        assert.equal(res.headers.location, to, `${method} ${from}`);
        assert.ok(!res.headers.location.startsWith('//'), from);
        assert.equal(new URL(res.headers.location, 'https://line.stevehoang.com').host, 'line.stevehoang.com');
      }
    }
  });

  test("/uix and other paths Waline's dashboard answers are 404, never its unpkg admin page", async () => {
    for (const p of ['/uix', '/ui.html', '/uiabc', '/ui-admin/x']) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS']) {
        const before = ctx.calls.length;
        const res = await request(ctx.port, { method, path: p });
        assert.equal(res.status, 404, `${method} ${p}`);
        assert.equal(res.headers.location, undefined, `${method} ${p}`);
        assert.equal(ctx.calls.length, before, `${method} ${p}`);
      }
    }
  });

  test('every other method on /ui is refused with 405, never passed to Waline', async () => {
    for (const p of ['/ui', '/ui/', '/ui/login', '/ui/profile?token=x', '/ui//evil.com']) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const before = ctx.calls.length;
        const res = await request(ctx.port, { method, path: p });
        assert.equal(res.status, 405, `${method} ${p}`);
        assert.equal(res.headers.allow, 'GET, HEAD', `${method} ${p}`);
        assert.equal(res.headers.location, undefined, `${method} ${p}`);
        assert.equal(ctx.calls.length, before, `${method} ${p}`);
      }
    }
  });

  test('dot-dot paths are rejected', async () => {
    for (const p of ['/ui/../x', '/ui/%2E%2E/x', '/ui/..%2Fx', '/%2e%2e/admin.js', '/ui/..\\x', '/api/../x']) {
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });

  test('malformed encoding is rejected', async () => {
    const res = await request(ctx.port, { path: '/%E0%A4%A' });
    assert.equal(res.status, 404);
  });

  test('encoded UI paths are recognised', async () => {
    const res = await request(ctx.port, { path: '/%6Cogin' });
    assert.equal(res.status, 200);
    assert.match(res.body, /^<!doctype html>/u);
  });

  test('/admin.js serves the bundle with an immutable cache on a matching hash', async () => {
    const shell = await request(ctx.port, { path: '/' });
    const hash = hashOf(shell.body);
    const res = await request(ctx.port, { path: `/admin.js?v=${hash}` });
    assert.equal(res.status, 200);
    assert.equal(res.body, BUNDLE);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(res.headers.etag, `"${hash}"`);
  });

  test('/admin.js without a matching hash is cached briefly', async () => {
    for (const p of ['/admin.js', '/admin.js?v=stale']) {
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'public, max-age=300');
    }
  });

  test('/admin.js answers If-None-Match with 304', async () => {
    const { headers } = await request(ctx.port, { path: '/admin.js' });
    for (const tag of [headers.etag, `W/${headers.etag}`, `"other", ${headers.etag}`]) {
      const res = await request(ctx.port, { path: '/admin.js', headers: { 'if-none-match': tag } });
      assert.equal(res.status, 304, tag);
      assert.equal(res.body, '');
      assert.equal(res.headers.etag, headers.etag);
    }
    const miss = await request(ctx.port, { path: '/admin.js', headers: { 'if-none-match': '"nope"' } });
    assert.equal(miss.status, 200);
  });

  test('HEAD /admin.js has no body', async () => {
    const res = await request(ctx.port, { method: 'HEAD', path: '/admin.js' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-length'], String(Buffer.byteLength(BUNDLE)));
    assert.equal(res.body, '');
  });
});

describe('missing bundle', () => {
  test('/admin.js is 503 and the shell still renders', async () => {
    const ctx = await serve({ bundlePath: path.join(dir, 'missing.js') });
    try {
      const res = await request(ctx.port, { path: '/admin.js' });
      assert.equal(res.status, 503);
      assert.match(res.headers['content-type'], /^text\/plain/u);
      const shell = await request(ctx.port, { path: '/' });
      assert.equal(shell.status, 200);
      assert.match(shell.body, /src="\/admin\.js"/u);
    } finally {
      ctx.server.close();
    }
  });
});

describe('comments widget', () => {
  let ctx;

  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.server.close());

  const hash = crypto.createHash('sha256').update(CLIENT).digest('hex').slice(0, 12);

  test('/line.js serves the widget to any origin, cached for five minutes', async () => {
    const res = await request(ctx.port, { path: '/line.js', headers: { origin: 'https://stevehoang.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.body, CLIENT);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
    assert.equal(res.headers.etag, `"${hash}"`);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-length'], String(Buffer.byteLength(CLIENT)));
    assert.equal(res.headers['content-security-policy'], undefined);
    assert.equal(ctx.calls.length, 0);
  });

  test('/line.js is immutable on a matching hash and brief otherwise', async () => {
    const pinned = await request(ctx.port, { path: `/line.js?v=${hash}` });
    assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
    const stale = await request(ctx.port, { path: '/line.js?v=stale' });
    assert.equal(stale.headers['cache-control'], 'public, max-age=300');
    assert.equal(stale.body, CLIENT);
  });

  test('/line.js answers If-None-Match with 304, still open to any origin', async () => {
    for (const tag of [`"${hash}"`, `W/"${hash}"`, `"other", "${hash}"`, '*']) {
      const res = await request(ctx.port, { path: '/line.js', headers: { 'if-none-match': tag } });
      assert.equal(res.status, 304, tag);
      assert.equal(res.body, '');
      assert.equal(res.headers.etag, `"${hash}"`);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.headers['cache-control'], 'public, max-age=300');
    }
    const miss = await request(ctx.port, { path: '/line.js', headers: { 'if-none-match': '"nope"' } });
    assert.equal(miss.status, 200);
    assert.equal(miss.body, CLIENT);
  });

  test('HEAD /line.js has headers and no body', async () => {
    const res = await request(ctx.port, { method: 'HEAD', path: '/line.js' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-length'], String(Buffer.byteLength(CLIENT)));
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.body, '');
  });

  test('/admin.js stays same-origin: the widget header is not on it', async () => {
    const res = await request(ctx.port, { path: '/admin.js' });
    assert.equal(res.body, BUNDLE);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('other methods and look-alike paths are not the widget', async () => {
    for (const [method, p] of [['POST', '/line.js'], ['PUT', '/line.js'], ['GET', '/line.js/'], ['GET', '/LINE.js'], ['GET', '/line.json'], ['GET', '/api/line.js']]) {
      const before = ctx.calls.length;
      const res = await request(ctx.port, { method, path: p });
      assert.notEqual(res.body, CLIENT, `${method} ${p}`);
      assert.equal(ctx.calls.length, before + 1, `${method} ${p}`);
    }
    for (const p of ['/%2e%2e/line.js', '/ui/../line.js']) {
      const res = await request(ctx.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });

  test('an encoded spelling of /line.js is the widget', async () => {
    const res = await request(ctx.port, { path: '/%6Cine.js' });
    assert.equal(res.status, 200);
    assert.equal(res.body, CLIENT);
  });

  test('a missing widget is 503, and the admin is untouched', async () => {
    const missing = await serve({ clientPath: path.join(dir, 'missing-line.js') });
    try {
      const res = await request(missing.port, { path: '/line.js' });
      assert.equal(res.status, 503);
      assert.match(res.headers['content-type'], /^text\/plain/u);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.body, 'Comments bundle is not built.\n');
      const admin = await request(missing.port, { path: '/admin.js' });
      assert.equal(admin.status, 200);
      assert.equal(admin.body, BUNDLE);
      const shell = await request(missing.port, { path: '/' });
      assert.equal(shell.status, 200);
      assert.equal(missing.calls.length, 0);
    } finally {
      missing.server.close();
    }
  });
});

describe('oauth services', () => {
  test('the shell never fetches the OAuth service list', async () => {
    const original = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('no network');
    };
    const ctx = await serve({ env: { OAUTH_URL: 'https://oauth.example' } });
    try {
      const res = await request(ctx.port, { path: '/login' });
      assert.equal(res.status, 200);
      assert.equal(globalOf(res.body, 'oauthServices'), undefined);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = original;
      ctx.server.close();
    }
  });
});

describe('environment and origin', () => {
  test('hostile env values are escaped', async () => {
    const evil = '</script><script>alert(1)</script>&\u2028\u2029"\'';
    const ctx = await serve({
      env: { SITE_NAME: evil, SITE_URL: evil, RECAPTCHA_V3_KEY: evil, TURNSTILE_KEY: 'tk' },
    });
    try {
      const res = await request(ctx.port, { path: '/' });
      const scripts = res.body.match(/<script\b/gu);
      assert.equal(scripts.length, 2);
      assert.ok(!res.body.includes('<script>alert'));
      assert.ok(!res.body.includes('\u2028'));
      assert.ok(!res.body.includes('\u2029'));
      assert.match(res.body, /<title>Comments · &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/u);
      assert.equal(globalOf(res.body, 'SITE_NAME'), evil);
      assert.equal(globalOf(res.body, 'SITE_URL'), evil);
      assert.equal(globalOf(res.body, 'recaptchaV3Key'), evil);
      assert.equal(globalOf(res.body, 'turnstileKey'), 'tk');
    } finally {
      ctx.server.close();
    }
  });

  test('AVATAR_PROXY is passed to the admin unless it is off', async () => {
    const cases = [
      [' https://avatar.example/proxy ', 'https://avatar.example/proxy'],
      ['false', undefined],
      ['FALSE', undefined],
      ['0', undefined],
      ['', undefined],
    ];
    for (const [value, want] of cases) {
      const ctx = await serve({ env: { AVATAR_PROXY: value } });
      try {
        const res = await request(ctx.port, { path: '/' });
        assert.equal(globalOf(res.body, 'AVATAR_PROXY'), want, JSON.stringify(value));
      } finally {
        ctx.server.close();
      }
    }
  });

  test('AVATAR_PROXY is escaped; DEFAULT_AVATAR is no longer read', async () => {
    const evil = 'https://cdn.example/cat.webp?</script><script>alert(1)</script>';
    const ctx = await serve({ env: { DEFAULT_AVATAR: evil, AVATAR_PROXY: 'https://p.example/?a=<b>' } });
    try {
      const res = await request(ctx.port, { path: '/' });
      assert.equal(globalOf(res.body, 'DEFAULT_AVATAR'), undefined);
      assert.equal(globalOf(res.body, 'AVATAR_PROXY'), 'https://p.example/?a=<b>');
      assert.ok(!res.body.includes('<script>alert'));
      assert.ok(!res.body.includes('<b>'));
    } finally {
      ctx.server.close();
    }
  });

  test('serverURL follows forwarded headers', async () => {
    const ctx = await serve();
    try {
      const cases = [
        [{ host: 'line.stevehoang.com' }, 'https://line.stevehoang.com/api/'],
        [{ host: 'localhost:8360', 'x-forwarded-proto': 'http' }, 'http://localhost:8360/api/'],
        [{ host: 'internal', 'x-forwarded-host': 'line.stevehoang.com', 'x-forwarded-proto': 'https' }, 'https://line.stevehoang.com/api/'],
        [{ host: 'a', 'x-forwarded-host': 'b.example, c.example', 'x-forwarded-proto': 'http, https' }, 'http://b.example/api/'],
        [{ host: 'line.stevehoang.com', 'x-forwarded-proto': 'javascript' }, 'https://line.stevehoang.com/api/'],
        [{ host: 'line.stevehoang.com', 'x-forwarded-host': 'evil"</script>' }, 'https://line.stevehoang.com/api/'],
        [{ host: 'bad host/' }, 'https://localhost/api/'],
      ];
      for (const [headers, expected] of cases) {
        const res = await request(ctx.port, { path: '/', headers });
        assert.equal(globalOf(res.body, 'serverURL'), expected, JSON.stringify(headers));
      }
    } finally {
      ctx.server.close();
    }
  });
});

describe('site name', () => {
  test('a name that already says Comments is not prefixed again', async () => {
    for (const [name, title] of [
      ['Comments · Steve Hoang', 'Comments · Steve Hoang'],
      ['comments', 'comments'],
      ['Commentsville', 'Comments · Commentsville'],
    ]) {
      const ctx = await serve({ env: { SITE_NAME: name } });
      try {
        const res = await request(ctx.port, { path: '/' });
        assert.ok(res.body.includes(`<title>${title}</title>`), name);
        assert.equal(globalOf(res.body, 'SITE_NAME'), name);
      } finally {
        ctx.server.close();
      }
    }
  });
});

describe('settings no longer read', () => {
  test('SERVER_URL is ignored: the admin calls the API on its own origin', async () => {
    const ctx = await serve({ env: { SERVER_URL: 'https://comments.example/' } });
    try {
      const res = await request(ctx.port, { path: '/', headers: { host: 'line.stevehoang.com' } });
      assert.equal(globalOf(res.body, 'serverURL'), 'https://line.stevehoang.com/api/');
      assert.ok(!res.headers['content-security-policy'].includes('comments.example'));
    } finally {
      ctx.server.close();
    }
  });

  test('ALLOWED_ORIGINS and PASSKEYS no longer reach the shell', async () => {
    const ctx = await serve({ env: { ALLOWED_ORIGINS: 'https://a.example', PASSKEYS: '[{"id":"a","publicKey":"b","userId":"1"}]' } });
    try {
      const res = await request(ctx.port, { path: '/' });
      assert.equal(globalOf(res.body, 'ALLOWED_ORIGINS'), undefined);
      assert.equal(globalOf(res.body, 'PASSKEY_ENABLED'), undefined);
      assert.ok(!res.headers['content-security-policy'].includes('a.example'));
    } finally {
      ctx.server.close();
    }
  });
});

describe('content security policy', () => {
  const policyOf = (res) =>
    Object.fromEntries(
      res.headers['content-security-policy'].split(';').map((part) => {
        const [key, ...values] = part.trim().split(/\s+/u);
        return [key, values];
      }),
    );

  test('the shell carries a per-request nonce that matches its inline script', async () => {
    const ctx = await serve();
    try {
      const [a, b] = await Promise.all([request(ctx.port, { path: '/' }), request(ctx.port, { path: '/' })]);
      const nonces = [a, b].map((res) => {
        const nonce = res.body.match(/<script nonce="([^"]+)">/u)?.[1];
        assert.ok(nonce);
        assert.ok(policyOf(res)['script-src'].includes(`'nonce-${nonce}'`));
        return nonce;
      });
      assert.notEqual(nonces[0], nonces[1]);
      const policy = policyOf(a);
      assert.deepEqual(policy['default-src'], ["'self'"]);
      assert.deepEqual(policy['object-src'], ["'none'"]);
      assert.deepEqual(policy['base-uri'], ["'none'"]);
      assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
      assert.ok(!policy['script-src'].includes("'unsafe-inline'"));
      assert.ok(policy['connect-src'].includes("'self'"));
      assert.ok(!policy['connect-src'].includes('https://registry.npmjs.org'));
      assert.equal(a.headers['cross-origin-opener-policy'], 'same-origin');
    } finally {
      ctx.server.close();
    }
  });

  test('connect-src is this origin and the captcha hosts only', async () => {
    const ctx = await serve();
    try {
      const res = await request(ctx.port, { path: '/', headers: { host: 'line.stevehoang.com' } });
      assert.deepEqual(policyOf(res)['connect-src'], ["'self'", 'https://recaptcha.net', 'https://www.recaptcha.net', 'https://www.google.com', 'https://www.gstatic.com', 'https://challenges.cloudflare.com']);
    } finally {
      ctx.server.close();
    }
  });

  test('/admin.js and pass-through responses carry no CSP from the wrapper', async () => {
    const ctx = await serve();
    try {
      for (const p of ['/admin.js', '/line.js', '/api/comment']) {
        const res = await request(ctx.port, { path: p });
        assert.equal(res.headers['content-security-policy'], undefined, p);
      }
    } finally {
      ctx.server.close();
    }
  });
});

describe('oauth guard', () => {
  let ctx;

  before(async () => {
    ctx = await serve({ env: { SITE_URL: 'https://stevehoang.com', _HANDLER: 'index.handler' } });
  });
  after(() => ctx.server.close());

  const host = { host: 'line.stevehoang.com' };

  test('every OAuth route is refused before Waline sees it, whatever the type or redirect', async () => {
    const paths = [
      '/api/oauth',
      '/api/oauth/',
      '/oauth',
      '/oauth/',
      '/api/oauth.html',
      '/api/oauth/index',
      '/api/oauth/github',
      '/API/OAUTH',
      '//api//oauth',
      '/api//oauth',
      '/apioauth',
      '/api/%6fauth',
      '/.netlify/functions/index/oauth',
    ];
    const queries = [
      '',
      '?type=github',
      '?type=qq',
      '?type=weibo&redirect=%2Fprofile',
      `?type=github&redirect=${encodeURIComponent('https://stevehoang.com/posts/x')}`,
      '?code=1&state=x&type=github',
      `?type=github&redirect=${encodeURIComponent('https://evil.com')}`,
    ];

    for (const p of paths) {
      for (const q of queries) {
        for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
          const before = ctx.calls.length;
          const res = await request(ctx.port, { method, path: `${p}${q}`, headers: host });
          assert.equal(res.status, 404, `${method} ${p}${q}`);
          assert.equal(ctx.calls.length, before, `${method} ${p}${q}`);
          if (method === 'GET') assert.equal(JSON.parse(res.body).errno, 404);
        }
      }
    }
  });

  test('look-alike paths still pass through', async () => {
    for (const p of ['/oauthx?type=github', '/api/oauthx', '/api/token?redirect=https%3A%2F%2Fevil.com', '/api/comment/oauth']) {
      const res = await request(ctx.port, { path: p, headers: host });
      assert.equal(res.status, 200, p);
      assert.deepEqual(ctx.calls.at(-1), { method: 'GET', url: p });
    }
  });
});

describe('registration guard', () => {
  const host = { host: 'line.stevehoang.com', 'content-type': 'application/json' };
  const body = JSON.stringify({ email: 'x@example.com', password: 'p', display_name: 'X' });
  const registerPaths = [
    '/api/user',
    '/api/user/',
    '/api/user?lang=en',
    '/api/user.html',
    '/api/user/123',
    '/api/USER',
    '/api//user',
    '//api/user',
    '/apiuser',
    '/user',
    '/user/',
    '/api/user?method=put',
    '/api/user?method=get',
    '/api/user/Password',
    '/api/user/PASSWORD/x',
    '/.netlify/functions/index/user',
    '/.netlify/functions/index/api/user',
  ];

  test('POST /api/user (Waline sign-up) is refused by default', async () => {
    const ctx = await serve({ env: { _HANDLER: 'index.handler' } });
    try {
      for (const p of registerPaths) {
        const before = ctx.calls.length;
        const res = await request(ctx.port, { method: 'POST', path: p, headers: host, body });
        assert.equal(res.status, 403, p);
        assert.equal(ctx.calls.length, before, p);
        assert.deepEqual(JSON.parse(res.body), { errno: 403, errmsg: 'Registration is closed.' });
      }
    } finally {
      ctx.server.close();
    }
  });

  test('own profile updates, password reset and login still pass', async () => {
    const ctx = await serve();
    try {
      const allowed = [
        ['PUT', '/api/user'],
        ['PUT', '/api/user/'],
        ['PUT', '/api/user?lang=en'],
        ['PUT', '/api/user/password'],
        ['PUT', '/api/user/password?lang=en'],
        ['POST', '/api/user/password'],
        ['POST', '/api/token'],
        ['GET', '/api/token/2fa?email=a%40b.c'],
        ['POST', '/api/token/2fa'],
        ['POST', '/api/comment'],
        ['POST', '/api/users'],
        ['OPTIONS', '/api/user'],
      ];

      for (const [method, p] of allowed) {
        const res = await request(ctx.port, { method, path: p, headers: host, body: ['PUT', 'POST'].includes(method) ? body : undefined });
        assert.equal(res.status, 200, `${method} ${p}`);
        assert.deepEqual(ctx.calls.at(-1), { method, url: p });
      }
    } finally {
      ctx.server.close();
    }
  });

  test('ALLOW_REGISTER=true reopens sign-up', async () => {
    for (const value of ['true', 'TRUE', ' true ']) {
      const ctx = await serve({ env: { ALLOW_REGISTER: value } });
      try {
        const res = await request(ctx.port, { method: 'POST', path: '/api/user', headers: host, body });
        assert.equal(res.status, 200, value);
        assert.deepEqual(ctx.calls.at(-1), { method: 'POST', url: '/api/user' });
      } finally {
        ctx.server.close();
      }
    }

    for (const value of ['1', 'yes', 'false', '']) {
      const ctx = await serve({ env: { ALLOW_REGISTER: value } });
      try {
        const res = await request(ctx.port, { method: 'POST', path: '/api/user', headers: host, body });
        assert.equal(res.status, 403, JSON.stringify(value));
      } finally {
        ctx.server.close();
      }
    }
  });

  test('the flag is read per request', async () => {
    const env = {};
    const ctx = await serve({ env });
    try {
      assert.equal((await request(ctx.port, { method: 'POST', path: '/api/user', headers: host, body })).status, 403);
      env.ALLOW_REGISTER = 'true';
      assert.equal((await request(ctx.port, { method: 'POST', path: '/api/user', headers: host, body })).status, 200);
    } finally {
      ctx.server.close();
    }
  });
});

describe('user guard', () => {
  const OWN = '42';
  const json = { 'content-type': 'application/json' };
  const auth = (id = OWN) => ({ ...json, authorization: `Bearer ${tokenFor(id)}` });
  const body = JSON.stringify({ label: 'x', type: 'administrator' });
  let ctx;

  before(async () => {
    ctx = await serve({ jwtKey: () => KEY, env: { _HANDLER: 'index.handler' } });
  });
  after(() => ctx.server.close());

  const refused = async (method, p, headers, status, errmsg) => {
    const before = ctx.calls.length;
    const res = await request(ctx.port, { method, path: p, headers, body: ['PUT', 'POST'].includes(method) ? body : undefined });
    assert.equal(res.status, status, `${method} ${p}`);
    assert.deepEqual(JSON.parse(res.body || '{}'), method === 'HEAD' ? {} : { errno: status, errmsg }, `${method} ${p}`);
    assert.equal(ctx.calls.length, before, `${method} ${p}`);
  };

  test('the user list (every column, password hashes and 2FA secrets included) is refused, with or without a token', async () => {
    for (const p of ['/api/user', '/api/user/', '/api/user?page=1', '/api/user?email=a%40b.c', `/api/user/${OWN}`, '/api/user.html', '/api//user', '/user', '/api/user/Password', '/.netlify/functions/index/api/user']) {
      for (const headers of [json, auth()]) {
        await refused('GET', p, headers, 404, 'The user list is disabled.');
        await refused('HEAD', p, headers, 404);
      }
    }
  });

  test('banning or removing a user is refused, even with ALLOW_REGISTER on', async () => {
    for (const p of ['/api/user/123', `/api/user/${OWN}`, '/api/user', '/api/user?id=123', '/user/123', '/api/user/Password']) {
      await refused('DELETE', p, auth(), 403, 'Only your own account can be changed.');
    }
    const open = await serve({ jwtKey: KEY, env: { ALLOW_REGISTER: 'true' } });
    try {
      for (const [p, status] of [['/api/user/123?method=delete', 403], ['/api/user?method=get', 404], ['/api/user?method=put&id=123', 403]]) {
        const res = await request(open.port, { method: 'POST', path: p, headers: auth(), body });
        assert.equal(res.status, status, p);
        assert.equal(open.calls.length, 0, p);
      }
    } finally {
      open.server.close();
    }
  });

  test('editing another user is refused: an id in the path or ?id= that is not the signed-in user', async () => {
    for (const p of ['/api/user/123', '/api/user?id=123', '/api/user/123?id=123', '/api/user/abc,def', '/api/user/Password', '/api/user/%31%32%33', '/user/123', `/api/user/${OWN}?id=123`]) {
      await refused('PUT', p, auth(), 403, 'Only your own account can be changed.');
    }
    for (const headers of [json, { ...json, authorization: 'Bearer not-a-token' }, { ...json, authorization: `Bearer ${jwt.sign(OWN, 'other-key')}` }]) {
      await refused('PUT', `/api/user/${OWN}`, headers, 403, 'Only your own account can be changed.');
    }
  });

  test('the signed-in user may still name their own id, and the profile update and password reset pass', async () => {
    const cases = [
      ['/api/user', auth()],
      ['/api/user', json],
      [`/api/user/${OWN}`, auth()],
      [`/api/user?id=${OWN}`, auth()],
      [`/api/user/${OWN}?state=${tokenFor(OWN)}`, json],
      ['/api/user?id=', auth()],
      ['/api/user?id=1&id=2', auth()],
      ['/api/user/x.html', auth()],
      ['/api/user/123/', auth()],
      ['/api/user/password', json],
    ];
    for (const [p, headers] of cases) {
      const res = await request(ctx.port, { method: 'PUT', path: p, headers, body });
      assert.equal(res.status, 200, p);
      assert.deepEqual(ctx.calls.at(-1), { method: 'PUT', url: p });
    }
    const res = await request(ctx.port, { method: 'OPTIONS', path: '/api/user/123' });
    assert.equal(res.status, 200);
  });
});

describe('retired Waline routes', () => {
  const json = { 'content-type': 'application/json' };
  const bearer = { ...json, authorization: `Bearer ${tokenFor('7')}` };
  let ctx;

  before(async () => {
    ctx = await serve({ jwtKey: KEY, env: { _HANDLER: 'index.handler' } });
  });
  after(() => ctx.server.close());

  const expect = async (method, p, headers, status, errmsg) => {
    const before = ctx.calls.length;
    const res = await request(ctx.port, { method, path: p, headers, body: ['PUT', 'POST'].includes(method) ? '{}' : undefined });
    assert.equal(res.status, status, `${method} ${p}`);
    if (method !== 'HEAD') assert.deepEqual(JSON.parse(res.body), { errno: status, errmsg }, `${method} ${p}`);
    assert.equal(ctx.calls.length, before, `${method} ${p}`);
  };

  const passes = async (method, p, headers = json) => {
    const res = await request(ctx.port, { method, path: p, headers, body: ['PUT', 'POST'].includes(method) ? '{}' : undefined });
    assert.equal(res.status, 200, `${method} ${p}`);
    assert.deepEqual(ctx.calls.at(-1), { method, url: p });
  };

  test('page views and reactions (/api/article) are refused for every method, signed in or not', async () => {
    for (const p of ['/api/article', '/api/article?path=%2Fx', '/article', '/api/Article', '/api/article.html', '/api//article/', '/.netlify/functions/index/api/article']) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
        await expect(method, p, bearer, 404, 'Page views and reactions are disabled.');
      }
    }
  });

  test('the comment feed (/api/comment/rss) is 404', async () => {
    for (const p of ['/api/comment/rss', '/api/comment/rss?url=%2Fx', '/comment/rss', '/api/comment/RSS', '/api/comment/rss.html', '/api/comment/rss/']) {
      for (const method of ['GET', 'HEAD', 'POST']) await expect(method, p, json, 404, 'The comment feed is disabled.');
    }
  });

  test('comment counts and recent comments need a valid sign-in token; the widget calls still pass', async () => {
    const junk = [
      { ...json, authorization: 'junk' },
      { ...json, authorization: 'Bearer junk' },
      { ...json, authorization: `Bearer ${jwt.sign('7', 'another-key')}` },
      { ...json, authorization: `Bearer ${jwt.sign({ id: '7' }, KEY)}` },
    ];
    for (const p of ['/api/comment?type=count&url=%2Fx', '/api/comment?type=recent', '/api/comment?type=recent&count=50', '/comment?type=count', '/api/comment/?type=recent']) {
      await expect('GET', p, json, 401, 'Sign in first.');
      await expect('POST', `${p}&method=get`, json, 401, 'Sign in first.');
      for (const headers of junk) await expect('GET', p, headers, 401, 'Sign in first.');
      await passes('GET', p, bearer);
      await passes('GET', `${p}&state=${tokenFor('7')}`);
    }
    await expect('POST', '/api/comment?method=GET&type=count', json, 401, 'Sign in first.');
    for (const [method, p] of [['GET', '/api/comment?path=%2Fposts%2Fx%2F'], ['GET', '/api/comment?type=list&page=1'], ['POST', '/api/comment'], ['PUT', '/api/comment/12'], ['DELETE', '/api/comment/12']]) {
      await passes(method, p);
    }
  });

  test('e-mail verification of a new account is refused while sign-up is closed', async () => {
    for (const method of ['GET', 'POST']) {
      for (const p of ['/api/verification?token=1234&email=a%40b.c', '/verification?token=1', '/api/Verification']) {
        await expect(method, p, json, 403, 'Registration is closed.');
      }
    }
    const open = await serve({ env: { ALLOW_REGISTER: 'true' } });
    try {
      const res = await request(open.port, { path: '/api/verification?token=1234&email=a%40b.c' });
      assert.equal(res.status, 200);
      assert.equal(open.calls.length, 1);
    } finally {
      open.server.close();
    }
  });

  test('/api/db only exports: GET passes, every write (the old import) is refused', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) await passes(method, '/api/db?lang=en', bearer);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const p of ['/api/db?table=Comment', '/api/db?table=Users&objectId=1', '/db?table=Comment', '/api/DB', '/api/db?method=get']) {
        await expect(method, p, bearer, 403, 'Import is disabled: the database can only be exported.');
      }
    }
  });
});

describe('password sign-in limit', () => {
  function serveLogin(loginLimit) {
    const calls = [];
    const ui = createUi({ bundlePath, env: {}, loginLimit });
    const server = http.createServer(async (req, res) => {
      if (await ui(req, res)) return;

      let text = '';

      req.setEncoding('utf8');
      req.on('data', (c) => (text += c));
      req.on('end', () => {
        calls.push(req.url);
        const ok = JSON.parse(text || '{}').password === 'right';

        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(ok ? '{"errno":0,' : '{"errno":');
        res.end(ok ? '"data":{"token":"t"}}' : '1000}');
      });
    });

    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
  }

  const attempt = (port, password, ip = '203.0.113.1', p = '/api/token') =>
    request(port, { method: 'POST', path: p, headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ email: 'a@b.c', password }) });

  test('failed POST /api/token attempts are limited per IP, success clears them, the window ends', async () => {
    let t = 0;
    const ctx = await serveLogin({ limit: 3, window: 60000, now: () => t });
    try {
      for (let i = 0; i < 3; i += 1) assert.equal(JSON.parse((await attempt(ctx.port, 'wrong')).body).errno, 1000);

      const blocked = await attempt(ctx.port, 'right');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers['retry-after'], '60');
      assert.equal(JSON.parse(blocked.body).errno, 429);
      assert.equal(ctx.calls.length, 3);
      assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.1', '/api//token.html')).status, 429);
      assert.equal((await attempt(ctx.port, 'right', '203.0.113.2')).status, 200);

      t = 60000;
      assert.equal(JSON.parse((await attempt(ctx.port, 'wrong')).body).errno, 1000);
      assert.equal(JSON.parse((await attempt(ctx.port, 'wrong')).body).errno, 1000);
      assert.equal(JSON.parse((await attempt(ctx.port, 'right')).body).errno, 0);
      for (let i = 0; i < 2; i += 1) assert.equal((await attempt(ctx.port, 'wrong')).status, 200);
      assert.equal((await attempt(ctx.port, 'right')).status, 200);
    } finally {
      ctx.server.close();
    }
  });

  test('a token path Waline routes to sign-in is counted however it is spelled; ?method= is neither counted nor clears the count', async () => {
    const ctx = await serveLogin({ limit: 2, window: 60000 });
    try {
      assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.9', '/api/token/2FA')).status, 200);
      assert.equal((await attempt(ctx.port, 'right', '203.0.113.9', '/api/token?method=get')).status, 200);
      assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.9', '/api/token/Abc')).status, 200);
      assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.9')).status, 429);
      assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.9', '/api/token/2FA')).status, 429);
      assert.equal(ctx.calls.length, 3);
    } finally {
      ctx.server.close();
    }
  });

  test('2FA setup, the 2FA lookup and other POSTs are not counted', async () => {
    const ctx = await serveLogin({ limit: 1, window: 60000 });
    try {
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.1', '/api/token/2fa')).status, 200);
        assert.equal((await attempt(ctx.port, 'wrong', '203.0.113.1', '/api/comment')).status, 200);
      }
      assert.equal((await attempt(ctx.port, 'wrong')).status, 200);
      assert.equal((await attempt(ctx.port, 'wrong')).status, 429);
    } finally {
      ctx.server.close();
    }
  });
});

describe('passkeys', () => {
  test('the passkey API is left to the next handler', async () => {
    const ctx = await serve();
    try {
      for (const [method, p] of [['GET', '/api/passkey'], ['POST', '/api/passkey/login/options'], ['POST', '/api/passkey/login']]) {
        const before = ctx.calls.length;
        const res = await request(ctx.port, { method, path: p });
        assert.equal(res.status, 200);
        assert.equal(ctx.calls.length, before + 1, `${method} ${p}`);
      }
    } finally {
      ctx.server.close();
    }
  });
});
