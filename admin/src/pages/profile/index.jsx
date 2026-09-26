import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import Avatar from '../../components/Avatar.jsx';
import BottomSheet from '../../components/BottomSheet.jsx';
import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import { updateProfile } from '../../services/user.js';
import Passkeys from './passkeys.jsx';
import TwoFactorAuth from './twoFactorAuth.jsx';

const AVATAR_URL = /^https?:\/\/\S+$/iu;

function AvatarSheet({ open, current, onClose, onSave }) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError(false);
      setSaving(false);
    }
  }, [open]);

  const onSubmit = async (event) => {
    event.preventDefault();

    const url = event.currentTarget.avatar.value.trim();

    if (!AVATAR_URL.test(url)) {
      setError(t('avatar url invalid'));
      event.currentTarget.avatar.focus();

      return;
    }

    setSaving(true);
    setError(false);
    try {
      await onSave(url);
    } catch (err) {
      setError(err?.message || t('request failed'));
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('change avatar')} className="avatar-sheet">
      <form className="form label-form" name="avatar" onSubmit={onSubmit} noValidate>
        <Notice onClose={() => setError(false)}>{error}</Notice>
        <label className="field">
          <span className="field-label">{t('avatar url')}</span>
          <input
            name="avatar"
            type="url"
            inputMode="url"
            className="input"
            defaultValue={current ?? ''}
            placeholder="https://"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-autofocus
          />
          <span className="field-hint">{t('avatar url hint')}</span>
        </label>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-solid act-avatar-save" disabled={saving}>
            <Icon name="check" size={18} />
            {t('save')}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

export default function Profile() {
  const [isPasswordUpdating, setPasswordUpdating] = useState(false);
  const [isProfileUpdating, setProfileUpdating] = useState(false);
  const [profileNotice, setProfileNotice] = useState(null);
  const [passwordNotice, setPasswordNotice] = useState(null);
  const [avatarNotice, setAvatarNotice] = useState(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
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
      setProfileNotice({ tone: 'error', text: t('nickname and homepage are required') });
      (display_name ? form.url : form.screenName).focus();

      return;
    }

    setProfileUpdating(true);
    setProfileNotice(null);
    try {
      await dispatch.user.updateProfile({ display_name, url, label, email });
      setProfileNotice({ tone: 'success', text: t('profile saved') });
    } catch (err) {
      setProfileNotice({ tone: 'error', text: err?.message || t('request failed') });
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
      setPasswordNotice({ tone: 'error', text: t('please input password') });
      (password ? form.confirm : form.password).focus();

      return;
    }

    if (password !== confirmation) {
      setPasswordNotice({ tone: 'error', text: t("passwords don't match") });
      form.confirm.select();
      form.confirm.focus();

      return;
    }

    setPasswordUpdating(true);
    setPasswordNotice(null);
    try {
      await updateProfile({ password });
      form.reset();
      setPasswordNotice({ tone: 'success', text: t('password updated') });
    } catch (err) {
      setPasswordNotice({ tone: 'error', text: err?.message || t('request failed') });
    } finally {
      setPasswordUpdating(false);
    }
  };

  const saveAvatar = async (url) => {
    await dispatch.user.updateProfile({ avatar: url });
    setAvatarOpen(false);
    setAvatarNotice({ tone: 'success', text: t('avatar updated') });
  };

  return (
    <Layout title={t('setting')}>
      <div className="profile">
        <aside className="profile-card">
          <button
            type="button"
            className="profile-avatar-btn"
            title={t('change avatar')}
            onClick={() => {
              setAvatarNotice(null);
              setAvatarOpen(true);
            }}
          >
            <Avatar src={user.avatar} size={120} alt={t('avatar')} className="profile-avatar" />
            <span className="profile-avatar-hint">{t('change avatar')}</span>
          </button>
          <h2 className="profile-name">{user.display_name}</h2>
          <p className="muted">{user.email}</p>
          <Notice tone={avatarNotice?.tone} onClose={() => setAvatarNotice(null)} className="profile-notice">
            {avatarNotice?.text}
          </Notice>
        </aside>
        <AvatarSheet open={avatarOpen} current={user.avatar} onClose={() => setAvatarOpen(false)} onSave={saveAvatar} />

        <div className="profile-sections">
          <section className="panel">
            <h2 className="panel-title">{t('profile')}</h2>
            <Notice tone={profileNotice?.tone} onClose={() => setProfileNotice(null)}>
              {profileNotice?.text}
            </Notice>
            <form method="post" name="profile" className="form" onSubmit={onProfileUpdate} noValidate>
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
            <Notice tone={passwordNotice?.tone} onClose={() => setPasswordNotice(null)}>
              {passwordNotice?.text}
            </Notice>
            <form method="post" name="password" className="form" onSubmit={onPasswordUpdate} noValidate>
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
