import en from './en.json';
import viVN from './vi-VN.json';
import zhCN from './zh-CN.json';

export const LANGUAGE_OPTIONS = [
  {
    label: '中文简体',
    value: 'zh-CN',
    code: 'zh-CN',
    alias: ['zh-CN', 'zh-cn'],
  },
  {
    label: 'English',
    value: 'en-US',
    code: 'en',
    alias: ['en', 'en-US'],
  },
  {
    label: 'Tiếng Việt',
    value: 'vi',
    code: 'vi-VN',
    alias: ['vi', 'vi-VN'],
  },
];

export default {
  'zh-CN': { translations: zhCN },
  en: { translations: en },
  'en-US': { translations: en },
  vi: { translations: viVN },
  'vi-VN': { translations: viVN },
};
