// oxlint-disable react-hooks/rules-of-hooks

import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import langs from './locales/index.js';

const I18n = createInstance();

I18n.use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: langs,
    fallbackLng: 'en',
    debug: false,

    detection: {
      order: ['querystring', 'localStorage'],
      lookupQuerystring: 'lng',
      caches: ['localStorage'],
    },

    ns: ['translations'],
    defaultNS: 'translations',

    keySeparator: false,

    interpolation: {
      escapeValue: false,
    },
  });

export default I18n;
