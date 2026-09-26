import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router';

import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import { useCaptcha } from '../../components/useCaptcha.js';
import { passkeyLoginOptions } from '../../services/passkey.js';
import { get2FAStatus } from '../../services/user.js';
import { takeSessionExpired } from '../../store/user.js';
import {
  WebAuthnAbortService,
  ceremony,
  describePasskey,
  isAborted,
  passkeyAutofill,
  passkeySupported,
  startAuthentication,
} from '../../utils/passkey.js';
import { SITE_NAME, safePath } from '../../utils/site.js';
import { externalReturn } from '../../utils/site-redirect.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE = /^\d{6}$/u;
const AUTOFILL_REFRESH = 4 * 60 * 1000;
const STEP = 'verify';

const digitsOf = (value) => String(value ?? '').replace(/\D+/gu, '').slice(0, 6);

const searchWithout = (search, key) => {
  const params = new URLSearchParams(search);

  params.delete(key);

  const rest = params.toString();

  return rest ? `?${rest}` : '';
};

const searchWith = (search, key, value) => {
  const params = new URLSearchParams(search);

  params.set(key, value);

  return `?${params.toString()}`;
};

export default function Login() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => (takeSessionExpired() ? t('session expired') : false));
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [code, setCode] = useState('');
  const pending = useRef(null);
  const focusNext = useRef(null);
  const busy = useRef(false);
  const formRef = useRef(null);
  const codeInput = useRef(null);
  const autofill = useRef(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyOn = useMemo(() => passkeySupported(), []);
  const execute = useCaptcha({
    sitekey: window.turnstileKey ?? window.recaptchaV3Key,
    hideDefaultBadge: true,
  });

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const redirect = params.get('redirect') ?? '';
  const wantsCode = params.get('step') === STEP;
  const verifying = wantsCode && Boolean(pendingEmail);

  useEffect(() => {
    if (!user?.objectId) {
      return;
    }

    const external = externalReturn(redirect);

    if (external) {
      window.location.href = external;
      return;
    }

    const isAdmin = user.type === 'administrator';
    const fallback = isAdmin ? '/' : '/profile';
    const target = safePath(redirect);

    navigate(target && !/^\/(login|register|forgot)\b/u.test(target) ? target : fallback, {
      replace: true,
    });
  }, [user, redirect, navigate]);

  useEffect(() => {
    if (wantsCode && !pending.current) {
      navigate({ pathname: location.pathname, search: searchWithout(location.search, 'step') }, { replace: true });
    } else if (!wantsCode && pending.current) {
      pending.current = null;
      focusNext.current ??= 'password';
      setPendingEmail('');
      setCode('');
      setError(false);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCode]);

  useEffect(() => {
    if (verifying) {
      codeInput.current?.focus();

      return;
    }

    const target = focusNext.current;

    focusNext.current = null;
    if (!target) return;

    const field = formRef.current?.[target];

    field?.focus();
    if (target === 'email') field?.select();
  }, [verifying]);

  const leaveCode = (focus = 'password') => {
    if (busy.current) return;
    focusNext.current = focus;
    if (location.state?.step === STEP) {
      navigate(-1);
    } else {
      navigate({ pathname: location.pathname, search: searchWithout(location.search, 'step') }, { replace: true });
    }
  };

  const leaveRef = useRef(leaveCode);

  leaveRef.current = leaveCode;

  useEffect(() => {
    if (!verifying) return undefined;

    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      leaveRef.current('password');
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [verifying]);

  const finishPasskey = async (response, challengeToken) => {
    busy.current = true;
    setPasskeyBusy(true);
    setError(false);

    try {
      await dispatch.user.passkeyLogin({ response, challengeToken, remember });

      return true;
    } catch (err) {
      setError(describePasskey(t, err));

      return false;
    } finally {
      busy.current = false;
      setPasskeyBusy(false);
    }
  };

  const finishRef = useRef(finishPasskey);

  finishRef.current = finishPasskey;

  useEffect(() => {
    if (!passkeyOn || verifying) return undefined;

    let alive = true;
    let timer = null;
    let generation = 0;

    const run = async () => {
      generation += 1;

      const id = generation;
      const current = () => alive && id === generation;

      clearTimeout(timer);
      if (!(await passkeyAutofill()) || !current()) return;

      let data;

      try {
        data = await passkeyLoginOptions();
      } catch {
        return;
      }

      if (!current()) return;
      timer = setTimeout(run, AUTOFILL_REFRESH);

      let response;

      try {
        response = await startAuthentication({ optionsJSON: data.options, useBrowserAutofill: true });
      } catch {
        if (current()) clearTimeout(timer);
        return;
      }

      clearTimeout(timer);
      if (!alive || busy.current) return;
      if (!(await finishRef.current(response, data.challengeToken)) && alive) run();
    };

    autofill.current = {
      run,
      stop() {
        generation += 1;
        clearTimeout(timer);
      },
    };
    run();

    return () => {
      alive = false;
      autofill.current = null;
      clearTimeout(timer);
      WebAuthnAbortService.cancelCeremony();
    };
  }, [passkeyOn, verifying]);

  const onPasskey = async () => {
    if (busy.current) return;

    busy.current = true;
    autofill.current?.stop();
    setPasskeyBusy(true);
    setError(false);

    let response;
    let challengeToken;

    try {
      const data = await passkeyLoginOptions();

      challengeToken = data.challengeToken;
      response = await ceremony(() => startAuthentication({ optionsJSON: data.options }), data.options.timeout);
    } catch (err) {
      if (!isAborted(err)) setError(describePasskey(t, err));
      busy.current = false;
      setPasskeyBusy(false);
      autofill.current?.run();

      return;
    }

    if (!(await finishPasskey(response, challengeToken))) autofill.current?.run();
  };

  const describe = (err, withCode) => {
    if (err?.errno === 'network') return t('network error');
    if (err?.status === 403) return t('captcha failed');
    if (err?.status === 429) return t('too many attempts');
    if (err?.status >= 500) return t('server error');
    if (err?.errno === 1001) return t('please input a valid email');

    return withCode ? t('2fa code error') : t('email or password error');
  };

  const captcha = async () => {
    try {
      const token = await execute('login');

      return { ok: true, recaptchaV3: window.recaptchaV3Key ? token : undefined, turnstile: window.turnstileKey ? token : undefined };
    } catch {
      return { ok: false };
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (busy.current) return;

    const form = event.currentTarget;
    const address = form.email.value.trim();
    const password = form.password.value;

    if (!address) {
      form.email.focus();
      return setError(t('please input email'));
    }

    if (!EMAIL.test(address)) {
      form.email.focus();
      return setError(t('please input a valid email'));
    }

    if (!password) {
      form.password.focus();
      return setError(t('please input password'));
    }

    busy.current = true;
    setLoading(true);
    setError(false);
    setEmail(address);

    try {
      let enabled = null;

      try {
        enabled = Boolean((await get2FAStatus(address)).enable);
      } catch (err) {
        if (err?.errno === 'network' || err?.status >= 500) {
          setError(describe(err, false));
          return;
        }
      }

      if (enabled) {
        pending.current = { email: address, password, remember };
        form.password.value = '';
        setCode('');
        setPendingEmail(address);
        navigate(
          { pathname: location.pathname, search: searchWith(location.search, 'step', STEP) },
          { state: { step: STEP } },
        );
        return;
      }

      const check = await captcha();

      if (!check.ok) {
        setError(t('captcha failed'));
        return;
      }

      try {
        await dispatch.user.login({
          email: address,
          password,
          remember,
          recaptchaV3: check.recaptchaV3,
          turnstile: check.turnstile,
        });
      } catch (err) {
        setError(describe(err, false));
        form.password.select();
        form.password.focus();
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const verify = async (value) => {
    if (busy.current || !pending.current) return;

    if (!value) {
      codeInput.current?.focus();
      setError(t('please input 2fa code'));
      return;
    }

    if (!CODE.test(value)) {
      codeInput.current?.focus();
      setError(t('2fa code format'));
      return;
    }

    busy.current = true;
    setLoading(true);
    setError(false);

    let signedIn = false;

    try {
      const check = await captcha();

      if (!check.ok) {
        setError(t('captcha failed'));
        return;
      }

      const { email: address, password, remember: keep } = pending.current;

      try {
        await dispatch.user.login({
          email: address,
          password,
          code: value,
          remember: keep,
          recaptchaV3: check.recaptchaV3,
          turnstile: check.turnstile,
        });
        signedIn = true;
        pending.current = null;
      } catch (err) {
        setError(describe(err, true));
        setCode('');
      }
    } finally {
      busy.current = false;
      setLoading(false);
      if (!signedIn) requestAnimationFrame(() => codeInput.current?.focus());
    }
  };

  const onCodeChange = (event) => {
    const value = digitsOf(event.target.value);

    setCode(value);
    if (value.length === 6) verify(value);
  };

  const onCodePaste = (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    const value = digitsOf(text);

    if (!value) return;
    event.preventDefault();
    setCode(value);
    if (value.length === 6) verify(value);
  };

  const onVerify = (event) => {
    event.preventDefault();
    verify(digitsOf(code));
  };

  const keepQuery = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';
  const dismiss = () => setError(false);

  if (verifying) {
    return (
      <Layout narrow>
        <section className="auth auth-verify" aria-labelledby="verify-title">
          <span className="auth-badge" aria-hidden="true">
            <Icon name="shield" size={24} />
          </span>
          <h1 className="page-title" id="verify-title">
            {t('two-step verification')}
          </h1>
          <p className="auth-lede" id="verify-lede">
            {t('enter the 6-digit code')}
          </p>
          <div className="auth-account">
            <span className="auth-account-email">{pendingEmail}</span>
            <button type="button" className="link-btn act-other-account" onClick={() => leaveCode('email')} disabled={loading}>
              {t('use a different account')}
            </button>
          </div>

          <Notice onClose={dismiss} id="verify-error">
            {error}
          </Notice>

          <form name="verify" method="post" className="form" onSubmit={onVerify} aria-busy={loading} noValidate>
            <input type="text" name="username" autoComplete="username" value={pendingEmail} readOnly hidden />
            <label className="field">
              <span className="field-label">{t('2fa code')}</span>
              <input
                ref={codeInput}
                type="text"
                name="code"
                className="input input-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                autoFocus
                required
                value={code}
                readOnly={loading}
                onChange={onCodeChange}
                onPaste={onCodePaste}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'verify-error verify-lede' : 'verify-lede'}
              />
            </label>
            <button type="submit" className="btn btn-primary btn-block btn-verify" disabled={loading} aria-busy={loading}>
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              <span>{loading ? t('verifying code') : t('verify code')}</span>
            </button>
          </form>

          <p className="auth-links">
            <button type="button" className="link-btn act-back" onClick={() => leaveCode('password')} disabled={loading}>
              <Icon name="prev" size={18} />
              <span>{t('back to password')}</span>
            </button>
          </p>
          <div className="captcha-container" />
        </section>
      </Layout>
    );
  }

  return (
    <Layout narrow>
      <section className="auth">
        <h1 className="page-title">{t('login')}</h1>
        <p className="auth-lede">
          {SITE_NAME} · {t('comments')}
        </p>

        <Notice onClose={dismiss}>{error}</Notice>

        {passkeyOn ? (
          <div className="passkey-login">
            <button
              type="button"
              className="btn btn-primary btn-block btn-passkey"
              onClick={onPasskey}
              disabled={loading || passkeyBusy}
              aria-busy={passkeyBusy}
            >
              <Icon name="passkey" size={20} />
              <span>{passkeyBusy ? t('loading') : t('sign in with passkey')}</span>
            </button>
            <p className="auth-divider">
              <span>{t('or use password')}</span>
            </p>
          </div>
        ) : null}

        <form
          ref={formRef}
          method="post"
          name="login"
          className="form"
          onSubmit={onSubmit}
          aria-busy={loading}
          noValidate
        >
          <label className="field">
            <span className="field-label">{t('email')}</span>
            <input
              type="email"
              name="email"
              autoComplete={passkeyOn ? 'username webauthn' : 'username'}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              className="input"
              defaultValue={email}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('password')}</span>
            <input type="password" name="password" autoComplete="current-password" required className="input" />
          </label>
          <div className="form-row">
            <label className="check">
              <input
                type="checkbox"
                name="remember"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />{' '}
              <span>{t('remember me')}</span>
            </label>
            <Link to={`/forgot${keepQuery}`}>{t('forgot password')}</Link>
          </div>
          <button
            type="submit"
            className={passkeyOn ? 'btn btn-block btn-login' : 'btn btn-primary btn-block btn-login'}
            disabled={loading || passkeyBusy}
            aria-busy={loading}
          >
            {loading ? t('loading') : t('login')}
          </button>
        </form>
        <div className="captcha-container" />
      </section>
    </Layout>
  );
}
