const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const { createWidget } = require('../lib/widget.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-widget-'));

fs.writeFileSync(path.join(dir, 'waline.css'), ':root{--waline-theme-color:#27ae60}\n');
fs.writeFileSync(path.join(dir, 'theme.css'), '#waline {\n  --waline-theme-color: var(--secondary-color);\n}\n');

const BODY = ':root{--waline-theme-color:#27ae60}\n#waline {\n  --waline-theme-color: var(--secondary-color);\n}\n';
const HASH = crypto.createHash('sha256').update(BODY).digest('hex').slice(0, 12);

function serve(options = {}) {
  const calls = [];
  const widget = createWidget({ dir, ...options });
  const server = http.createServer((req, res) => {
    if (widget(req, res)) return;
    calls.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"waline":true}');
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

const assertCommon = (res) => {
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
};

describe('widget stylesheet', () => {
  let ctx;

  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.server.close());

  test('GET /widget.css is the base sheet followed by the theme', async () => {
    const res = await request(ctx.port, { path: '/widget.css' });
    assert.equal(res.status, 200);
    assert.equal(res.body, BODY);
    assert.equal(res.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
    assert.equal(res.headers.etag, `"${HASH}"`);
    assert.equal(Number(res.headers['content-length']), Buffer.byteLength(BODY));
    assertCommon(res);
  });

  test('the matching ?v= is immutable', async () => {
    const res = await request(ctx.port, { path: `/widget.css?v=${HASH}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  test('a stale ?v= gets the current sheet with a short cache', async () => {
    const res = await request(ctx.port, { path: '/widget.css?v=000000000000' });
    assert.equal(res.status, 200);
    assert.equal(res.body, BODY);
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
  });

  for (const tag of [`"${HASH}"`, `W/"${HASH}"`, `"other", "${HASH}"`, '*']) {
    test(`If-None-Match ${tag} answers 304`, async () => {
      const res = await request(ctx.port, { path: `/widget.css?v=${HASH}`, headers: { 'if-none-match': tag } });
      assert.equal(res.status, 304);
      assert.equal(res.body, '');
      assert.equal(res.headers.etag, `"${HASH}"`);
      assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
      assertCommon(res);
    });
  }

  test('a different ETag gets the sheet', async () => {
    const res = await request(ctx.port, { path: '/widget.css', headers: { 'if-none-match': '"nope"' } });
    assert.equal(res.status, 200);
    assert.equal(res.body, BODY);
  });

  test('HEAD /widget.css has the headers and no body', async () => {
    const res = await request(ctx.port, { method: 'HEAD', path: '/widget.css' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.equal(res.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(Number(res.headers['content-length']), Buffer.byteLength(BODY));
    assert.equal(res.headers.etag, `"${HASH}"`);
  });

  test('GET /widget.json names the versioned sheet', async () => {
    const res = await request(ctx.port, { path: '/widget.json' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, max-age=60');
    assert.deepEqual(JSON.parse(res.body), { css: `/widget.css?v=${HASH}` });
    assertCommon(res);

    const again = await request(ctx.port, { path: '/widget.json', headers: { 'if-none-match': res.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body, '');

    const head = await request(ctx.port, { method: 'HEAD', path: '/widget.json?x=1' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });

  test('other methods and paths go to Waline', async () => {
    const before = ctx.calls.length;
    for (const [method, p] of [
      ['POST', '/widget.css'],
      ['OPTIONS', '/widget.css'],
      ['GET', '/widget.css/'],
      ['GET', '/widget.cssx'],
      ['GET', '/api/widget.css'],
    ]) {
      const res = await request(ctx.port, { method, path: p });
      assert.equal(res.status, 200);
      assert.equal(res.body, '{"waline":true}');
    }
    assert.equal(ctx.calls.length, before + 5);
  });
});

describe('widget stylesheet missing', () => {
  test('answers 503 without caching', async () => {
    const ctx = await serve({ dir: path.join(dir, 'missing') });
    try {
      for (const p of ['/widget.css', '/widget.json']) {
        const res = await request(ctx.port, { path: p });
        assert.equal(res.status, 503);
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    } finally {
      ctx.server.close();
    }
  });
});

describe('shipped widget', () => {
  test('the repository sheet carries the Waline base and the site theme', async () => {
    const ctx = await serve({ dir: path.join(__dirname, '..', 'widget') });
    try {
      const res = await request(ctx.port, { path: '/widget.css' });
      assert.equal(res.status, 200);
      assert.match(res.body, /\[data-waline\]/u);
      assert.match(res.body, /#waline \.wl-panel/u);
      assert.ok(res.body.indexOf('[data-waline]') < res.body.indexOf('#waline {'));
      assert.doesNotMatch(res.body, /sourceMappingURL/u);
    } finally {
      ctx.server.close();
    }
  });
});
