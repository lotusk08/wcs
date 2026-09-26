import I18n from '../i18n.js';
import { API_BASE, getToken } from './site.js';

export class RequestError extends Error {
  constructor(message, { status = 0, errno, data } = {}) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.errno = errno;
    this.data = data;
  }
}

const messageOf = (result) => {
  const errmsg = result?.errmsg;

  if (typeof errmsg === 'string') return errmsg;
  if (errmsg && typeof errmsg === 'object') {
    return Object.values(errmsg)
      .filter((value) => typeof value === 'string' && value)
      .join(' ');
  }

  return '';
};

export default async function request(url, opts = {}) {
  const { auth = true, ...options } = typeof url === 'object' ? { ...url } : { ...opts, url };

  options.headers ??= {};
  if (options.body && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const token = auth ? getToken() : null;

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  const joiner = options.url.includes('?') ? '&' : '?';
  let resp;

  try {
    resp = await fetch(`${API_BASE}${options.url}${joiner}lang=${I18n.language}`, options);
  } catch {
    throw new RequestError(I18n.t('network error'), { errno: 'network' });
  }

  let result = null;

  try {
    result = await resp.json();
  } catch {
    // not JSON
  }

  if (!resp.ok) {
    if (resp.status === 401) {
      throw new RequestError('401', { status: 401, errno: 401 });
    }

    throw new RequestError(`${resp.status}: ${messageOf(result) || resp.statusText}`, {
      status: resp.status,
      errno: result?.errno ?? resp.status,
    });
  }

  if (!result || result.errno !== 0) {
    throw new RequestError(messageOf(result) || I18n.t('request failed'), {
      status: resp.status,
      errno: result?.errno ?? 'invalid',
      data: result?.data,
    });
  }

  // oxlint-disable-next-line no-underscore-dangle
  const __version = resp.headers.get('x-waline-version');

  return { __version, ...result.data };
}
