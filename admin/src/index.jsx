import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';
import { store } from './store/index.js';
import './i18n.js';
import { SITE_TITLE, storage } from './utils/site.js';
import { applyTheme } from './utils/theme.js';

import './style/index.css';

const takeTokenFromQuery = () => {
  const url = new URL(location.href);
  const token = url.searchParams.get('token');

  if (!token) return;

  window.TOKEN = token;
  storage.set('sessionStorage', 'TOKEN', token);
  url.searchParams.delete('token');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

const run = async () => {
  applyTheme();
  document.title = SITE_TITLE;
  takeTokenFromQuery();

  await store.dispatch({ type: 'user/loadUserInfo' }).catch((err) => {
    console.error(err);
  });

  const container = document.createElement('div');

  document.body.classList.add('line-body');
  container.className = 'line-root';
  document.body.append(container);

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

run();
