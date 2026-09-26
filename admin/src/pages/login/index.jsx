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
  passkeyEnabled,
  startAuthentication,
} from '../../utils/passkey.js';
import { SITE_NAME, safePath } from '../../utils/site.js';
import { externalReturn } from '../../utils/site-redirect.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE = /^\d{6}$/u;
const AUTOFILL_REFRESH = 4 * 60 * 1000;

export default function Login() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => (takeSessionExpired() ? t('session expired') : false));
  const [twoFactor, setTwoFactor] = useState(null);
  const busy = useRef(false);
  const lookups = useRef(new Map());
  const codeInput = useRef(null);
  const formRef = useRef(null);
  const autofill = useRef(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyOn = useMemo(() => passkeyEnabled(), []);
  const execute = useCaptcha({
    sitekey: window.turnstileKey ?? window.recaptchaV3Key,
    hideDefaultBadge: true,
  });

  const redirect = useMemo(
    () => new URLSearchParams(location.search).get('redirect') ?? '',
    [location.search],
  );

  const needsCode = Boolean(twoFactor?.enabled);

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
    if (needsCode) codeInput.current?.focus();
  }, [needsCode]);

  const finishPasskey = async (response, challengeToken) => {
    busy.current = true;
    setPasskeyBusy(true);
    setError(false);

    try {
      await dispatch.user.passkeyLogin({
        response,
        challengeToken,
        remember: Boolean(formRef.current?.remember?.checked),
      });

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
    if (!passkeyOn) return undefined;

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
  }, [passkeyOn]);

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

  const lookup2FA = (email) => {
    const key = email.toLowerCase();

    if (!lookups.current.has(key)) {
      lookups.current.set(
        key,
        get2FAStatus(email).then(
          (data) => Boolean(data.enable),
          () => {
            lookups.current.delete(key);

            return null;
          },
        ),
      );
    }

    return lookups.current.get(key);
  };

  const check2FA = async (email) => {
    if (!EMAIL.test(email)) return null;

    const enabled = await lookup2FA(email);

    if (enabled !== null) {
      setTwoFactor((current) => (current?.email === email && current.enabled === enabled ? current : { email, enabled }));
    }

    return enabled;
  };

  const onEmailChange = (event) => {
    const email = event.target.value.trim();

    if (twoFactor && twoFactor.email !== email) setTwoFactor(null);
  };

  const describe = (err, withCode) => {
    if (err?.errno === 'network') return t('network error');
    if (err?.status === 403) return t('captcha failed');
    if (err?.status >= 500) return t('server error');
    if (err?.errno === 1001) return t('please input a valid email');

    return withCode ? t('2fa code error') : t('email or password error');
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (busy.current) return;

    const form = event.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    const remember = form.remember.checked;

    if (!email) {
      form.email.focus();
      return setError(t('please input email'));
    }

    if (!EMAIL.test(email)) {
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

    const hadCodeField = Boolean(form.code);

    try {
      const enabled = await check2FA(email);
      const code = hadCodeField ? form.code.value.replace(/\s+/gu, '') : '';

      if (enabled && !hadCodeField) {
        setError(t('2fa code required'));
        return;
      }

      if (enabled && !code) {
        form.code.focus();
        setError(t('please input 2fa code'));
        return;
      }

      if (enabled && !CODE.test(code)) {
        form.code.focus();
        form.code.select();
        setError(t('2fa code format'));
        return;
      }

      let token;

      try {
        token = await execute('login');
      } catch {
        setError(t('captcha failed'));
        return;
      }

      try {
        await dispatch.user.login({
          email,
          password,
          code: enabled ? code : undefined,
          remember,
          recaptchaV3: window.recaptchaV3Key ? token : undefined,
          turnstile: window.turnstileKey ? token : undefined,
        });
      } catch (err) {
        setError(describe(err, enabled));
        if (enabled && form.code) {
          form.code.value = '';
          form.code.focus();
        } else {
          form.password.select();
          form.password.focus();
        }
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const keepQuery = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';

  return (
    <Layout narrow>
      <Notice onClose={() => setError(false)}>{error}</Notice>
      <section className="auth">
        <h1 className="page-title">{t('login')}</h1>
        <p className="auth-lede">
          {SITE_NAME} · {t('comments')}
        </p>

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
              onChange={onEmailChange}
              onBlur={(event) => check2FA(event.target.value.trim())}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('password')}</span>
            <input type="password" name="password" autoComplete="current-password" required className="input" />
          </label>
          {needsCode ? (
            <label className="field">
              <span className="field-label">{t('2fa code')}</span>
              <input
                ref={codeInput}
                type="text"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={7}
                required
                className="input"
              />
              <span className="field-hint">{t('2fa code hint')}</span>
            </label>
          ) : null}
          <div className="captcha-container" />
          <div className="form-row">
            <label className="check">
              <input type="checkbox" name="remember" /> <span>{t('remember me')}</span>
            </label>
            <Link to={`/forgot${keepQuery}`}>{t('forgot password')}</Link>
          </div>
          <button
            type="submit"
            className={passkeyOn ? 'btn btn-block' : 'btn btn-primary btn-block'}
            disabled={loading || passkeyBusy}
          >
            {loading ? t('loading') : t('login')}
          </button>
        </form>
      </section>
    </Layout>
  );
}
