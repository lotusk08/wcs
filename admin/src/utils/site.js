const trimSlash = (value) => String(value).replace(/\/+$/u, '');

export const SITE_URL = trimSlash(window.SITE_URL || 'https://stevehoang.com');

const COMMENTS_PREFIX = /^comments\b\s*[·|:\-–—]?\s*/iu;

export const SITE_NAME = String(window.SITE_NAME || 'Steve Hoang').replace(COMMENTS_PREFIX, '') || 'Steve Hoang';

export const SITE_TITLE = `Comments · ${SITE_NAME}`;

export const API_BASE = (() => {
  const base = window.serverURL || `${location.origin}/api/`;

  return base.endsWith('/') ? base : `${base}/`;
})();

export const SOCIALS = Array.isArray(window.oauthServices)
  ? window.oauthServices.map(({ name }) => name)
  : ['oidc', 'qq', 'weibo', 'github', 'twitter', 'facebook'];

const siteOrigin = (() => {
  try {
    return new URL(SITE_URL).origin;
  } catch {
    return '';
  }
})();

export const TRUSTED_ORIGINS = [
  ...new Set(
    [siteOrigin, location.origin, ...(Array.isArray(window.ALLOWED_ORIGINS) ? window.ALLOWED_ORIGINS : [])].filter(Boolean),
  ),
];

export const postToOpener = (message) => {
  if (!window.opener) return;

  for (const origin of TRUSTED_ORIGINS) {
    try {
      window.opener.postMessage(message, origin);
    } catch {
      // opener gone or origin mismatch
    }
  }
};

export const safePath = (value) => {
  if (typeof value !== 'string' || !value) return null;

  const raw = value.trim();
  const relative = raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\');
  const absolute = raw.startsWith(`${location.origin}/`);

  if (!relative && !absolute) return null;

  try {
    const url = new URL(raw, location.origin);

    if (url.origin !== location.origin) return null;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const siteLink = (url = '') => {
  if (!url) return SITE_URL;
  if (/^https?:\/\//iu.test(url)) return url;

  return `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const postLink = (url = '') => {
  const value = String(url ?? '').trim();

  if (!value) return SITE_URL;
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return `${SITE_URL}${value}`;

  try {
    const resolved = new URL(value, `${SITE_URL}/`);

    if (resolved.origin === siteOrigin) return resolved.href;

    return `${SITE_URL}/${resolved.pathname.replace(/^\/+/u, '')}${resolved.search}${resolved.hash}`;
  } catch {
    return SITE_URL;
  }
};

export const externalLink = (url = '') => {
  if (!url) return '';

  return /^https?:\/\//iu.test(url) ? url : `https://${url}`;
};

export const resolveContent = (html = '') => {
  const template = document.createElement('template');

  template.innerHTML = html;

  for (const node of template.content.querySelectorAll('[src], [href]')) {
    for (const attr of ['src', 'href']) {
      const value = node.getAttribute(attr);

      if (value && value.startsWith('/') && !value.startsWith('//')) {
        node.setAttribute(attr, `${SITE_URL}${value}`);
      }
    }

    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  }

  return template.innerHTML;
};

export const storage = {
  get(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      window[area].setItem(key, value);
    } catch {
      // storage unavailable
    }
  },
  remove(area, key) {
    try {
      window[area].removeItem(key);
    } catch {
      // storage unavailable
    }
  },
};

export const getToken = () =>
  window.TOKEN || storage.get('sessionStorage', 'TOKEN') || storage.get('localStorage', 'TOKEN');
