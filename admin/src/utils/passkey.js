import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

export { WebAuthnAbortService, startAuthentication, startRegistration };

export const passkeySupported = () => {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
};

export const passkeyEnabled = () => window.PASSKEY_ENABLED === true && passkeySupported();

export const passkeyAutofill = () => browserSupportsWebAuthnAutofill().catch(() => false);

export const isAborted = (err) => err?.code === 'ERROR_CEREMONY_ABORTED' || err?.name === 'AbortError';

const MESSAGES = {
  passkey_unknown: 'passkey unknown',
  passkey_not_configured: 'passkey not configured',
  passkey_challenge_expired: 'passkey expired',
  passkey_challenge_used: 'passkey expired',
  passkey_rate_limited: 'passkey rate limited',
  passkey_forbidden: 'passkey forbidden',
  passkey_exists: 'passkey exists',
};

export const describePasskey = (t, err, { register = false } = {}) => {
  if (err?.name === 'NotAllowedError') {
    if (err.timedOut) return t('passkey timeout');

    return t(register ? 'passkey register cancelled' : 'passkey cancelled');
  }
  if (err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return t('passkey exists');
  if (err?.errno === 'network') return t('network error');
  if (MESSAGES[err?.errno]) return t(MESSAGES[err.errno]);
  if (err?.status === 429) return t('passkey rate limited');
  if (err?.status >= 500) return t('server error');

  return t(register ? 'passkey register failed' : 'passkey failed');
};

export const ceremony = async (run, timeout = 300000) => {
  const started = Date.now();

  try {
    return await run();
  } catch (err) {
    err.timedOut = Date.now() - started >= timeout - 2000;
    throw err;
  }
};
