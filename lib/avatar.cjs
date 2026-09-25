const crypto = require('node:crypto');

const nunjucks = require('nunjucks');

const WALINE_TEMPLATE = `{%- set numExp = r/^[0-9]+$/g -%}
{%- set qqMailExp = r/^[0-9]+@qq.com$/ig -%}
{%- if numExp.test(nick) -%}
  https://q1.qlogo.cn/g?b=qq&nk={{nick}}&s=100
{%- elif qqMailExp.test(mail) -%}
  https://q1.qlogo.cn/g?b=qq&nk={{mail|replace('@qq.com', '')}}&s=100
{%- else -%}
  https://seccdn.libravatar.org/avatar/{{mail | trim | lower | md5}}
{%- endif -%}`;

const GRAVATAR_HOST = /(^|\.)(gravatar\.com|libravatar\.org|cravatar\.(cn|com)|weavatar\.com|loli\.net|geekzu\.org)$/i;

const hash = (algorithm) => (value) =>
  crypto.createHash(algorithm).update(String(value ?? '')).digest('hex');

function defaultAvatar(env) {
  if (env.DEFAULT_AVATAR) return env.DEFAULT_AVATAR;
  const site = (env.SITE_URL || 'https://stevehoang.com').replace(/\/+$/, '');
  return `${site}/assets/img/site/cat-avatar.png`;
}

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
  const template = env.GRAVATAR_STR || WALINE_TEMPLATE;
  const fallback = defaultAvatar(env);

  return (comment = {}) => {
    const url = renderer.renderString(template, comment).trim();
    return url ? withDefault(url, fallback) : fallback;
  };
}

module.exports = { createAvatar, defaultAvatar, withDefault };
