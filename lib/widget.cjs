const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['waline.css', 'theme.css'];
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=300';

const COMMON = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
};

function send(req, res, status, headers, body = '') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);

  res.writeHead(status, { ...COMMON, ...headers, 'content-length': status === 304 ? 0 : payload.length });
  res.end(req.method === 'HEAD' || status === 304 ? undefined : payload);
}

const fresh = (req, etag) =>
  String(req.headers['if-none-match'] || '')
    .split(',')
    .some((tag) => tag.trim().replace(/^W\//u, '') === etag || tag.trim() === '*');

function createWidget({ dir = path.join(__dirname, '..', 'widget'), files = FILES } = {}) {
  let sheet = null;

  function load() {
    if (!sheet) {
      try {
        const body = Buffer.from(
          files
            .map((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim())
            .join('\n')
            .concat('\n'),
        );
        const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
        const manifest = Buffer.from(JSON.stringify({ css: `/widget.css?v=${hash}` }));

        sheet = { body, hash, etag: `"${hash}"`, manifest, manifestEtag: `"m-${hash}"` };
      } catch {
        return null;
      }
    }

    return sheet;
  }

  function unavailable(req, res) {
    send(req, res, 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Widget stylesheet is missing.\n');
  }

  function css(req, res, query) {
    const loaded = load();

    if (!loaded) return unavailable(req, res);

    const headers = {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': new URLSearchParams(query).get('v') === loaded.hash ? IMMUTABLE : SHORT,
      etag: loaded.etag,
    };
    const match = fresh(req, loaded.etag);

    return send(req, res, match ? 304 : 200, headers, match ? '' : loaded.body);
  }

  function manifest(req, res) {
    const loaded = load();

    if (!loaded) return unavailable(req, res);

    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      etag: loaded.manifestEtag,
    };
    const match = fresh(req, loaded.manifestEtag);

    return send(req, res, match ? 304 : 200, headers, match ? '' : loaded.manifest);
  }

  return function route(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const url = req.url || '/';
    const mark = url.indexOf('?');
    const pathname = mark === -1 ? url : url.slice(0, mark);
    const query = mark === -1 ? '' : url.slice(mark + 1);

    if (pathname === '/widget.css') css(req, res, query);
    else if (pathname === '/widget.json') manifest(req, res);
    else return false;

    return true;
  };
}

module.exports = { createWidget };
