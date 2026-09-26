const crypto = require('node:crypto');
const fs = require('node:fs');

const { clientIp, parsePasskeys, requestOrigin: origin } = require('./passkey.cjs');

const UI_ROUTE = /^\/(?:login|forgot|profile|user|migration|thread)?\/?$/u;
const REGISTER_ROUTE = /^\/register\/?$/u;
const UNSAFE = /[<>&\u2028\u2029]/gu;
const UNSAFE_MAP = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};
const HTML_MAP = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '\u2028': '&#8232;',
  '\u2029': '&#8233;',
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};
const CAPTCHA_ORIGINS = [
  'https://recaptcha.net',
  'https://www.recaptcha.net',
  'https://www.google.com',
  'https://www.gstatic.com',
  'https://challenges.cloudflare.com',
];
const CAPTCHA_FRAMES = ['https://www.recaptcha.net', 'https://www.google.com', 'https://challenges.cloudflare.com'];

const SHELL_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-cache',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

const script = (value) =>
  value === undefined ? 'undefined' : JSON.stringify(value).replace(UNSAFE, (c) => UNSAFE_MAP[c]);

const html = (value) => String(value).replace(/[<>&"'\u2028\u2029]/gu, (c) => HTML_MAP[c]);

const decode = (path) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
};

const originOf = (value) => {
  try {
    const url = new URL(String(value || '').trim());

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
};

const origins = (list) =>
  String(list || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\/[^/?#]+$/iu.test(item))
    .map(originOf)
    .filter(Boolean);

function pathOf(url = '/') {
  if (url.startsWith('/')) return url;

  try {
    const parsed = new URL(url);

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}

function send(req, res, status, headers, body = '') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);

  res.writeHead(status, { ...headers, 'content-length': payload.length });
  res.end(req.method === 'HEAD' || status === 304 ? undefined : payload);
}

function walineControllers(path, netlifyPrefix) {
  const found = new Set();

  for (const start of [path, path.replace(/\/{2,}/gu, '/')]) {
    let rest = start.toLowerCase();
    const prefix = ['/api', netlifyPrefix.toLowerCase()].find((item) => rest.startsWith(item));

    if (prefix) rest = rest.slice(prefix.length);
    if (rest.endsWith('.html')) rest = rest.slice(0, -5);
    rest = rest.replace(/^\/|\/$/gu, '').replace(/\/{2,}/gu, '/');

    const nested = ['user/password', 'token/2fa', 'comment/rss'].find((name) => rest === name || rest.startsWith(`${name}/`));

    found.add(nested ?? rest.split('/')[0]);
  }

  return found;
}

function createLoginGuard({ limit = 10, window = 15 * 60 * 1000, now = Date.now, max = 5000 } = {}) {
  const failures = new Map();

  const live = (ip) => {
    const entry = failures.get(ip);

    if (entry && entry.reset <= now()) {
      failures.delete(ip);
      return null;
    }

    return entry || null;
  };

  const record = (ip, body) => {
    let errno;

    try {
      ({ errno } = JSON.parse(body));
    } catch {
      return;
    }

    if (errno === 0) {
      failures.delete(ip);
      return;
    }

    let entry = live(ip);

    if (!entry) {
      if (failures.size >= max) {
        for (const [key, value] of failures) if (value.reset <= now()) failures.delete(key);
        while (failures.size >= max) failures.delete(failures.keys().next().value);
      }
      entry = { count: 0, reset: now() + window };
      failures.set(ip, entry);
    }
    entry.count += 1;
  };

  return {
    retryAfter: (ip) => {
      const entry = live(ip);

      return entry && entry.count >= limit ? Math.max(1, Math.ceil((entry.reset - now()) / 1000)) : 0;
    },
    watch(ip, res) {
      const chunks = [];
      let size = 0;
      const keep = (chunk, encoding) => {
        if (!chunk || typeof chunk === 'function' || size > 65536) return;

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');

        size += buffer.length;
        chunks.push(buffer);
      };
      const { write, end } = res;

      res.write = function (chunk, encoding, ...rest) {
        keep(chunk, encoding);

        return write.call(this, chunk, encoding, ...rest);
      };
      res.end = function (chunk, encoding, ...rest) {
        keep(chunk, encoding);
        if (size <= 65536) record(ip, Buffer.concat(chunks).toString('utf8'));

        return end.call(this, chunk, encoding, ...rest);
      };
    },
  };
}

function createUi({
  bundlePath,
  env = process.env,
  passkeyEnabled = () => parsePasskeys(env.PASSKEYS).length > 0,
  loginLimit = {},
} = {}) {
  let bundle = null;
  const logins = createLoginGuard(loginLimit);
  const siteUrl = env.SITE_URL || 'https://stevehoang.com';
  const serverUrl = originOf(env.SERVER_URL) ? String(env.SERVER_URL).trim().replace(/\/+$/u, '') : null;
  const allowedOrigins = origins(env.ALLOWED_ORIGINS);
  const avatarProxy = String(env.AVATAR_PROXY || '').trim();
  const avatarProxyOn = Boolean(avatarProxy) && !['0', 'false'].includes(avatarProxy.toLowerCase());
  const defaultAvatar = String(env.DEFAULT_AVATAR || '').trim() || undefined;

  const apiBase = (req) => `${serverUrl || origin(req.headers)}/api/`;

  const netlifyPrefix = `/.netlify/functions/${String(env._HANDLER).replace(/\.handler$/u, '')}`;
  const registerOpen = () => String(env.ALLOW_REGISTER || '').trim().toLowerCase() === 'true';

  function loadBundle() {
    if (!bundle) {
      try {
        const body = fs.readFileSync(bundlePath);
        const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);

        bundle = { body, hash, etag: `"${hash}"` };
      } catch {
        return null;
      }
    }

    return bundle;
  }

  function csp(req, nonce, serverURL) {
    const connect = new Set(["'self'", originOf(serverURL), 'https://registry.npmjs.org', ...CAPTCHA_ORIGINS]);

    connect.delete(origin(req.headers));
    connect.delete(null);

    return [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' ${CAPTCHA_ORIGINS.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      'img-src * data: blob:',
      "font-src 'self' https://stevehoang.com data:",
      `connect-src ${[...connect].join(' ')}`,
      `frame-src ${CAPTCHA_FRAMES.join(' ')}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
  }

  function shell(req, res) {
    const name = env.SITE_NAME || 'Steve Hoang';
    const title = /^comments\b/iu.test(name) ? name : `Comments · ${name}`;
    const loaded = loadBundle();
    const src = loaded ? `/admin.js?v=${loaded.hash}` : '/admin.js';
    const nonce = crypto.randomBytes(16).toString('base64');
    const serverURL = apiBase(req);
    const globals = {
      SITE_URL: siteUrl,
      SITE_NAME: name,
      recaptchaV3Key: env.RECAPTCHA_V3_KEY || undefined,
      turnstileKey: env.TURNSTILE_KEY || undefined,
      oauthServices: [],
      serverURL,
      ALLOWED_ORIGINS: allowedOrigins,
      AVATAR_PROXY: avatarProxyOn ? avatarProxy : undefined,
      DEFAULT_AVATAR: defaultAvatar,
      PASSKEY_ENABLED: passkeyEnabled() === true,
    };
    const lines = Object.entries(globals).map(([key, value]) => `      window.${key} = ${script(value)};`);

    send(
      req,
      res,
      200,
      { ...SHELL_HEADERS, 'content-security-policy': csp(req, nonce, serverURL) },
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1b1b1e" media="(prefers-color-scheme: dark)">
    <title>${html(title)}</title>
    <link rel="icon" href="https://stevehoang.com/favicon.ico">
    <script nonce="${nonce}">
${lines.join('\n')}
    </script>
    <script type="module" src="${src}"></script>
  </head>
  <body></body>
</html>
`,
    );
  }

  function asset(req, res, query) {
    const loaded = loadBundle();

    if (!loaded) {
      return send(req, res, 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Admin bundle is not built.\n');
    }

    const headers = {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control':
        new URLSearchParams(query).get('v') === loaded.hash
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300',
      etag: loaded.etag,
      'x-content-type-options': 'nosniff',
    };
    const match = String(req.headers['if-none-match'] || '')
      .split(',')
      .some((tag) => tag.trim().replace(/^W\//u, '') === loaded.etag || tag.trim() === '*');

    return send(req, res, match ? 304 : 200, headers, match ? '' : loaded.body);
  }

  function redirect(req, res, path, query) {
    const target = path
      .slice(3)
      .replace(/\\/gu, '/')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    const location = `/${target}${path.endsWith('/') && target ? '/' : ''}${query ? `?${query}` : ''}`;

    return send(req, res, 301, { location, 'cache-control': 'public, max-age=3600' });
  }

  return async function route(req, res) {
    const url = pathOf(req.url);
    const mark = url.indexOf('?');
    const rawPath = mark === -1 ? url : url.slice(0, mark);
    const query = mark === -1 ? '' : url.slice(mark + 1);
    const path = decode(rawPath);

    if (path === null || path.replace(/\\/gu, '/').split('/').includes('..')) {
      send(req, res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found.\n');
      return true;
    }

    const controllers = walineControllers(path, netlifyPrefix);

    if (controllers.has('oauth')) {
      send(req, res, 404, JSON_HEADERS, JSON.stringify({ errno: 404, errmsg: 'Social login is disabled.' }));
      return true;
    }

    if (req.method === 'POST' && controllers.has('user') && !registerOpen()) {
      send(req, res, 403, JSON_HEADERS, JSON.stringify({ errno: 403, errmsg: 'Registration is closed.' }));
      return true;
    }

    if (req.method === 'POST' && controllers.has('token')) {
      const ip = clientIp(req);
      const wait = logins.retryAfter(ip);

      if (wait) {
        send(req, res, 429, { ...JSON_HEADERS, 'retry-after': String(wait) }, JSON.stringify({ errno: 429, errmsg: 'Too many sign-in attempts. Wait a few minutes and try again.' }));
        return true;
      }
      logins.watch(ip, res);

      return false;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    if (path === '/ui' || path.startsWith('/ui/') || path.startsWith('/ui\\')) {
      redirect(req, res, path, query);
    } else if (path === '/admin.js') {
      asset(req, res, query);
    } else if (REGISTER_ROUTE.test(path)) {
      send(req, res, 302, { location: `/login${query ? `?${query}` : ''}`, 'cache-control': 'no-cache' });
    } else if (UI_ROUTE.test(path)) {
      shell(req, res);
    } else {
      return false;
    }

    return true;
  };
}

module.exports = { createUi };
