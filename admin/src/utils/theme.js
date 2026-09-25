import { storage } from './site.js';

const KEY = 'line-theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

export const systemTheme = () => (media?.matches ? 'dark' : 'light');

export const storedTheme = () => {
  const value = storage.get('localStorage', KEY);

  return value === 'light' || value === 'dark' ? value : null;
};

export const currentTheme = () => storedTheme() ?? systemTheme();

export const applyTheme = () => {
  const stored = storedTheme();

  if (stored) {
    document.documentElement.dataset.theme = stored;
  } else {
    delete document.documentElement.dataset.theme;
  }
};

export const toggleTheme = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';

  if (next === systemTheme()) {
    storage.remove('localStorage', KEY);
  } else {
    storage.set('localStorage', KEY, next);
  }

  applyTheme();

  return next;
};

export const onSystemThemeChange = (callback) => {
  media?.addEventListener?.('change', callback);

  return () => media?.removeEventListener?.('change', callback);
};
