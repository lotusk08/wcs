import { storage } from './site.js';

const KEY = 'line-theme';

const storedTheme = () => {
  const value = storage.get('localStorage', KEY);

  return value === 'light' || value === 'dark' ? value : null;
};

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
