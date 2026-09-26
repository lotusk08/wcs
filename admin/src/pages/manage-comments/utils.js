import { SITE_NAME, SITE_URL, postLink, siteLink } from '../../utils/site.js';

const AVATAR_PROXY = typeof window.AVATAR_PROXY === 'string' ? window.AVATAR_PROXY.trim() : '';

export const DEFAULT_AVATAR =
  (typeof window.DEFAULT_AVATAR === 'string' && window.DEFAULT_AVATAR.trim()) || `${SITE_URL}/assets/img/site/cat-avatar.png`;

export const buildAvatar = (avatar = '') => {
  const value = String(avatar ?? '').trim();

  if (!value) return '';

  const url = value.startsWith('/') && !value.startsWith('//') ? siteLink(value) : value;

  if (AVATAR_PROXY && /^https?:\/\//iu.test(url) && !url.includes(AVATAR_PROXY)) {
    return `${AVATAR_PROXY}?url=${encodeURIComponent(url)}`;
  }

  return url;
};

export const getPostUrl = (url) => postLink(url);

export const postPath = (url) => {
  try {
    const target = new URL(getPostUrl(url));

    return decodeURI(`${target.pathname}${target.search}`);
  } catch {
    return url;
  }
};

export const postTitle = (url) => {
  const segment = postPath(url)
    .replace(/[?#].*$/u, '')
    .split('/')
    .filter(Boolean)
    .at(-1);

  if (!segment) return SITE_NAME;

  const words = segment
    .replace(/\.(?:html?|php|aspx?)$/iu, '')
    .replaceAll(/[-_+]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return words ? `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}` : SITE_NAME;
};

export const excerpt = (html = '', max = 140) => {
  const template = document.createElement('template');

  template.innerHTML = html;

  for (const img of template.content.querySelectorAll('img[alt]')) {
    img.replaceWith(img.getAttribute('alt'));
  }

  const text = template.content.textContent.replaceAll(/\s+/gu, ' ').trim();

  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const commentTime = (comment) => {
  const date = parseDate(comment?.insertedAt ?? comment?.time);
  const value = date.getTime();

  return Number.isNaN(value) ? 0 : value;
};

const padZero = (num) => (num < 10 ? `0${num}` : num);

export const parseDate = (time) =>
  typeof time === 'number'
    ? new Date(time)
    : new Date(/\d+-\d+-\d+\s\d+:\d+:\d+/u.test(time) ? time.replaceAll('-', '/') : time);

export const formatDate = (time) => {
  const date = parseDate(time);

  const localDate = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((item) => padZero(item))
    .join('-');
  const localTime = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((item) => padZero(item))
    .join(':');

  return `${localDate} ${localTime}`;
};

const LOCALES = { jp: 'ja' };

const UNITS = [
  ['minute', 60, 60],
  ['hour', 3600, 24],
  ['day', 86_400, 7],
];

export const relativeDate = (time, language = 'en', now = Date.now()) => {
  const date = parseDate(time);
  const locale = LOCALES[language] ?? language;
  const seconds = Math.max(0, (now - date.getTime()) / 1000);

  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return null;

  for (const [unit, size, limit] of UNITS) {
    const value = Math.floor(seconds / size);

    if (value < limit) {
      try {
        return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value);
      } catch {
        return `${value}${unit[0]}`;
      }
    }
  }

  const options =
    date.getFullYear() === new Date(now).getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' };

  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return formatDate(time).slice(0, 10);
  }
};

export const hasRegion = (addr) => Boolean(addr) && !String(addr).includes('内网IP');
