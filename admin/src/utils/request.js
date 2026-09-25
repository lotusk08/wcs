import I18n from '../i18n.js';
import { API_BASE, getToken } from './site.js';

export default async function request(url, opts = {}) {
  const options = typeof url === 'object' ? { ...url } : { ...opts, url };

  options.headers ??= {};
  if (options.body && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const token = getToken();

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  const joiner = options.url.includes('?') ? '&' : '?';
  const resp = await fetch(`${API_BASE}${options.url}${joiner}lang=${I18n.language}`, options);

  if (!resp.ok) {
    if (resp.status === 401) {
      throw new Error(401);
    }

    let result;

    try {
      result = await resp.json();
    } catch {
      // ignore
    }

    throw new Error(`${resp.status}: ${result?.errmsg ?? resp.statusText}`);
  }

  const result = await resp.json();

  if (result.errno !== 0) {
    throw new Error(result.errmsg);
  }

  // oxlint-disable-next-line no-underscore-dangle
  const __version = resp.headers.get('x-waline-version');

  return { __version, ...result.data };
}
