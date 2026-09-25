import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router';

import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import { useCaptcha } from '../../components/useCaptcha.js';

export default function Register() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { search } = useLocation();
  const user = useSelector((state) => state.user);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const execute = useCaptcha({
    sitekey: window.turnstileKey ?? window.recaptchaV3Key,
    hideDefaultBadge: true,
  });

  useEffect(() => {
    if (user?.objectId) {
      navigate('/', { replace: true });
    }
  }, [navigate, user?.objectId]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(false);

    const form = event.currentTarget;
    const nick = form.nick.value.trim();

    if (!nick || nick.length < 2) {
      return setError(t('nickname illegal'));
    }

    const email = form.email.value.trim();

    if (!email) {
      return setError(t('please input email'));
    }

    const link = form.link.value.trim();
    const password = form.password.value;
    const passwordAgain = form['password-again'].value;

    if (!password || !passwordAgain || passwordAgain !== password) {
      return setError(t("passwords don't match"));
    }

    try {
      setSubmitting(true);
      const token = await execute('login');
      const resp = await dispatch.user.register({
        display_name: nick,
        email,
        url: link,
        password,
        recaptchaV3: window.recaptchaV3Key ? token : undefined,
        turnstile: window.turnstileKey ? token : undefined,
      });

      if (resp && resp.verify) {
        alert(t('register success! please go to your mailbox to verify it!'));
      }

      navigate(`/login${search}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout narrow>
      <Notice onClose={() => setError(false)}>{error}</Notice>
      <section className="auth">
        <h1 className="page-title">{t('register')}</h1>
        <form method="post" name="register" className="form" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t('nickname')}</span>
            <input type="text" name="nick" autoComplete="nickname" className="input" />
          </label>
          <label className="field">
            <span className="field-label">{t('email')}</span>
            <input type="email" name="email" autoComplete="email" className="input" />
          </label>
          <label className="field">
            <span className="field-label">{t('website')}</span>
            <input type="url" name="link" autoComplete="url" className="input" />
          </label>
          <label className="field">
            <span className="field-label">{t('password')}</span>
            <input type="password" name="password" autoComplete="new-password" className="input" />
          </label>
          <label className="field">
            <span className="field-label">{t('password again')}</span>
            <input
              type="password"
              name="password-again"
              autoComplete="new-password"
              className="input"
            />
          </label>
          <div className="captcha-container" />
          <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
            {t('register')}
          </button>
        </form>

        <p className="auth-links">
          <Link to={`/login${search}`}>{t('register.login')}</Link>
        </p>
      </section>
    </Layout>
  );
}
