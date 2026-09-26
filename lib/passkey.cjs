const crypto = require('node:crypto');

const jwt = require('jsonwebtoken');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require('@simplewebauthn/server');
const { version: WALINE_VERSION } = require('@waline/vercel/package.json');

const PREFIX = '/api/passkey';
const CHALLENGE_TTL = 5 * 60 * 1000;
const BODY_LIMIT = 64 * 1024;
const B64URL = /^[A-Za-z0-9_-]+$/u;
const TRANSPORT = /^[a-z-]{1,32}$/u;
const HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/iu;

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-waline-version': WALINE_VERSION,
};

class PasskeyError extends Error {
  constructor(status, errno, message) {
    super(message);
    this.status = status;
    this.errno = errno;
  }
}

const first = (value) => String(value || '').split(',')[0].trim();

const originOf = (value) => {
  try {
    const url = new URL(String(value || '').trim());

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
};

function requestOrigin(headers) {
  const proto = first(headers['x-forwarded-proto']).toLowerCase();
  const host = [first(headers['x-forwarded-host']), first(headers.host)].find((h) => HOST.test(h));

  return `${proto === 'http' ? 'http' : 'https'}://${host || 'localhost'}`;
}

const cleanName = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .trim()
        .slice(0, 64)
    : '';

function entryOf(item) {
  if (!item || typeof item !== 'object') return null;

  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const publicKey = typeof item.publicKey === 'string' ? item.publicKey.trim() : '';
  const userId = ['string', 'number'].includes(typeof item.userId) ? String(item.userId).trim() : '';

  if (!B64URL.test(id) || !B64URL.test(publicKey) || !userId) return null;

  const entry = { id, publicKey, userId, name: cleanName(item.name) || 'Passkey' };
  const transports = Array.isArray(item.transports)
    ? [...new Set(item.transports.filter((t) => typeof t === 'string' && TRANSPORT.test(t)))]
    : [];

  if (transports.length) entry.transports = transports;
  entry.createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';

  return entry;
}

function parsePasskeys(value) {
  let list;

  try {
    list = JSON.parse(String(value ?? '').trim() || '[]');
  } catch {
    return [];
  }

  if (!Array.isArray(list)) return [];

  const seen = new Set();

  return list.map(entryOf).filter((entry) => {
    if (!entry || seen.has(entry.id)) return false;
    seen.add(entry.id);

    return true;
  });
}

function createChallenges({ secret, now = Date.now, ttl = CHALLENGE_TTL, max = 5000 } = {}) {
  const consumed = new Map();
  const invalid = () => new PasskeyError(400, 'passkey_challenge_invalid', 'The sign-in request is not valid. Try again.');

  const key = () => {
    const value = secret();

    if (!value) throw new PasskeyError(503, 'passkey_not_configured', 'Passkeys are not configured on this server.');

    return crypto.createHmac('sha256', String(value)).update('waline-passkey-challenge').digest();
  };
  const mac = (body) => crypto.createHmac('sha256', key()).update(body).digest('base64url');

  const prune = () => {
    const t = now();

    for (const [challenge, expires] of consumed) if (expires <= t) consumed.delete(challenge);
    while (consumed.size >= max) consumed.delete(consumed.keys().next().value);
  };

  return {
    issue(purpose, extra = {}) {
      const bytes = crypto.randomBytes(32);
      const challenge = bytes.toString('base64url');
      const body = Buffer.from(JSON.stringify({ ...extra, p: purpose, c: challenge, e: now() + ttl })).toString('base64url');

      return { bytes: new Uint8Array(bytes), challenge, token: `${body}.${mac(body)}` };
    },
    verify(token, purpose) {
      const parts = typeof token === 'string' ? token.split('.') : [];

      if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) throw invalid();

      const expected = Buffer.from(mac(parts[0]));
      const given = Buffer.from(parts[1]);

      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid();

      let payload;

      try {
        payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      } catch {
        throw invalid();
      }

      if (payload?.p !== purpose || typeof payload.c !== 'string' || typeof payload.e !== 'number') throw invalid();
      if (payload.e <= now()) {
        throw new PasskeyError(400, 'passkey_challenge_expired', 'The sign-in request expired. Try again.');
      }

      prune();
      if (consumed.has(payload.c)) {
        throw new PasskeyError(400, 'passkey_challenge_used', 'This sign-in request was already used. Try again.');
      }
      consumed.set(payload.c, payload.e);

      return payload;
    },
  };
}

function createLimiter({ limit, window = 60 * 1000, now = Date.now, max = 5000 }) {
  const hits = new Map();

  return (key) => {
    const t = now();
    let entry = hits.get(key);

    if (!entry || entry.reset <= t) {
      if (hits.size >= max) {
        for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
        while (hits.size >= max) hits.delete(hits.keys().next().value);
      }
      entry = { count: 0, reset: t + window };
      hits.set(key, entry);
    }

    entry.count += 1;

    return entry.count <= limit;
  };
}

function clientIp(req) {
  return first(req.headers['x-real-ip']) || first(req.headers['x-forwarded-for']) || req.socket?.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new PasskeyError(413, 'passkey_body_too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');

      try {
        const body = text ? JSON.parse(text) : {};

        resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
      } catch {
        reject(new PasskeyError(400, 'passkey_bad_request', 'Request body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));

  res.writeHead(status, { ...HEADERS, 'content-length': body.length });
  res.end(body);
}

const blocked = (user) => user?.type === 'banned' || /^verify:/iu.test(user?.type ?? '');

function createPasskey({
  env = process.env,
  jwtKey,
  findUser,
  avatar = (user) => user.avatar,
  avatarProxy = () => '',
  now = Date.now,
  limits = {},
} = {}) {
  const secret = () => (typeof jwtKey === 'function' ? jwtKey() : jwtKey);
  const challenges = createChallenges({ secret, now });
  const optionsLimit = createLimiter({ limit: limits.options ?? 30, now });
  const verifyLimit = createLimiter({ limit: limits.verify ?? 10, now });

  const passkeys = () => parsePasskeys(env.PASSKEYS);

  const expected = (req) => {
    const origin = originOf(env.PASSKEY_ORIGIN) || requestOrigin(req.headers);
    const rpID = String(env.PASSKEY_RP_ID || '').trim().toLowerCase() || new URL(origin).hostname;

    return { origin, rpID };
  };

  const rpName = () => {
    const name = env.SITE_NAME || 'Steve Hoang';

    return /^comments\b/iu.test(name) ? name : `Comments · ${name}`;
  };

  const limit = (check, req) => {
    if (!check(clientIp(req))) {
      throw new PasskeyError(429, 'passkey_rate_limited', 'Too many attempts. Wait a minute and try again.');
    }
  };

  async function admin(req) {
    const header = String(req.headers.authorization || '');
    const match = /^Bearer\s+(\S+)$/u.exec(header);

    if (!match) throw new PasskeyError(401, 'passkey_unauthorized', 'Sign in first.');

    let userId = null;

    try {
      userId = jwt.verify(match[1], secret());
    } catch {
      userId = null;
    }

    if (typeof userId !== 'string' || !userId) throw new PasskeyError(401, 'passkey_unauthorized', 'Sign in first.');

    const user = await findUser(userId);

    if (!user || blocked(user)) throw new PasskeyError(401, 'passkey_unauthorized', 'Sign in first.');
    if (user.type !== 'administrator') {
      throw new PasskeyError(403, 'passkey_forbidden', 'Only the administrator can manage passkeys.');
    }

    return user;
  }

  async function list(req) {
    const user = await admin(req);
    const all = passkeys();

    return {
      enabled: all.length > 0,
      rpID: expected(req).rpID,
      passkeys: all.map(({ id, name, createdAt, transports = [], userId }) => ({
        id,
        name,
        createdAt,
        transports,
        mine: userId === String(user.objectId),
      })),
    };
  }

  async function registerOptions(req) {
    const user = await admin(req);
    const { rpID } = expected(req);
    const userId = String(user.objectId);
    const { bytes, token } = challenges.issue('register', { u: userId });
    const options = await generateRegistrationOptions({
      rpName: rpName(),
      rpID,
      userName: user.email || user.display_name || userId,
      userDisplayName: user.display_name || user.email || userId,
      userID: new Uint8Array(Buffer.from(userId, 'utf8')),
      challenge: bytes,
      timeout: CHALLENGE_TTL,
      attestationType: 'none',
      excludeCredentials: passkeys()
        .filter((entry) => entry.userId === userId)
        .map(({ id, transports }) => ({ id, transports })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
    });

    return { options, challengeToken: token };
  }

  async function register(req) {
    const user = await admin(req);
    const body = await readBody(req);
    const payload = challenges.verify(body.challengeToken, 'register');
    const userId = String(user.objectId);

    if (payload.u !== userId) {
      throw new PasskeyError(400, 'passkey_challenge_invalid', 'The sign-in request is not valid. Try again.');
    }

    const { origin, rpID } = expected(req);
    let verification;

    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: payload.c,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      throw new PasskeyError(400, 'passkey_invalid', `The passkey could not be verified: ${err.message}`);
    }

    if (!verification.verified) throw new PasskeyError(400, 'passkey_invalid', 'The passkey could not be verified.');

    const { credential } = verification.registrationInfo;
    const current = passkeys();

    if (current.some((entry) => entry.id === credential.id)) {
      throw new PasskeyError(409, 'passkey_exists', 'This passkey is already configured.');
    }

    const entry = entryOf({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      userId,
      name: cleanName(body.name) || `Passkey ${current.length + 1}`,
      transports: credential.transports,
      createdAt: new Date(now()).toISOString(),
    });
    const next = [...current, entry];

    return { entry, passkeys: next, value: JSON.stringify(next) };
  }

  async function loginOptions(req) {
    limit(optionsLimit, req);

    if (!passkeys().length) {
      throw new PasskeyError(404, 'passkey_not_configured', 'Passkeys are not configured on this server.');
    }

    const { rpID } = expected(req);
    const { bytes, token } = challenges.issue('login');
    const options = await generateAuthenticationOptions({
      rpID,
      challenge: bytes,
      timeout: CHALLENGE_TTL,
      userVerification: 'required',
    });

    return { options, challengeToken: token };
  }

  async function login(req) {
    limit(verifyLimit, req);

    const body = await readBody(req);
    const all = passkeys();

    if (!all.length) {
      throw new PasskeyError(404, 'passkey_not_configured', 'Passkeys are not configured on this server.');
    }

    const payload = challenges.verify(body.challengeToken, 'login');
    const response = body.response && typeof body.response === 'object' ? body.response : {};
    const entry = all.find((item) => item.id === response.id);

    if (!entry) throw new PasskeyError(404, 'passkey_unknown', 'This passkey is not registered for this site.');

    const userHandle = response.response?.userHandle;

    if (userHandle && userHandle !== Buffer.from(entry.userId, 'utf8').toString('base64url')) {
      throw new PasskeyError(400, 'passkey_invalid', 'The passkey could not be verified.');
    }

    const { origin, rpID } = expected(req);
    let verification;

    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: payload.c,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: entry.id,
          publicKey: new Uint8Array(Buffer.from(entry.publicKey, 'base64url')),
          counter: 0,
          transports: entry.transports,
        },
        requireUserVerification: true,
      });
    } catch (err) {
      throw new PasskeyError(400, 'passkey_invalid', `The passkey could not be verified: ${err.message}`);
    }

    if (!verification.verified) throw new PasskeyError(400, 'passkey_invalid', 'The passkey could not be verified.');

    const user = await findUser(entry.userId);

    if (!user || blocked(user) || user.type !== 'administrator') {
      throw new PasskeyError(403, 'passkey_forbidden', 'This passkey belongs to an account that cannot sign in.');
    }

    let avatarUrl = (await avatar(user)) || '';
    const proxy = avatarProxy();

    if (proxy) avatarUrl = `${proxy}?url=${encodeURIComponent(avatarUrl)}`;

    return { ...user, avatar: avatarUrl, password: null, token: jwt.sign(user.objectId, secret()) };
  }

  const ROUTES = {
    '': { GET: list },
    'register/options': { POST: registerOptions },
    register: { POST: register },
    'login/options': { POST: loginOptions },
    login: { POST: login },
  };

  return async function route(req, res) {
    const url = String(req.url || '/');
    const mark = url.indexOf('?');
    const path = (mark === -1 ? url : url.slice(0, mark)).replace(/\/{2,}/gu, '/');

    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;

    const name = path.slice(PREFIX.length).replace(/^\/|\/$/gu, '');
    const methods = ROUTES[name];

    try {
      if (!methods) throw new PasskeyError(404, 'passkey_not_found', 'Not found.');

      const handler = methods[req.method];

      if (!handler) {
        res.setHeader('allow', Object.keys(methods).join(', '));
        throw new PasskeyError(405, 'passkey_method_not_allowed', 'Method not allowed.');
      }

      send(res, 200, { errno: 0, errmsg: '', data: await handler(req) });
    } catch (err) {
      if (err instanceof PasskeyError) {
        send(res, err.status, { errno: err.errno, errmsg: err.message });
      } else {
        console.error(err);
        send(res, 500, { errno: 'passkey_server_error', errmsg: 'Server error.' });
      }
    }

    return true;
  };
}

module.exports = { createPasskey, createChallenges, createLimiter, parsePasskeys, requestOrigin, CHALLENGE_TTL };
