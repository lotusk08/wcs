import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import Avatar from '../../components/Avatar.jsx';
import Layout from '../../components/Layout.jsx';
import { updateProfile } from '../../services/user.js';
import Passkeys from './passkeys.jsx';
import TwoFactorAuth from './twoFactorAuth.jsx';

export default function Profile() {
  const [isPasswordUpdating, setPasswordUpdating] = useState(false);
  const [isProfileUpdating, setProfileUpdating] = useState(false);
  const dispatch = useDispatch();
  const user = useSelector((state) => state.user);
  const { t } = useTranslation();

  const onProfileUpdate = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const display_name = form.screenName.value.trim();
    const url = form.url.value.trim();
    const label = form.label.value;
    const email = form.email.value.trim();

    if (!display_name || !url) {
      alert(t('nickname and homepage are required'));

      return;
    }

    setProfileUpdating(true);
    try {
      await dispatch.user.updateProfile({ display_name, url, label, email });
    } catch (err) {
      alert(err.message);
    } finally {
      setProfileUpdating(false);
    }
  };

  const onPasswordUpdate = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const password = form.password.value;
    const confirmation = form.confirm.value;

    if (!password || !confirmation) {
      alert(t('please input password'));

      return;
    }

    if (password !== confirmation) {
      alert(t("passwords don't match"));

      return;
    }

    setPasswordUpdating(true);
    try {
      await updateProfile({ password });
      form.reset();
    } catch (err) {
      alert(err.message);
    } finally {
      setPasswordUpdating(false);
    }
  };

  const changeAvatar = async () => {
    const url = prompt(t('please input avatar url'), user.avatar ?? '');

    if (!url) {
      return;
    }

    try {
      await dispatch.user.updateProfile({ avatar: url.trim() });
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <Layout title={t('setting')}>
      <div className="profile">
        <aside className="profile-card">
          <button
            type="button"
            className="profile-avatar-btn"
            title={t('change avatar')}
            onClick={changeAvatar}
          >
            <Avatar src={user.avatar} size={120} alt={t('avatar')} className="profile-avatar" />
            <span className="profile-avatar-hint">{t('change avatar')}</span>
          </button>
          <h2 className="profile-name">{user.display_name}</h2>
          <p className="muted">{user.email}</p>
        </aside>

        <div className="profile-sections">
          <section className="panel">
            <h2 className="panel-title">{t('profile')}</h2>
            <form method="post" className="form" onSubmit={onProfileUpdate}>
              <label className="field">
                <span className="field-label">{t('nickname')}</span>
                <input name="screenName" type="text" className="input" defaultValue={user.display_name} />
              </label>
              <label className="field">
                <span className="field-label">{t('email')}</span>
                <input name="email" type="email" className="input" defaultValue={user.email} />
              </label>
              <label className="field">
                <span className="field-label">{t('homepage')}</span>
                <input name="url" type="text" className="input" defaultValue={user.url} />
                <span className="field-hint">
                  <Trans
                    i18nKey="homepage tips"
                    defaults="Current users' homepage. It must be start with <code>http://</code> or <code>https://</code>."
                    components={{ code: <code /> }}
                  />
                </span>
              </label>
              <label className="field">
                <span className="field-label">{t('exclusive label')}</span>
                <input name="label" type="text" className="input" defaultValue={user.label} />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isProfileUpdating}>
                  {t('update my profile')}
                </button>
              </div>
            </form>
          </section>

          <section className="panel" id="change-password">
            <h2 className="panel-title">{t('change password')}</h2>
            <form method="post" className="form" onSubmit={onPasswordUpdate}>
              <label className="field">
                <span className="field-label">{t('password')}</span>
                <input name="password" type="password" className="input" autoComplete="new-password" />
                <span className="field-hint">
                  <Trans i18nKey="password tips" />
                </span>
              </label>
              <label className="field">
                <span className="field-label">{t('password again')}</span>
                <input name="confirm" type="password" className="input" autoComplete="new-password" />
                <span className="field-hint">
                  <Trans i18nKey="password again tips" />
                </span>
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isPasswordUpdating}>
                  {t('update password')}
                </button>
              </div>
            </form>
          </section>

          {user.type === 'administrator' ? <Passkeys /> : null}

          <TwoFactorAuth />
        </div>
      </div>
    </Layout>
  );
}
