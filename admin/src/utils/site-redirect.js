import { TRUSTED_ORIGINS, getToken } from './site.js';

const trustedExternal = (value) => {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value)) return null;

  try {
    const url = new URL(value);

    return url.origin === location.origin || !TRUSTED_ORIGINS.includes(url.origin) ? null : url;
  } catch {
    return null;
  }
};

export const externalReturn = (value) => {
  const url = trustedExternal(value);

  if (!url) return null;

  const token = getToken();

  if (token) url.searchParams.set('token', token);

  return url.href;
};
