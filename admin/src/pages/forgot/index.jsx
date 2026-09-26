import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router';

import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';

export default function Forgot() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { search } = useLocation();
  const user = useSelector((state) => state.user);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.objectId) {
      navigate('/', { replace: true });
    }
  }, [navigate, user?.objectId]);

  const onSubmit = async (event) => {
    event.preventDefault();

    if (submitting) return;

    setError(false);
    setSent('');

    const email = event.currentTarget.email.value.trim();

    if (!email) {
      return setError(t('please input email'));
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      return setError(t('please input a valid email'));
    }

    try {
      setSubmitting(true);
      await dispatch.user.forgot({ email });
      setSent(email);
    } catch (err) {
      setError(err?.errno === 'network' ? t('network error') : t('find password error! try again later'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout narrow>
      <section className="auth">
        <h1 className="page-title">{t('forgot password')}</h1>
        <p className="auth-lede">{t('you will receive an email which contains a link to create new password')}</p>
        <Notice onClose={() => setError(false)}>{error}</Notice>
        <Notice tone="success" onClose={() => setSent('')}>
          {sent ? t('find password success! please go to your mailbox to reset it!') : null}
        </Notice>
        <form method="post" name="forgot" className="form" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t('email')}</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              className="input"
            />
          </label>
          <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
            {submitting ? t('loading') : t('get new password')}
          </button>
        </form>

        <p className="auth-links">
          <Link to={`/login${search}`}>{t('register.login')}</Link>
        </p>
      </section>
    </Layout>
  );
}
