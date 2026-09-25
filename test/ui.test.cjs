const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const { createUi } = require('../lib/ui.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-ui-'));
const bundlePath = path.join(dir, 'admin.js');
const BUNDLE = 'console.log("admin");\n';

fs.writeFileSync(bundlePath, BUNDLE);

const okFetch = async () => ({ json: async () => ({ services: [{ name: 'github' }] }) });

function serve(options = {}) {
  const calls = [];
  const ui = createUi({ bundlePath, env: {}, fetch: okFetch, ...options });
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

function request(port, { method = 'GET', path: p = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const hashOf = (body) => body.match(/admin\.js\?v=([0-9a-f]+)/u)?.[1];

const globalOf = (body, key) => {
  const line = body.split('\n').find((l) => l.trim().startsWith(`window.${key} =`));
  return line && new Function(`return ${line.split(' = ').slice(1).join(' = ').replace(/;\s*$/u, '')}`)();
};

describe('ui router', () => {
  let ctx;

  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.server.close());

  const shellRoutes = ['/', '/login', '/register', '/forgot', '/profile', '/user', '/migration'];

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
        assert.deepEqual(globalOf(res.body, 'ALLOWED_ORIGINS'), []);
        assert.equal(globalOf(res.body, 'recaptchaV3Key'), undefined);
        assert.equal(globalOf(res.body, 'turnstileKey'), undefined);
        assert.deepEqual(globalOf(res.body, 'oauthServices'), [{ name: 'github' }]);
        assert.equal(globalOf(res.body, 'serverURL'), 'https://line.stevehoang.com/api/');
      });
    }
  }

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

  test('POST / passes through to Waline', async () => {
    const before = ctx.calls.length;
    const res = await request(ctx.port, { method: 'POST', path: '/' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { waline: true, url: '/' });
    assert.deepEqual(ctx.calls[before], { method: 'POST', url: '/' });
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

  test('/uix is not a /ui redirect', async () => {
    const res = await request(ctx.port, { path: '/uix' });
    assert.equal(JSON.parse(res.body).url, '/uix');
  });

  test('POST /ui passes through', async () => {
    const res = await request(ctx.port, { method: 'POST', path: '/ui/login' });
    assert.equal(JSON.parse(res.body).url, '/ui/login');
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

describe('oauth services', () => {
  test('a failing fetch yields [] and the page still renders', async () => {
    const ctx = await serve({
      fetch: async () => {
        throw new Error('down');
      },
    });
    try {
      const res = await request(ctx.port, { path: '/login' });
      assert.equal(res.status, 200);
      assert.deepEqual(globalOf(res.body, 'oauthServices'), []);
    } finally {
      ctx.server.close();
    }
  });

  test('a bad payload yields []', async () => {
    const ctx = await serve({ fetch: async () => ({ json: async () => ({ nope: 1 }) }) });
    try {
      const res = await request(ctx.port, { path: '/' });
      assert.deepEqual(globalOf(res.body, 'oauthServices'), []);
    } finally {
      ctx.server.close();
    }
  });

  test('a hanging fetch times out', async () => {
    const hang = (_url, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const ctx = await serve({ fetch: hang, oauthTimeout: 100 });
    try {
      const started = Date.now();
      const res = await request(ctx.port, { path: '/' });
      assert.equal(res.status, 200);
      assert.ok(Date.now() - started < 1500);
      assert.deepEqual(globalOf(res.body, 'oauthServices'), []);
    } finally {
      ctx.server.close();
    }
  });

  test('services are cached and refetched after the ttl', async () => {
    let clock = 0;
    let count = 0;
    const urls = [];
    const ctx = await serve({
      env: { OAUTH_URL: 'https://oauth.example' },
      now: () => clock,
      fetch: async (url) => {
        count += 1;
        urls.push(url);
        return { json: async () => ({ services: [{ name: `n${count}` }] }) };
      },
    });
    try {
      await Promise.all([request(ctx.port, { path: '/' }), request(ctx.port, { path: '/' })]);
      await request(ctx.port, { path: '/' });
      assert.equal(count, 1);
      clock = 11 * 60 * 1000;
      const res = await request(ctx.port, { path: '/' });
      assert.equal(count, 2);
      assert.deepEqual(globalOf(res.body, 'oauthServices'), [{ name: 'n2' }]);
      assert.deepEqual(urls, ['https://oauth.example', 'https://oauth.example']);
    } finally {
      ctx.server.close();
    }
  });
});

describe('environment and origin', () => {
  test('hostile env values are escaped', async () => {
    const evil = '</script><script>alert(1)</script>&\u2028\u2029"\'';
    const ctx = await serve({
      env: { SITE_NAME: evil, SITE_URL: evil, RECAPTCHA_V3_KEY: evil, TURNSTILE_KEY: 'tk' },
      fetch: async () => ({ json: async () => ({ services: [{ name: evil }] }) }),
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
      assert.deepEqual(globalOf(res.body, 'oauthServices'), [{ name: evil }]);
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

describe('server url and allowed origins', () => {
  test('SERVER_URL wins over the request origin', async () => {
    for (const [value, expected] of [
      ['https://comments.example/', 'https://comments.example/api/'],
      ['https://comments.example//', 'https://comments.example/api/'],
      ['https://comments.example', 'https://comments.example/api/'],
      ['javascript:alert(1)', 'https://line.stevehoang.com/api/'],
      ['not a url', 'https://line.stevehoang.com/api/'],
    ]) {
      const ctx = await serve({ env: { SERVER_URL: value } });
      try {
        const res = await request(ctx.port, { path: '/', headers: { host: 'line.stevehoang.com', 'x-forwarded-host': 'evil.example' } });
        const expectedURL = value.startsWith('https://') ? expected : 'https://evil.example/api/';
        assert.equal(globalOf(res.body, 'serverURL'), expectedURL, value);
      } finally {
        ctx.server.close();
      }
    }
  });

  test('ALLOWED_ORIGINS keeps only bare http(s) origins', async () => {
    const ctx = await serve({
      env: { ALLOWED_ORIGINS: ' https://a.example , http://b.example:8080,https://c.example/path,javascript:x,https://d.example/,,ftp://e.example' },
    });
    try {
      const res = await request(ctx.port, { path: '/' });
      assert.deepEqual(globalOf(res.body, 'ALLOWED_ORIGINS'), ['https://a.example', 'http://b.example:8080']);
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
      assert.equal(a.headers['cross-origin-opener-policy'], undefined);
    } finally {
      ctx.server.close();
    }
  });

  test('connect-src names a SERVER_URL on another origin', async () => {
    const ctx = await serve({ env: { SERVER_URL: 'https://api.example' } });
    try {
      const res = await request(ctx.port, { path: '/', headers: { host: 'line.stevehoang.com' } });
      assert.ok(policyOf(res)['connect-src'].includes('https://api.example'));
    } finally {
      ctx.server.close();
    }
  });

  test('/admin.js and pass-through responses carry no CSP from the wrapper', async () => {
    const ctx = await serve();
    try {
      for (const p of ['/admin.js', '/api/comment']) {
        const res = await request(ctx.port, { path: p });
        assert.equal(res.headers['content-security-policy'], undefined, p);
      }
    } finally {
      ctx.server.close();
    }
  });
});

describe('oauth redirect guard', () => {
  let ctx;

  before(async () => {
    ctx = await serve({ env: { SITE_URL: 'https://stevehoang.com', ALLOWED_ORIGINS: 'https://friend.example' } });
  });
  after(() => ctx.server.close());

  const host = { host: 'line.stevehoang.com' };

  test('foreign or malformed redirects are refused before Waline sees them', async () => {
    const bad = [
      'https://evil.com',
      'https://evil.com/profile',
      '//evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      '/\t/evil.com',
      ' //evil.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://line.stevehoang.com/',
      'http://stevehoang.com.evil.com/',
      'https://stevehoang.com@evil.com/',
      'https://line.stevehoang.com:444/',
    ];
    const paths = ['/api/oauth', '/api/oauth/', '/oauth', '/oauth/', '/api/oauth.html', '/api/oauth/index', '/API/OAUTH', '//api//oauth'];

    for (const p of paths) {
      for (const value of bad) {
        for (const method of ['GET', 'HEAD', 'POST']) {
          const before = ctx.calls.length;
          const res = await request(ctx.port, {
            method,
            path: `${p}?type=github&redirect=${encodeURIComponent(value)}`,
            headers: host,
          });
          assert.equal(res.status, 400, `${method} ${p} ${value}`);
          assert.equal(ctx.calls.length, before, `${method} ${p} ${value}`);
        }
      }
    }

    const twice = await request(ctx.port, {
      path: `/api/oauth?redirect=${encodeURIComponent('/profile')}&redirect=${encodeURIComponent('https://evil.com')}`,
      headers: host,
    });
    assert.equal(twice.status, 400);
  });

  test('same-origin, blog and allowed redirects pass through', async () => {
    const good = [
      '/profile',
      '/login?redirect=%2Fuser',
      'https://line.stevehoang.com/login?redirect=https%3A%2F%2Fstevehoang.com%2Fposts%2Fx',
      'https://stevehoang.com/posts/x',
      'https://friend.example/page',
      '',
    ];

    for (const value of good) {
      const p = `/api/oauth?type=github&redirect=${encodeURIComponent(value)}`;
      const res = await request(ctx.port, { path: p, headers: host });
      assert.equal(res.status, 200, value);
      assert.deepEqual(ctx.calls.at(-1), { method: 'GET', url: p });
    }

    for (const p of ['/api/oauth?type=github', '/api/oauth?code=1&state=x', '/oauthx?redirect=https%3A%2F%2Fevil.com', '/api/token?redirect=https%3A%2F%2Fevil.com']) {
      const res = await request(ctx.port, { path: p, headers: host });
      assert.equal(res.status, 200, p);
      assert.deepEqual(ctx.calls.at(-1), { method: 'GET', url: p });
    }
  });

  test('the request origin follows forwarded headers', async () => {
    const res = await request(ctx.port, {
      path: `/api/oauth?redirect=${encodeURIComponent('http://localhost:8360/profile')}`,
      headers: { host: 'localhost:8360', 'x-forwarded-proto': 'http' },
    });
    assert.equal(res.status, 200);
  });
});
