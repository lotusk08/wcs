const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, test } = require('node:test');

const jwt = require('jsonwebtoken');

const { createChallenges, createLimiter, createPasskey, parsePasskeys } = require('../lib/passkey.cjs');

const SECRET = 'test-secret';
const HOST = 'line.stevehoang.com';
const ORIGIN = `https://${HOST}`;
const b64 = (value) => Buffer.from(value).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    throw new Error('too long');
  };

  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error('unsupported');
}

function authenticator({ rpID = HOST, userVerified = true } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const rawId = crypto.randomBytes(16);
  const id = b64(rawId);
  const flags = (uv) => 0x01 | (uv ? 0x04 : 0);
  const cose = cbor(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]),
  );

  return {
    id,
    privateKey,
    attest(options, { origin = ORIGIN } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2);

      len.writeUInt16BE(rawId.length);
      const authData = Buffer.concat([sha256(rpID), Buffer.from([flags(userVerified) | 0x40]), Buffer.alloc(4), Buffer.alloc(16), len, rawId, cose]);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));

      return {
        id,
        rawId: id,
        type: 'public-key',
        response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
      };
    },
    assert(options, { origin = ORIGIN, userHandle, key = privateKey, counter = 0, uv = userVerified } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4);

      count.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([sha256(rpID), Buffer.from([flags(uv)]), count]);
      const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), key);

      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: b64(clientDataJSON),
          authenticatorData: b64(authenticatorData),
          signature: b64(signature),
          userHandle,
        },
        clientExtensionResults: {},
      };
    },
  };
}

const USERS = {
  1: { objectId: '1', email: 'admin@example.com', display_name: 'Steve', url: '', type: 'administrator', password: 'hash', '2fa': 'SECRET', avatar: '' },
  2: { objectId: '2', email: 'guest@example.com', display_name: 'Guest', url: '', type: 'guest', password: 'hash', avatar: '' },
  3: { objectId: '3', email: 'banned@example.com', display_name: 'Banned', url: '', type: 'banned', password: 'hash', avatar: '' },
  4: { objectId: '4', email: 'second@example.com', display_name: 'Second', url: '', type: 'administrator', password: 'hash', avatar: '' },
};
const tokenFor = (id) => jwt.sign(String(id), SECRET);

function serve(options = {}) {
  const env = { ...options.env };
  const passkey = createPasskey({
    jwtKey: () => SECRET,
    findUser: async (id) => (USERS[id] ? { ...USERS[id] } : null),
    avatar: (user) => user.avatar || `https://avatar.test/${user.email}`,
    avatarProxy: () => 'https://proxy.test/a',
    limits: { options: 1000, verify: 1000 },
    ...options,
    env,
  });
  const passed = [];
  const server = http.createServer(async (req, res) => {
    if (await passkey(req, res)) return;
    passed.push(req.url);
    res.writeHead(418);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, env, passed, port: server.address().port }));
  });
}

function call(port, path, { method = 'POST', token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host: HOST,
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, json });
        });
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

describe('challenge tokens', () => {
  test('sign and verify once', () => {
    const challenges = createChallenges({ secret: () => SECRET });
    const { token, challenge, bytes } = challenges.issue('login');

    assert.equal(b64(bytes), challenge);
    const payload = challenges.verify(token, 'login');
    assert.equal(payload.c, challenge);
    assert.equal(payload.p, 'login');
  });

  test('a token is refused the second time', () => {
    const challenges = createChallenges({ secret: () => SECRET });
    const { token } = challenges.issue('login');

    challenges.verify(token, 'login');
    assert.throws(() => challenges.verify(token, 'login'), { errno: 'passkey_challenge_used' });
  });

  test('expires after five minutes', () => {
    let t = 1_000_000;
    const challenges = createChallenges({ secret: () => SECRET, now: () => t });
    const early = challenges.issue('login').token;
    const late = challenges.issue('login').token;

    t += 5 * 60 * 1000 - 1;
    challenges.verify(early, 'login');
    t += 1;
    assert.throws(() => challenges.verify(late, 'login'), { errno: 'passkey_challenge_expired', status: 400 });
  });

  test('wrong purpose, tampering, another key and garbage are invalid', () => {
    const challenges = createChallenges({ secret: () => SECRET });
    const other = createChallenges({ secret: () => 'another-secret' });
    const { token } = challenges.issue('register', { u: '1' });
    const [body, sig] = token.split('.');
    const forged = b64(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), u: '4' }));

    for (const bad of [
      () => challenges.verify(challenges.issue('register').token, 'login'),
      () => challenges.verify(`${forged}.${sig}`, 'register'),
      () => challenges.verify(`${body}.${sig.slice(0, -2)}AA`, 'register'),
      () => challenges.verify(other.issue('login').token, 'login'),
      () => challenges.verify('nope', 'login'),
      () => challenges.verify(undefined, 'login'),
      () => challenges.verify({ token }, 'register'),
      () => challenges.verify(`${token}.x`, 'register'),
    ]) {
      assert.throws(bad, { errno: 'passkey_challenge_invalid' });
    }
    assert.equal(challenges.verify(token, 'register').u, '1');
  });

  test('no key means not configured', () => {
    const challenges = createChallenges({ secret: () => undefined });

    assert.throws(() => challenges.issue('login'), { errno: 'passkey_not_configured', status: 503 });
  });

  test('the seen-set stays bounded', () => {
    const challenges = createChallenges({ secret: () => SECRET, max: 3 });
    const tokens = Array.from({ length: 5 }, () => challenges.issue('login').token);

    for (const token of tokens) challenges.verify(token, 'login');
    assert.throws(() => challenges.verify(tokens[4], 'login'), { errno: 'passkey_challenge_used' });
  });
});

describe('rate limit', () => {
  test('counts per key and resets after the window', () => {
    let t = 0;
    const allow = createLimiter({ limit: 2, window: 1000, now: () => t });

    assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('b')], [true, true, false, true]);
    t = 1000;
    assert.equal(allow('a'), true);
  });
});

describe('PASSKEYS parsing', () => {
  const valid = { id: 'abc_-1', publicKey: 'pQECAyYg', userId: 1, name: ' Phone ', transports: ['internal', 'hybrid', 'BAD!', 3], createdAt: '2026-01-01T00:00:00.000Z' };

  test('invalid JSON or a non-array disables passkeys without throwing', () => {
    for (const value of [undefined, '', '   ', '{', 'null', '{"id":"a"}', '"x"', '42']) {
      assert.deepEqual(parsePasskeys(value), [], String(value));
    }
  });

  test('keeps valid entries, normalised, and drops the rest', () => {
    const list = parsePasskeys(
      JSON.stringify([
        valid,
        { ...valid },
        { id: 'has space', publicKey: 'x', userId: '1' },
        { id: 'ok2', publicKey: '', userId: '1' },
        { id: 'ok3', publicKey: 'x', userId: '' },
        { id: 'ok4', publicKey: 'x', userId: { a: 1 } },
        null,
        'x',
        { id: 'ok5', publicKey: 'x', userId: '1' },
      ]),
    );

    assert.deepEqual(list, [
      { id: 'abc_-1', publicKey: 'pQECAyYg', userId: '1', name: 'Phone', transports: ['internal', 'hybrid'], createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'ok5', publicKey: 'x', userId: '1', name: 'Passkey', createdAt: '' },
    ]);
  });
});

describe('routes', () => {
  let ctx;

  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.server.close());

  test('other paths pass through', async () => {
    for (const p of ['/api/passkeys', '/api/token', '/passkey', '/api/pass']) {
      const res = await call(ctx.port, p, { method: 'GET' });
      assert.equal(res.status, 418, p);
    }
  });

  test('unknown sub-paths are 404 and wrong methods 405', async () => {
    const missing = await call(ctx.port, '/api/passkey/nope', { method: 'GET' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.errno, 'passkey_not_found');

    for (const [method, p, allow] of [
      ['POST', '/api/passkey', 'GET'],
      ['DELETE', '/api/passkey', 'GET'],
      ['GET', '/api/passkey/login/options', 'POST'],
      ['GET', '/api/passkey/login', 'POST'],
      ['PUT', '/api/passkey/register', 'POST'],
      ['GET', '/api/passkey/register/options?x=1', 'POST'],
    ]) {
      const res = await call(ctx.port, p, { method });
      assert.equal(res.status, 405, `${method} ${p}`);
      assert.equal(res.headers.allow, allow);
      assert.equal(res.json.errno, 'passkey_method_not_allowed');
    }
  });

  test('responses are JSON and never cached', async () => {
    const res = await call(ctx.port, '/api/passkey', { method: 'GET' });
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  for (const [method, p] of [['GET', '/api/passkey'], ['POST', '/api/passkey/register/options'], ['POST', '/api/passkey/register']]) {
    test(`${method} ${p} needs an administrator token`, async () => {
      for (const token of [undefined, 'garbage', jwt.sign('1', 'other-key'), tokenFor(99), tokenFor(3)]) {
        const res = await call(ctx.port, p, { method, token, body: method === 'GET' ? undefined : {} });
        assert.equal(res.status, 401, `${token} ${JSON.stringify(res.json)}`);
        assert.equal(res.json.errno, 'passkey_unauthorized');
      }
      const guest = await call(ctx.port, p, { method, token: tokenFor(2), body: method === 'GET' ? undefined : {} });
      assert.equal(guest.status, 403);
      assert.equal(guest.json.errno, 'passkey_forbidden');
    });
  }

  test('login options say not configured when PASSKEYS is empty or invalid', async () => {
    for (const value of [undefined, 'not json', '[{"id":"x"}]']) {
      ctx.env.PASSKEYS = value;
      const res = await call(ctx.port, '/api/passkey/login/options', { body: {} });
      assert.equal(res.status, 404);
      assert.equal(res.json.errno, 'passkey_not_configured');
      const list = await call(ctx.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.data, { enabled: false, rpID: HOST, passkeys: [] });
    }
    delete ctx.env.PASSKEYS;
  });

  test('a malformed body is a 400, not a crash', async () => {
    const res = await call(ctx.port, '/api/passkey/register', { token: tokenFor(1), body: '{nope' });
    assert.equal(res.status, 400);
    assert.equal(res.json.errno, 'passkey_bad_request');
  });
});

describe('register and sign in with a software authenticator', () => {
  let ctx;
  const device = authenticator();
  let value;

  before(async () => {
    ctx = await serve({ env: { SITE_NAME: 'Steve Hoang' } });
  });
  after(() => ctx.server.close());

  const registerOptions = async (token = tokenFor(1)) => {
    const res = await call(ctx.port, '/api/passkey/register/options', { token, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.data;
  };

  const loginOptions = async () => {
    const res = await call(ctx.port, '/api/passkey/login/options', { body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.data;
  };

  test('registration options ask for a discoverable, user-verified passkey on this host', async () => {
    const { options, challengeToken } = await registerOptions();

    assert.equal(options.rp.id, HOST);
    assert.equal(options.rp.name, 'Comments · Steve Hoang');
    assert.equal(options.user.name, 'admin@example.com');
    assert.equal(options.user.displayName, 'Steve');
    assert.equal(options.user.id, b64('1'));
    assert.equal(options.attestation, 'none');
    assert.equal(options.timeout, 300000);
    assert.deepEqual(options.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    assert.match(challengeToken, /^[\w-]+\.[\w-]+$/u);
  });

  test('registration returns the entry and the full PASSKEYS value', async () => {
    const { options, challengeToken } = await registerOptions();
    const res = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken, response: device.attest(options), name: 'Test\nkey' },
    });

    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { entry, passkeys, value: v } = res.json.data;
    assert.equal(entry.id, device.id);
    assert.equal(entry.userId, '1');
    assert.equal(entry.name, 'Test key');
    assert.deepEqual(entry.transports, ['internal']);
    assert.match(entry.createdAt, /^\d{4}-\d\d-\d\dT/u);
    assert.deepEqual(passkeys, [entry]);
    assert.deepEqual(JSON.parse(v), passkeys);
    assert.deepEqual(parsePasskeys(v), passkeys);
    value = v;

    const replay = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken, response: device.attest(options) },
    });
    assert.equal(replay.json.errno, 'passkey_challenge_used');
  });

  test('registration is refused for another admin, a wrong origin or no user verification', async () => {
    const other = await registerOptions(tokenFor(1));
    const stolen = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(4),
      body: { challengeToken: other.challengeToken, response: authenticator().attest(other.options) },
    });
    assert.equal(stolen.json.errno, 'passkey_challenge_invalid');

    const phish = await registerOptions();
    const wrongOrigin = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken: phish.challengeToken, response: authenticator().attest(phish.options, { origin: 'https://evil.test' }) },
    });
    assert.equal(wrongOrigin.status, 400);
    assert.equal(wrongOrigin.json.errno, 'passkey_invalid');

    const noUv = await registerOptions();
    const res = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken: noUv.challengeToken, response: authenticator({ userVerified: false }).attest(noUv.options) },
    });
    assert.equal(res.json.errno, 'passkey_invalid');

    const otherRp = await registerOptions();
    const rp = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken: otherRp.challengeToken, response: authenticator({ rpID: 'evil.test' }).attest(otherRp.options) },
    });
    assert.equal(rp.json.errno, 'passkey_invalid');
  });

  test('once PASSKEYS holds it, the list shows it and a second registration excludes it', async () => {
    ctx.env.PASSKEYS = value;
    const list = await call(ctx.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
    assert.equal(list.json.data.enabled, true);
    assert.deepEqual(list.json.data.passkeys.map(({ id, name, mine }) => ({ id, name, mine })), [{ id: device.id, name: 'Test key', mine: true }]);
    assert.equal('publicKey' in list.json.data.passkeys[0], false);

    const { options, challengeToken } = await registerOptions();
    assert.deepEqual(options.excludeCredentials.map(({ id }) => id), [device.id]);
    const dup = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken, response: device.attest(options) },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.errno, 'passkey_exists');
  });

  test('sign in returns the same shape as POST /api/token, with a Waline token', async () => {
    ctx.env.PASSKEYS = value;
    const { options, challengeToken } = await loginOptions();

    assert.equal(options.rpId, HOST);
    assert.equal(options.userVerification, 'required');
    assert.equal(options.allowCredentials, undefined);

    const res = await call(ctx.port, '/api/passkey/login', {
      body: { challengeToken, response: device.assert(options, { userHandle: b64('1') }) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.errno, 0);
    const data = res.json.data;
    assert.equal(jwt.verify(data.token, SECRET), '1');
    assert.equal(data.password, null);
    assert.equal(data.objectId, '1');
    assert.equal(data.type, 'administrator');
    assert.equal(data['2fa'], 'SECRET');
    assert.equal(data.avatar, `https://proxy.test/a?url=${encodeURIComponent('https://avatar.test/admin@example.com')}`);
    assert.deepEqual(Object.keys(data).sort(), [...Object.keys(USERS[1]), 'token'].sort());

    const replay = await call(ctx.port, '/api/passkey/login', {
      body: { challengeToken, response: device.assert(options, { userHandle: b64('1') }) },
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.json.errno, 'passkey_challenge_used');
  });

  test('a counter of zero or any value is accepted', async () => {
    ctx.env.PASSKEYS = value;
    for (const counter of [0, 7, 3]) {
      const { options, challengeToken } = await loginOptions();
      const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken, response: device.assert(options, { counter }) } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }
  });

  test('unknown credentials, bad signatures, wrong origin and mismatched user handles fail', async () => {
    ctx.env.PASSKEYS = value;
    const stranger = authenticator();
    const cases = [
      [(o) => stranger.assert(o), 404, 'passkey_unknown'],
      [(o) => device.assert(o, { key: stranger.privateKey }), 400, 'passkey_invalid'],
      [(o) => device.assert(o, { origin: 'https://evil.test' }), 400, 'passkey_invalid'],
      [(o) => device.assert(o, { userHandle: b64('4') }), 400, 'passkey_invalid'],
      [(o) => device.assert(o, { uv: false }), 400, 'passkey_invalid'],
    ];

    for (const [build, status, errno] of cases) {
      const { options, challengeToken } = await loginOptions();
      const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken, response: build(options) } });
      assert.equal(res.status, status, JSON.stringify(res.json));
      assert.equal(res.json.errno, errno);
      assert.equal(res.json.data, undefined);
    }

    const { options } = await loginOptions();
    const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken: 'forged.token', response: device.assert(options) } });
    assert.equal(res.json.errno, 'passkey_challenge_invalid');
  });

  test('a registration challenge cannot be used to sign in', async () => {
    ctx.env.PASSKEYS = value;
    const { options, challengeToken } = await registerOptions();
    const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken, response: device.assert(options) } });
    assert.equal(res.json.errno, 'passkey_challenge_invalid');
  });

  test('passkeys of non-administrators or banned users do not sign in', async () => {
    for (const userId of ['2', '3', '99']) {
      const entry = { ...JSON.parse(value)[0], userId };
      ctx.env.PASSKEYS = JSON.stringify([entry]);
      const { options, challengeToken } = await loginOptions();
      const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken, response: device.assert(options) } });
      assert.equal(res.status, 403, userId);
      assert.equal(res.json.errno, 'passkey_forbidden');
    }
    ctx.env.PASSKEYS = value;
  });

  test('PASSKEY_RP_ID and PASSKEY_ORIGIN override the request host', async () => {
    const local = await serve({ env: { PASSKEYS: value, PASSKEY_RP_ID: 'stevehoang.com', PASSKEY_ORIGIN: 'https://admin.stevehoang.com/' } });
    const dev = authenticator({ rpID: 'stevehoang.com' });

    try {
      const reg = await call(local.port, '/api/passkey/register/options', { token: tokenFor(1), body: {} });
      assert.equal(reg.json.data.options.rp.id, 'stevehoang.com');
      const done = await call(local.port, '/api/passkey/register', {
        token: tokenFor(1),
        body: { challengeToken: reg.json.data.challengeToken, response: dev.attest(reg.json.data.options, { origin: 'https://admin.stevehoang.com' }) },
      });
      assert.equal(done.status, 200, JSON.stringify(done.json));
      local.env.PASSKEYS = done.json.data.value;
      const opts = await call(local.port, '/api/passkey/login/options', { body: {} });
      const ok = await call(local.port, '/api/passkey/login', {
        body: { challengeToken: opts.json.data.challengeToken, response: dev.assert(opts.json.data.options, { origin: 'https://admin.stevehoang.com' }) },
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
    } finally {
      local.server.close();
    }
  });
});

describe('public endpoints are rate limited per IP', () => {
  let ctx;

  before(async () => {
    ctx = await serve({ limits: { options: 2, verify: 1 }, env: { PASSKEYS: JSON.stringify([{ id: 'a', publicKey: 'b', userId: '1' }]) } });
  });
  after(() => ctx.server.close());

  test('options and verify have their own budgets', async () => {
    const ip = { 'x-real-ip': '203.0.113.9' };
    const statuses = [];

    for (let i = 0; i < 3; i += 1) statuses.push((await call(ctx.port, '/api/passkey/login/options', { body: {}, headers: ip })).status);
    assert.deepEqual(statuses, [200, 200, 429]);
    const other = await call(ctx.port, '/api/passkey/login/options', { body: {}, headers: { 'x-real-ip': '203.0.113.10' } });
    assert.equal(other.status, 200);

    const first = await call(ctx.port, '/api/passkey/login', { body: {}, headers: ip });
    assert.equal(first.status, 400);
    const second = await call(ctx.port, '/api/passkey/login', { body: {}, headers: ip });
    assert.equal(second.status, 429);
    assert.equal(second.json.errno, 'passkey_rate_limited');
  });
});
