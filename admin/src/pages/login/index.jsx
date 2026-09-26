import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router';

import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import { useCaptcha } from '../../components/useCaptcha.js';
import { get2FAStatus } from '../../services/user.js';
import { takeSessionExpired } from '../../store/user.js';
import { SITE_NAME, safePath } from '../../utils/site.js';
import { externalReturn } from '../../utils/site-redirect.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE = /^\d{6}$/u;

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

        <form method="post" name="login" className="form" onSubmit={onSubmit} aria-busy={loading} noValidate>
          <label className="field">
            <span className="field-label">{t('email')}</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
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
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('loading') : t('login')}
          </button>
        </form>
      </section>
    </Layout>
  );
}
