// oxlint-disable no-underscore-dangle
import cls from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, useNavigate } from 'react-router';

import { LANGUAGE_OPTIONS } from '../locales/index.js';
import { SITE_NAME, SITE_URL } from '../utils/site.js';
import { setThemePreference, themePreference } from '../utils/theme.js';
import Avatar from './Avatar.jsx';
import BottomSheet from './BottomSheet.jsx';
import Icon from './icon/ui.jsx';

const THEMES = [
  { value: 'system', icon: 'system' },
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
];

function AccountSheet({ open, onClose, user, onLogout }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(themePreference);

  const language = useMemo(() => {
    const option = LANGUAGE_OPTIONS.find((item) => item.alias.includes(i18n.language));

    return option?.value ?? 'en-US';
  }, [i18n.language]);

  const header = user?.objectId ? (
    <div className="sheet-account">
      <Avatar src={user.avatar} size={44} className="sheet-avatar" />
      <div className="sheet-heading">
        <h2 className="sheet-title">{user.display_name}</h2>
        <p className="sheet-subtitle">{user.email}</p>
      </div>
    </div>
  ) : null;

  return (
    <BottomSheet open={open} onClose={onClose} header={header} title={header ? undefined : t('preferences')} className="account-sheet">
      {user?.objectId ? (
        <Link to="/profile" className="sheet-item" onClick={onClose}>
          <Icon name="profile" />
          <span>{t('profile')}</span>
        </Link>
      ) : null}

      <div className="sheet-group">
        <label className="sheet-label" htmlFor="account-language">
          <Icon name="globe" />
          <span>{t('language')}</span>
        </label>
        <span className="lang-select">
          <select
            id="account-language"
            className="input select"
            value={language}
            onChange={(event) => i18n.changeLanguage(event.target.value)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="sheet-group">
        <span className="sheet-label" id="account-theme">
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'system'} />
          <span>{t('theme')}</span>
        </span>
        <div className="choice" role="radiogroup" aria-labelledby="account-theme">
          {THEMES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={theme === item.value}
              className={cls('choice-item', { active: theme === item.value })}
              onClick={() => setTheme(setThemePreference(item.value))}
            >
              <Icon name={item.icon} size={18} />
              <span>{t(`theme ${item.value}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <a href={SITE_URL} className="sheet-item">
        <Icon name="external" />
        <span>{t('back to site')}</span>
      </a>

      {user?.objectId ? (
        <button type="button" className="sheet-item danger" onClick={onLogout}>
          <Icon name="logout" />
          <span>{t('logout')}</span>
        </button>
      ) : null}
    </BottomSheet>
  );
}

export default function Header({ title }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((state) => state.user);
  const { t } = useTranslation();
  const [latestVersion, setLatestVersion] = useState(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (user?.type !== 'administrator' || !user?.__version) {
      return;
    }

    fetch('https://registry.npmjs.org/@waline/vercel/latest')
      .then((resp) => resp.json())
      .then((resp) => {
        if (resp?.version && user.__version !== resp.version) {
          setLatestVersion(resp.version);
        }
      })
      .catch(() => {
        // offline or blocked
      });
  }, [user?.type, user?.__version]);

  const onLogout = () => {
    setMenu(false);
    dispatch.user.logout();
    navigate('/', { replace: true });
  };

  const isAdmin = user?.type === 'administrator';
  const navItems = [
    { to: '/', label: t('comments'), short: t('comments'), icon: 'comments', end: true },
    { to: '/user', label: t('user'), short: t('users'), icon: 'users' },
    { to: '/migration', label: t('migration'), short: t('import export'), icon: 'transfer' },
    { to: '/profile', label: t('setting'), short: t('profile'), icon: 'profile' },
  ];

  return (
    <>
      <header className={cls('appbar', { 'has-title': Boolean(title) })}>
        <div className="appbar-inner">
          <a href={SITE_URL} className="brand-name" title={t('back to site')}>
            {SITE_NAME}
          </a>
          {title ? (
            <span className="bar-title" aria-hidden="true">
              {title}
            </span>
          ) : null}

          {isAdmin ? (
            <nav className="site-nav" aria-label={t('management')}>
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cls('nav-link', { active: isActive })}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <div className="appbar-tools">
            {user?.objectId ? (
              <button
                type="button"
                className="me"
                aria-haspopup="dialog"
                aria-expanded={menu}
                aria-label={t('account')}
                onClick={() => setMenu(true)}
              >
                <Avatar src={user.avatar} size={32} className="me-avatar" />
                <span className="me-name">{user.display_name}</span>
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                aria-haspopup="dialog"
                aria-expanded={menu}
                aria-label={t('preferences')}
                title={t('preferences')}
                onClick={() => setMenu(true)}
              >
                <Icon name="settings" />
              </button>
            )}
          </div>
        </div>
      </header>

      {isAdmin ? (
        <nav className="tabbar" aria-label={t('management')}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cls('tabbar-item', { active: isActive })}
            >
              <Icon name={item.icon} size={22} />
              <span className="tabbar-label">{item.short}</span>
            </NavLink>
          ))}
        </nav>
      ) : null}

      <AccountSheet open={menu} onClose={() => setMenu(false)} user={user} onLogout={onLogout} />

      {latestVersion ? (
        <div className="banner">
          <Trans
            i18nKey="new version tips"
            defaults="New version @waline/vercel@{{version}} published, please upgrade it! Goto <a href='https://waline.js.org/en/advanced/faq.html#server' target='_blank'>FAQ</a> to find How to upgrade it."
            components={{
              // oxlint-disable-next-line id-length, jsx-a11y/anchor-is-valid, jsx-a11y/anchor-has-content
              a: <a rel="noreferrer" />,
            }}
            values={{ version: latestVersion }}
            transKeepBasicHtmlNodesFor={['a']}
          />
        </div>
      ) : null}
    </>
  );
}
