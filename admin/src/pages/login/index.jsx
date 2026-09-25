import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router';

import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
// oxlint-disable-next-line import/no-namespace
import * as Icons from '../../components/icon';
import { useCaptcha } from '../../components/useCaptcha.js';
import { get2FAToken } from '../../services/user.js';
import { API_BASE, SITE_NAME, SOCIALS, safePath } from '../../utils/site.js';
import { externalReturn, oauthReturn } from '../../utils/site-redirect.js';

export default function Login() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [is2FAEnabled, set2FAEnabled] = useState(false);
  const execute = useCaptcha({
    sitekey: window.turnstileKey ?? window.recaptchaV3Key,
    hideDefaultBadge: true,
  });

  const redirect = useMemo(
    () => new URLSearchParams(location.search).get('redirect') ?? '',
    [location.search],
  );

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

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(false);

    const form = event.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    const code = form.code ? form.code.value.trim() : '';
    const remember = form.remember.checked;

    if (!email) {
      return setError(t('please input email'));
    }

    if (!password) {
      return setError(t('please input password'));
    }

    if (form.code && !code) {
      return setError(t('please input 2fa code'));
    }

    setLoading(true);

    try {
      const token = await execute('login');

      await dispatch.user.login({
        email,
        password,
        code,
        remember,
        recaptchaV3: window.recaptchaV3Key ? token : undefined,
        turnstile: window.turnstileKey ? token : undefined,
      });
    } catch {
      setError(t('email or password error'));
    } finally {
      setLoading(false);
    }
  };

  const check2FACode = async (event) => {
    const email = event.target.value.trim();

    if (!email) {
      return;
    }

    try {
      const data = await get2FAToken(email);

      set2FAEnabled(Boolean(data.enable));
    } catch {
      set2FAEnabled(false);
    }
  };

  const buildOAuthURL = (social) =>
    `${API_BASE}oauth?type=${encodeURIComponent(social)}&redirect=${encodeURIComponent(oauthReturn(redirect))}`;

  const keepQuery = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';

  return (
    <Layout narrow>
      <Notice onClose={() => setError(false)}>{error}</Notice>
      <section className="auth">
        <h1 className="page-title">{t('login')}</h1>
        <p className="auth-lede">
          {SITE_NAME} · {t('comments')}
        </p>

        <form method="post" name="login" className="form" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t('email')}</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              className="input"
              onBlur={check2FACode}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('password')}</span>
            <input type="password" name="password" autoComplete="current-password" className="input" />
          </label>
          {is2FAEnabled ? (
            <label className="field">
              <span className="field-label">{t('2fa code')}</span>
              <input
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input"
              />
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

        {SOCIALS.length ? (
          <div className="social-login">
            {SOCIALS.map((social) => {
              // oxlint-disable-next-line import/namespace
              const Icon = Icons[social];

              return (
                <a key={social} href={buildOAuthURL(social)} className={`social-btn ${social}`}>
                  {Icon ? <Icon className="social-icon" aria-hidden="true" /> : null}
                  <span className="social-name">{social}</span>
                </a>
              );
            })}
          </div>
        ) : null}

        <p className="auth-links">
          <Link to={`/register${keepQuery}`}>{t('register')}</Link>
        </p>
      </section>
    </Layout>
  );
}
