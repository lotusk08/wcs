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

export const themePreference = () => storedTheme() ?? 'system';

export const setThemePreference = (value) => {
  if (value === 'light' || value === 'dark') {
    storage.set('localStorage', KEY, value);
  } else {
    storage.remove('localStorage', KEY);
  }

  applyTheme();

  return themePreference();
};

export const onSystemThemeChange = (callback) => {
  media?.addEventListener?.('change', callback);

  return () => media?.removeEventListener?.('change', callback);
};
