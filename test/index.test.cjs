const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-index-'));

function run(env, body) {
  const script = `
const http = require('node:http');
const handler = require('./index.cjs');
const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1', () => resolve({ server, base: \`http://127.0.0.1:\${server.address().port}\` }));
});
(async () => { ${body} })().then(
  (result) => { process.stdout.write(\`\\nRESULT \${JSON.stringify(result)}\\n\`); process.exit(0); },
  (err) => { console.error(err); process.exit(1); },
);`;
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VERCEL_ENV|SERVER_URL|SECURE_DOMAINS|COMMENT_AUDIT|NODE_TEST_CONTEXT)$/u.test(key)));
  const out = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...clean, SQLITE_PATH: dir, JWT_TOKEN: 'index-test-secret', ...env },
  });
  const line = out.stdout.split('\n').find((item) => item.startsWith('RESULT '));

  assert.ok(line, `${out.stderr}\n${out.stdout}`.slice(-2000));

  return JSON.parse(line.slice('RESULT '.length));
}

describe('index.cjs', () => {
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('settings are fixed before Waline loads, whatever the environment says', () => {
    const got = run(
      { COMMENT_AUDIT: 'false', SECURE_DOMAINS: 'evil.example', DISABLE_REGION: 'false', DISABLE_USERAGENT: 'true', LOGIN: 'force', MARKDOWN_TEX: 'mathjax', MARKDOWN_HIGHLIGHT: 'false' },
      `const { plugin, config } = think.config('markdown');
       return { audit: think.config('audit'), region: think.config('disableRegion'), ua: think.config('disableUserAgent'), domains: think.config('secureDomains'), plugin, highlight: config.highlight, login: process.env.LOGIN ?? null, site: process.env.SITE_URL };`,
    );

    assert.equal(got.audit, true);
    assert.equal(got.region, true);
    assert.ok(!got.ua);
    assert.deepEqual(got.domains, ['stevehoang.com', 'line.stevehoang.com']);
    assert.deepEqual({ tex: got.plugin.tex, emoji: got.plugin.emoji, sub: got.plugin.sub, sup: got.plugin.sup }, { tex: false, emoji: false, sub: false, sup: false });
    assert.equal(got.highlight, undefined);
    assert.equal(got.login, null);
    assert.equal(got.site, 'https://stevehoang.com');
  });

  test("Waline's secureDomains list stays the same length request after request", () => {
    const got = run(
      {},
      `const { server, base } = await serve();
       const lengths = [];
       const statuses = [];
       for (let i = 0; i < 50; i += 1) {
         const referer = i % 2 ? 'https://evil.example/page' : 'https://stevehoang.com/posts/x/';
         const resp = await fetch(\`\${base}/api/token\`, { headers: { referer } });
         statuses.push(resp.status);
         await resp.text();
         lengths.push(think.config('secureDomains').length);
       }
       server.close();
       return { lengths: [...new Set(lengths)], statuses: [...new Set(statuses)].sort(), domains: think.config('secureDomains') };`,
    );

    assert.deepEqual(got.lengths, [4]);
    assert.deepEqual(got.statuses, [200, 403]);
    assert.deepEqual(got.domains, ['stevehoang.com', 'line.stevehoang.com', 'localhost', '127.0.0.1']);
  });

  test('SERVER_URL is pinned to line.stevehoang.com in production and taken from the request elsewhere', () => {
    const read = 'return { server: process.env.SERVER_URL ?? null };';

    assert.deepEqual(run({ VERCEL_ENV: 'production', SERVER_URL: 'https://evil.example' }, read), { server: 'https://line.stevehoang.com' });
    for (const env of [{ VERCEL_ENV: 'preview', SERVER_URL: 'https://evil.example' }, { SERVER_URL: 'https://evil.example' }, {}]) {
      assert.deepEqual(run(env, read), { server: null }, JSON.stringify(env));
    }
  });
});
