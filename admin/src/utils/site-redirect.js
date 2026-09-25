import { TRUSTED_ORIGINS, getToken, safePath } from './site.js';

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

export const oauthReturn = (value) =>
  trustedExternal(value)
    ? `${location.origin}/login?redirect=${encodeURIComponent(value)}`
    : `${location.origin}${safePath(value) ?? '/profile'}`;
