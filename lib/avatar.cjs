const crypto = require('node:crypto');

const nunjucks = require('nunjucks');

const CAT = 'https://stevehoang.com/assets/img/cat.webp';
const LIBRAVATAR = 'https://seccdn.libravatar.org/avatar/{{mail | trim | lower | md5}}';

const GRAVATAR_HOST = /(^|\.)(gravatar\.com|libravatar\.org|cravatar\.(cn|com)|weavatar\.com|loli\.net|geekzu\.org)$/i;

const hash = (algorithm) => (value) =>
  crypto.createHash(algorithm).update(String(value ?? '')).digest('hex');

const guest = (comment) => Object.hasOwn(comment, 'user_id') && !comment.user_id;

function withDefault(url, fallback) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!GRAVATAR_HOST.test(parsed.hostname) || !parsed.pathname.includes('/avatar/')) return url;
  parsed.searchParams.delete('default');
  parsed.searchParams.set('d', fallback);
  return parsed.toString();
}

function createAvatar(env = process.env) {
  const renderer = new nunjucks.Environment();
  renderer.addFilter('md5', hash('md5'));
  renderer.addFilter('sha256', hash('sha256'));
  const template = env.GRAVATAR_STR || LIBRAVATAR;

  return (comment = {}) => {
    if (guest(comment)) return CAT;
    const url = renderer.renderString(template, comment).trim();
    return url ? withDefault(url, CAT) : CAT;
  };
}

module.exports = { createAvatar, withDefault };
