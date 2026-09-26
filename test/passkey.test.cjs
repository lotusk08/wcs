const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const jwt = require('jsonwebtoken');
const Model = require('think-model/lib/model.js');
const Sqlite = require('think-model-sqlite');

const { createChallenges, createLimiter, createPasskey, parsePasskeys, passkeyStatus } = require('../lib/passkey.cjs');
const { createPasskeyStore, tableDDL } = require('../lib/passkey-store.cjs');

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
    publicKey: b64(cose),
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'passkey-test-'));
let dbCount = 0;

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function sqliteModel(name = `db${(dbCount += 1)}`, prefix = 'wl_') {
  return () => new Model('Passkeys', { handle: Sqlite, path: tmp, database: name, prefix, connectionLimit: 1 });
}

function sqliteStore({ env = {}, name, ...options } = {}) {
  return createPasskeyStore({ env, type: 'sqlite', model: sqliteModel(name), logger: { error() {} }, ...options });
}

function serve(options = {}) {
  const env = { ...options.env };
  const store = options.store === undefined ? sqliteStore({ env }) : options.store || undefined;
  const passkey = createPasskey({
    jwtKey: () => SECRET,
    findUser: async (id) => (USERS[id] ? { ...USERS[id] } : null),
    avatar: (user) => user.avatar || `https://avatar.test/${user.email}`,
    avatarProxy: () => 'https://proxy.test/a',
    limits: { options: 1000, verify: 1000 },
    ...options,
    store,
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
    server.listen(0, '127.0.0.1', () => resolve({ server, env, store: passkey.store, passed, port: server.address().port }));
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

describe('passkey table DDL', () => {
  test('MySQL and TiDB: ascii_bin credential id under the index limit, utf8mb4 names, no ENGINE', () => {
    const [sql, ...rest] = tableDDL('mysql', 'wl_Passkeys');

    assert.deepEqual(rest, []);
    assert.match(sql, /^CREATE TABLE IF NOT EXISTS `wl_Passkeys` \(/u);
    assert.match(sql, /`id` int unsigned NOT NULL AUTO_INCREMENT,/u);
    assert.match(sql, /`credential_id` varchar\(1400\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,/u);
    assert.match(sql, /`public_key` text CHARACTER SET ascii COLLATE ascii_bin NOT NULL,/u);
    assert.match(sql, /`name` varchar\(255\) NOT NULL DEFAULT '',/u);
    assert.match(sql, /PRIMARY KEY \(`id`\),\n {2}UNIQUE KEY `uniq_passkey_credential` \(`credential_id`\)\n\) DEFAULT CHARSET=utf8mb4$/u);
    assert.doesNotMatch(sql, /ENGINE|;|\btimestamp\b/u);
    assert.ok(1400 <= 3072, 'an ascii varchar(1400) key fits the 3072-byte InnoDB/TiDB index limit');
    for (const column of ['credential_id', 'public_key', 'user_id', 'name', 'transports', 'source', 'created_at', 'last_used_at', 'removed_at']) {
      assert.match(sql, new RegExp(`\`${column}\` `, 'u'), column);
    }
  });

  test('SQLite: a table and a unique index named after the table', () => {
    const [table, index] = tableDDL('sqlite', 'x_Passkeys');

    assert.match(table, /^CREATE TABLE IF NOT EXISTS "x_Passkeys" \(\n {2}"id" INTEGER PRIMARY KEY AUTOINCREMENT,/u);
    assert.equal(index, 'CREATE UNIQUE INDEX IF NOT EXISTS "x_Passkeys_credential_id" ON "x_Passkeys" ("credential_id")');
  });

  test('refuses table names it would have to quote, and other dialects', () => {
    for (const bad of ['wl`_Passkeys', 'a"b', 'a b', '', 'x;DROP']) assert.throws(() => tableDDL('mysql', bad), TypeError, bad);
    assert.throws(() => tableDDL('postgresql', 'wl_Passkeys'), TypeError);
  });
});

describe('passkey store on SQLite', () => {
  const envEntry = { id: 'EnV-_1', publicKey: 'pUbK3y_-', userId: 1, name: 'Steve Hoang', createdAt: '2026-01-02T03:04:05.000Z' };
  const envValue = JSON.stringify([envEntry]);
  const count = async (model) => (await model().select()).length;

  test('creates the table with the storage prefix and imports PASSKEYS once', async () => {
    const name = 'import-once';
    const model = sqliteModel(name, 'pre_');
    const env = { PASSKEYS: envValue };
    const store = createPasskeyStore({ env, type: 'sqlite', model });

    assert.equal(store.table, 'pre_Passkeys');
    const first = await store.state();
    assert.equal(first.storage, 'database');
    assert.equal(first.error, null);
    assert.deepEqual(
      first.passkeys.map(({ id, userId, name: n, source, createdAt }) => ({ id, userId, name: n, source, createdAt })),
      [{ id: 'EnV-_1', userId: '1', name: 'Steve Hoang', source: 'env', createdAt: '2026-01-02T03:04:05.000Z' }],
    );
    await store.state({ fresh: true });
    await createPasskeyStore({ env, type: 'sqlite', model }).state();
    await Promise.all([1, 2, 3].map(() => createPasskeyStore({ env, type: 'sqlite', model }).state()));
    assert.equal(await count(model), 1);
  });

  test('register, list, rename, touch and remove with a tombstone', async () => {
    let t = Date.parse('2026-09-01T00:00:00Z');
    const model = sqliteModel();
    const env = { PASSKEYS: envValue };
    const store = createPasskeyStore({ env, type: 'sqlite', model, now: () => t });

    const saved = await store.add({ id: 'NeW_1', publicKey: 'QUJD', userId: '1', name: 'iPhone', transports: ['internal', 'hybrid'] });
    assert.deepEqual(saved, {
      id: 'NeW_1',
      publicKey: 'QUJD',
      userId: '1',
      name: 'iPhone',
      transports: ['internal', 'hybrid'],
      source: 'app',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastUsedAt: '',
      removedAt: '',
    });
    assert.deepEqual((await store.state()).passkeys.map((p) => p.id), ['EnV-_1', 'NeW_1']);
    await assert.rejects(store.add({ id: 'NeW_1', publicKey: 'QUJD', userId: '1', name: 'again' }), { errno: 'passkey_exists', status: 409 });

    t += 1000;
    await store.touch('NeW_1');
    await store.rename('NeW_1', ' Work\tphone ');
    const renamed = (await store.state()).passkeys.find((p) => p.id === 'NeW_1');
    assert.equal(renamed.name, 'Work phone');
    assert.equal(renamed.lastUsedAt, '2026-09-01T00:00:01.000Z');
    await assert.rejects(store.rename('NeW_1', '   '), { errno: 'passkey_bad_request' });
    await assert.rejects(store.rename('nope', 'x'), { errno: 'passkey_unknown', status: 404 });

    const removed = await store.remove('EnV-_1');
    assert.equal(removed.id, 'EnV-_1');
    assert.deepEqual((await store.state()).passkeys.map((p) => p.id), ['NeW_1']);
    await assert.rejects(store.remove('EnV-_1'), { errno: 'passkey_unknown', status: 404 });

    const later = createPasskeyStore({ env, type: 'sqlite', model });
    assert.deepEqual((await later.state()).passkeys.map((p) => p.id), ['NeW_1'], 'a removed PASSKEYS entry is not imported again');
    assert.equal(await count(model), 2);
    const tomb = (await model().where({ credential_id: 'EnV-_1' }).find());
    assert.equal(tomb.public_key, '');
    assert.equal(tomb.removed_at, '2026-09-01T00:00:01.000Z');
    assert.equal((await later.find('EnV-_1')).entry, null);
    assert.equal((await later.find('NeW_1')).entry.publicKey, 'QUJD');

    await store.add({ id: 'EnV-_1', publicKey: 'TkVX', userId: '1', name: 'Back' });
    assert.deepEqual((await later.state({ fresh: true })).passkeys.map((p) => [p.id, p.publicKey, p.source]), [
      ['EnV-_1', 'TkVX', 'app'],
      ['NeW_1', 'QUJD', 'app'],
    ]);
  });

  test('reads are cached for the TTL and writes invalidate this instance at once', async () => {
    let t = 0;
    const model = sqliteModel();
    const a = createPasskeyStore({ env: {}, type: 'sqlite', model, now: () => t, ttl: 30000 });
    const b = createPasskeyStore({ env: {}, type: 'sqlite', model, now: () => t, ttl: 30000 });

    assert.deepEqual((await b.state()).passkeys, []);
    await a.add({ id: 'CaChE', publicKey: 'QUJD', userId: '1' });
    assert.equal((await a.state()).passkeys.length, 1, 'the writer sees its write');
    assert.equal((await b.state()).passkeys.length, 0, 'another instance keeps its cache');
    assert.equal((await b.find('CaChE')).entry.id, 'CaChE', 'sign-in reads the table, not the cache');
    t += 30000;
    assert.equal((await b.state()).passkeys.length, 1);

    await a.remove('CaChE');
    assert.equal((await b.find('CaChE')).entry, null, 'a removed passkey stops at once everywhere');
    assert.equal((await a.state()).passkeys.length, 0);
  });

  test('a new PASSKEYS entry is picked up without waiting for the cache', async () => {
    const env = {};
    const store = createPasskeyStore({ env, type: 'sqlite', model: sqliteModel() });

    assert.deepEqual((await store.state()).passkeys, []);
    env.PASSKEYS = envValue;
    assert.deepEqual((await store.state()).passkeys.map((p) => p.id), ['EnV-_1']);
  });

  test('peekEnabled answers from PASSKEYS or the last read, without waiting', async () => {
    const env = {};
    const store = createPasskeyStore({ env, type: 'sqlite', model: sqliteModel() });

    assert.equal(store.peekEnabled(), false);
    await store.add({ id: 'PeEk', publicKey: 'QUJD', userId: '1' });
    await store.state();
    assert.equal(store.peekEnabled(), true);
    await store.remove('PeEk');
    await store.state();
    assert.equal(store.peekEnabled(), false);
    env.PASSKEYS = envValue;
    assert.equal(store.peekEnabled(), true, 'a new PASSKEYS entry counts before it is imported');
    await store.state();
    await store.remove('EnV-_1');
    await store.state();
    assert.equal(store.peekEnabled(), false, 'a removed PASSKEYS entry does not');
    await store.add({ id: 'KePt', publicKey: 'QUJD', userId: '1' });
    await store.touch('KePt');
    assert.equal(store.peekEnabled(), true, 'the last read still answers while the cache refills');
    assert.equal(createPasskeyStore({ env: { PASSKEYS: envValue } }).peekEnabled(), true);
  });

  test('unsupported storage or no database: PASSKEYS only, read-only, with a reason', async () => {
    for (const store of [
      createPasskeyStore({ env: { PASSKEYS: envValue }, type: 'postgresql', model: () => ({ tableName: 'wl_Passkeys' }) }),
      createPasskeyStore({ env: { PASSKEYS: envValue } }),
    ]) {
      const state = await store.state();
      assert.equal(state.storage, 'env');
      assert.equal(state.error.errno, 'passkey_storage_unsupported');
      assert.match(state.error.message, /PASSKEYS only/u);
      assert.deepEqual(state.passkeys.map((p) => p.id), ['EnV-_1']);
      assert.equal((await store.find('EnV-_1')).entry.id, 'EnV-_1');
      await assert.rejects(store.add({ id: 'x', publicKey: 'y', userId: '1' }), { errno: 'passkey_storage_unsupported', status: 503 });
      await assert.rejects(store.remove('EnV-_1'), { errno: 'passkey_storage_unsupported' });
    }
    assert.match(createPasskeyStore({ type: 'postgresql', model: () => ({}) }).unsupported, /postgresql storage is not supported/u);
  });

  test('a table that cannot be created falls back to PASSKEYS and retries later', async () => {
    let t = 0;
    let calls = 0;
    const errors = [];
    const broken = () => ({
      tableName: 'wl_Passkeys',
      execute: async () => {
        calls += 1;
        throw new Error('CREATE command denied');
      },
    });
    const store = createPasskeyStore({ env: { PASSKEYS: envValue }, type: 'tidb', model: broken, now: () => t, logger: { error: (...a) => errors.push(a) } });

    const state = await store.state();
    assert.equal(state.storage, 'env');
    assert.equal(state.error.errno, 'passkey_storage_error');
    assert.match(state.error.message, /CREATE command denied/u);
    assert.deepEqual(state.passkeys.map((p) => p.id), ['EnV-_1']);
    await store.state();
    assert.equal(calls, 1, 'no retry inside the back-off');
    t += 60000;
    await store.state();
    assert.equal(calls, 2);
    assert.equal(errors.length, 2);
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
    for (const p of ['/api/passkey/a/b', '/api/passkey/login/x']) {
      const missing = await call(ctx.port, p, { method: 'GET' });
      assert.equal(missing.status, 404, p);
      assert.equal(missing.json.errno, 'passkey_not_found');
    }

    for (const [method, p, allow] of [
      ['POST', '/api/passkey', 'GET'],
      ['DELETE', '/api/passkey', 'GET'],
      ['GET', '/api/passkey/login/options', 'POST'],
      ['GET', '/api/passkey/login', 'POST'],
      ['PUT', '/api/passkey/register', 'POST'],
      ['GET', '/api/passkey/register/options?x=1', 'POST'],
      ['GET', '/api/passkey/SomeId', 'DELETE, PATCH'],
      ['POST', '/api/passkey/SomeId', 'DELETE, PATCH'],
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

  for (const [method, p] of [
    ['GET', '/api/passkey'],
    ['POST', '/api/passkey/register/options'],
    ['POST', '/api/passkey/register'],
    ['DELETE', '/api/passkey/SomeId'],
    ['PATCH', '/api/passkey/SomeId'],
  ]) {
    test(`${method} ${p} needs an administrator token`, async () => {
      for (const token of [undefined, 'garbage', jwt.sign('1', 'other-key'), tokenFor(99), tokenFor(3)]) {
        const res = await call(ctx.port, p, { method, token, body: method === 'GET' || method === 'DELETE' ? undefined : {} });
        assert.equal(res.status, 401, `${token} ${JSON.stringify(res.json)}`);
        assert.equal(res.json.errno, 'passkey_unauthorized');
      }
      const guest = await call(ctx.port, p, { method, token: tokenFor(2), body: method === 'GET' || method === 'DELETE' ? undefined : {} });
      assert.equal(guest.status, 403);
      assert.equal(guest.json.errno, 'passkey_forbidden');
    });
  }

  test('DELETE and PATCH of an unknown passkey are 404', async () => {
    for (const p of ['/api/passkey/NoSuchId', '/api/passkey/has%20space', '/api/passkey/%E0%A4%A']) {
      const res = await call(ctx.port, p, { method: 'DELETE', token: tokenFor(1) });
      assert.equal(res.status, 404, p);
      assert.equal(res.json.errno, 'passkey_unknown');
    }
    const patch = await call(ctx.port, '/api/passkey/NoSuchId', { method: 'PATCH', token: tokenFor(1), body: { name: 'x' } });
    assert.equal(patch.status, 404);
  });

  test('login options say not configured when there are no passkeys', async () => {
    for (const value of [undefined, 'not json', '[{"id":"x"}]']) {
      ctx.env.PASSKEYS = value;
      const res = await call(ctx.port, '/api/passkey/login/options', { body: {} });
      assert.equal(res.status, 404);
      assert.equal(res.json.errno, 'passkey_not_configured');
      const list = await call(ctx.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.data, {
        enabled: false,
        storage: 'database',
        notice: null,
        status: value === undefined ? 'none' : 'invalid',
        rpID: HOST,
        passkeys: [],
      });
    }
    delete ctx.env.PASSKEYS;
  });

  test('a malformed body is a 400, not a crash', async () => {
    const res = await call(ctx.port, '/api/passkey/register', { token: tokenFor(1), body: '{nope' });
    assert.equal(res.status, 400);
    assert.equal(res.json.errno, 'passkey_bad_request');
  });

  test('without a database the list says so and registration is refused', async () => {
    const local = await serve({ store: null, env: { PASSKEYS: JSON.stringify([{ id: 'a', publicKey: 'b', userId: '1' }]) } });

    try {
      const list = await call(local.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
      assert.equal(list.json.data.storage, 'env');
      assert.equal(list.json.data.notice.errno, 'passkey_storage_unsupported');
      assert.deepEqual(list.json.data.passkeys.map((p) => [p.id, p.source, p.inEnv]), [['a', 'env', true]]);
      const del = await call(local.port, '/api/passkey/a', { method: 'DELETE', token: tokenFor(1) });
      assert.equal(del.status, 503);
      assert.equal(del.json.errno, 'passkey_storage_unsupported');
    } finally {
      local.server.close();
    }
  });
});

describe('register and sign in with a software authenticator', () => {
  let ctx;
  const device = authenticator();

  before(async () => {
    ctx = await serve({ env: { SITE_NAME: 'Steve Hoang' } });
  });
  after(() => ctx.server.close());

  const registerOptions = async (token = tokenFor(1), port = ctx.port) => {
    const res = await call(port, '/api/passkey/register/options', { token, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.data;
  };

  const loginOptions = async (port = ctx.port) => {
    const res = await call(port, '/api/passkey/login/options', { body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.data;
  };

  const signIn = async (dev, port = ctx.port, extra = {}) => {
    const { options, challengeToken } = await loginOptions(port);

    return call(port, '/api/passkey/login', { body: { challengeToken, response: dev.assert(options, extra) } });
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
    assert.deepEqual(options.excludeCredentials, []);
    assert.deepEqual(options.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    assert.match(challengeToken, /^[\w-]+\.[\w-]+$/u);
  });

  test('registration stores the passkey and returns the new list', async () => {
    const { options, challengeToken } = await registerOptions();
    const res = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken, response: device.attest(options), name: 'Test\nkey' },
    });

    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { entry, passkeys, enabled, storage } = res.json.data;
    assert.equal(entry.id, device.id);
    assert.equal(entry.name, 'Test key');
    assert.deepEqual(entry.transports, ['internal']);
    assert.equal(entry.source, 'app');
    assert.equal(entry.inEnv, false);
    assert.equal(entry.mine, true);
    assert.equal(entry.lastUsedAt, '');
    assert.match(entry.createdAt, /^\d{4}-\d\d-\d\dT/u);
    assert.equal('publicKey' in entry, false);
    assert.equal('value' in res.json.data, false);
    assert.deepEqual(passkeys, [entry]);
    assert.equal(enabled, true);
    assert.equal(storage, 'database');

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

  test('the list shows it at once and a second registration excludes it', async () => {
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

  test('sign in works straight away, returns the same shape as POST /api/token and records the use', async () => {
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

    const list = await call(ctx.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
    assert.match(list.json.data.passkeys[0].lastUsedAt, /^\d{4}-\d\d-\d\dT/u);
  });

  test('a counter of zero or any value is accepted', async () => {
    for (const counter of [0, 7, 3]) {
      const res = await signIn(device, ctx.port, { counter });
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }
  });

  test('unknown credentials, bad signatures, wrong origin and mismatched user handles fail', async () => {
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
    const { options, challengeToken } = await registerOptions();
    const res = await call(ctx.port, '/api/passkey/login', { body: { challengeToken, response: device.assert(options) } });
    assert.equal(res.json.errno, 'passkey_challenge_invalid');
  });

  test('rename, then remove: the passkey stops working at once and can be added again', async () => {
    const renamed = await call(ctx.port, `/api/passkey/${device.id}`, { method: 'PATCH', token: tokenFor(1), body: { name: 'Laptop' } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.equal(renamed.json.data.passkeys[0].name, 'Laptop');

    const res = await call(ctx.port, `/api/passkey/${device.id}`, { method: 'DELETE', token: tokenFor(1) });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.removed, device.id);
    assert.equal(res.json.data.stillInEnv, false);
    assert.deepEqual(res.json.data.passkeys, []);
    assert.equal(res.json.data.enabled, false);

    const again = await call(ctx.port, `/api/passkey/${device.id}`, { method: 'DELETE', token: tokenFor(1) });
    assert.equal(again.status, 404);

    const { options, challengeToken } = await registerOptions();
    assert.deepEqual(options.excludeCredentials, []);
    ctx.env.PASSKEYS = JSON.stringify([{ id: 'OtHeR', publicKey: 'QUJD', userId: '1' }]);
    const login = await signIn(device);
    assert.equal(login.status, 404);
    assert.equal(login.json.errno, 'passkey_unknown');

    const back = await call(ctx.port, '/api/passkey/register', {
      token: tokenFor(1),
      body: { challengeToken, response: device.attest(options), name: 'Back' },
    });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal((await signIn(device)).status, 200);
    delete ctx.env.PASSKEYS;
  });

  test('a PASSKEYS entry is imported, signs in, and once removed stays removed', async () => {
    const owner = authenticator();
    const local = await serve({ env: { PASSKEYS: JSON.stringify([{ id: owner.id, publicKey: owner.publicKey, userId: 1, name: 'Steve Hoang' }]) } });

    try {
      const list = await call(local.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
      assert.deepEqual(list.json.data.passkeys.map((p) => [p.id, p.name, p.source, p.inEnv]), [[owner.id, 'Steve Hoang', 'env', true]]);
      assert.equal((await signIn(owner, local.port, { userHandle: b64('1') })).status, 200);

      const del = await call(local.port, `/api/passkey/${owner.id}`, { method: 'DELETE', token: tokenFor(1) });
      assert.equal(del.status, 200);
      assert.equal(del.json.data.stillInEnv, true);
      assert.deepEqual(del.json.data.passkeys, []);
      local.store.invalidate();
      const after2 = await call(local.port, '/api/passkey', { method: 'GET', token: tokenFor(1) });
      assert.deepEqual(after2.json.data.passkeys, []);
      const opts = await call(local.port, '/api/passkey/login/options', { body: {} });
      assert.equal(opts.json.errno, 'passkey_not_configured');
    } finally {
      local.server.close();
    }
  });

  test('passkeys of non-administrators or banned users do not sign in', async () => {
    for (const userId of ['2', '3', '99']) {
      const dev = authenticator();
      const local = await serve({ env: { PASSKEYS: JSON.stringify([{ id: dev.id, publicKey: dev.publicKey, userId }]) } });

      try {
        const res = await signIn(dev, local.port);
        assert.equal(res.status, 403, userId);
        assert.equal(res.json.errno, 'passkey_forbidden');
      } finally {
        local.server.close();
      }
    }
  });

  test('PASSKEY_RP_ID and PASSKEY_ORIGIN override the request host', async () => {
    const local = await serve({ env: { PASSKEY_RP_ID: 'stevehoang.com', PASSKEY_ORIGIN: 'https://admin.stevehoang.com/' } });
    const dev = authenticator({ rpID: 'stevehoang.com' });

    try {
      const reg = await registerOptions(tokenFor(1), local.port);
      assert.equal(reg.options.rp.id, 'stevehoang.com');
      const done = await call(local.port, '/api/passkey/register', {
        token: tokenFor(1),
        body: { challengeToken: reg.challengeToken, response: dev.attest(reg.options, { origin: 'https://admin.stevehoang.com' }) },
      });
      assert.equal(done.status, 200, JSON.stringify(done.json));
      const ok = await signIn(dev, local.port, { origin: 'https://admin.stevehoang.com' });
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

describe('PASSKEYS pasted by hand', () => {
  const entry = { id: 'AbC-_1', publicKey: 'pUbK3y_-', userId: 1, name: 'iPhone' };
  const json = JSON.stringify([entry]);

  test('reads the value however it was pasted', () => {
    for (const value of [
      json,
      `  ${json}\n`,
      `PASSKEYS=${json}`,
      `'${json}'`,
      JSON.stringify(json),
      JSON.stringify(entry),
      `﻿${json}`,
    ]) {
      const list = parsePasskeys(value);
      assert.equal(list.length, 1, value);
      assert.equal(list[0].id, 'AbC-_1');
      assert.equal(list[0].userId, '1');
    }
  });

  test('reports whether the value could be read', () => {
    assert.equal(passkeyStatus(undefined), 'none');
    assert.equal(passkeyStatus('  '), 'none');
    assert.equal(passkeyStatus(json), 'ok');
    assert.equal(passkeyStatus('[{"id":"x"'), 'invalid');
    assert.equal(passkeyStatus('[]'), 'invalid');
  });
});
