// oxlint-disable no-underscore-dangle
import cls from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, useNavigate } from 'react-router';

import { LANGUAGE_OPTIONS } from '../locales/index.js';
import { buildAvatar } from '../pages/manage-comments/utils.js';
import { SITE_NAME, SITE_URL } from '../utils/site.js';
import { currentTheme, onSystemThemeChange, toggleTheme } from '../utils/theme.js';

function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => onSystemThemeChange(() => setTheme(currentTheme())), []);

  return (
    <button
      type="button"
      className="icon-btn"
      title={t('toggle theme')}
      aria-label={t('toggle theme')}
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export default function Header() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((state) => state.user);
  const { t, i18n } = useTranslation();
  const [latestVersion, setLatestVersion] = useState(null);

  const language = useMemo(() => {
    const option = LANGUAGE_OPTIONS.find((item) => item.alias.includes(i18n.language));

    return option?.value ?? 'en-US';
  }, [i18n.language]);

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
    dispatch.user.logout();
    navigate('/', { replace: true });
  };

  const isAdmin = user?.type === 'administrator';
  const navItems = [
    { to: '/', label: t('comments'), end: true },
    { to: '/user', label: t('user') },
    { to: '/migration', label: t('migration') },
  ];

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">
            <a href={SITE_URL} className="brand-name" title={t('back to site')}>
              {SITE_NAME}
            </a>
            <span className="brand-sep" aria-hidden="true">
              /
            </span>
            <Link to="/" className="brand-section">
              {t('comments')}
            </Link>
          </div>

          <div className="header-tools">
            <label className="lang-select">
              <span className="sr-only">{t('language')}</span>
              <select value={language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <ThemeToggle />
            {user?.objectId ? (
              <>
                <Link to="/profile" className="me" title={user.display_name}>
                  <img className="me-avatar" src={buildAvatar(user.email, user.avatar)} alt="" />
                  <span className="me-name">{user.display_name}</span>
                </Link>
                <button type="button" className="text-btn" onClick={onLogout}>
                  {t('logout')}
                </button>
              </>
            ) : null}
          </div>
        </div>

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
            <NavLink to="/profile" className={({ isActive }) => cls('nav-link', { active: isActive })}>
              {t('setting')}
            </NavLink>
          </nav>
        ) : null}
      </header>
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
