import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';
import { store } from './store/index.js';
// oxlint-disable-next-line import/no-unassigned-import
import './i18n.js';
import { SITE_TITLE, TRUSTED_ORIGINS, storage } from './utils/site.js';
import { applyTheme } from './utils/theme.js';

import './style/index.css';

const acceptToken = (token) => {
  if (typeof token !== 'string' || !token) return;

  window.TOKEN = token;
  storage.set('sessionStorage', 'TOKEN', token);
};

const takeTokenFromQuery = () => {
  const url = new URL(location.href);
  const token = url.searchParams.get('token');

  if (!token) return false;

  acceptToken(token);
  url.searchParams.delete('token');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);

  return true;
};

const run = async () => {
  applyTheme();
  document.title = SITE_TITLE;

  if (!takeTokenFromQuery()) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 50);

      window.addEventListener('message', (event) => {
        if (!TRUSTED_ORIGINS.includes(event.origin)) return;
        if (event.data?.type !== 'TOKEN' || !event.data.data) return;

        acceptToken(event.data.data);
        clearTimeout(timer);
        resolve();
      });
    });
  }

  await store.dispatch({ type: 'user/loadUserInfo' }).catch((err) => {
    // oxlint-disable-next-line no-console
    console.error(err);
  });

  const container = document.createElement('div');

  document.body.classList.add('line-body');
  container.className = 'line-root';
  document.body.append(container);

  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

// oxlint-disable-next-line unicorn/prefer-top-level-await
run();
