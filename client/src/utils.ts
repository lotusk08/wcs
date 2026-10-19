import type { Locale } from './locale.ts';

interface UAData {
  platform: string;
  getHighEntropyValues: (hints: string[]) => Promise<{ platformVersion?: string }>;
}

export const isLinkHttp = (link: string): boolean => /^(?:https?:)?\/\//u.test(link);

export const serverOf = (serverURL: string): string => {
  const result = serverURL.replace(/\/$/u, '');

  return isLinkHttp(result) ? result : `https://${result}`;
};

export const decodePath = (path: string): string => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

const pad = (value: number): string => value.toString().padStart(2, '0');

const relative = new Map<string, Intl.RelativeTimeFormat>();

const ago = (lang: string, value: number, unit: Intl.RelativeTimeFormatUnit): string => {
  let format = relative.get(lang);

  if (!format) {
    try {
      format = new Intl.RelativeTimeFormat([lang, 'en']);
    } catch {
      format = new Intl.RelativeTimeFormat('en');
    }

    relative.set(lang, format);
  }

  return format.format(-value, unit);
};

export const timeAgo = (time: number, now: number, lang: string, locale: Locale): string => {
  if (!time) return '';

  const passed = now - time;
  const days = Math.floor(passed / 86400000);

  if (days === 0) {
    const hours = Math.floor((passed % 86400000) / 3600000);

    if (hours === 0) {
      const minutes = Math.floor((passed % 3600000) / 60000);

      if (minutes === 0) return ago(lang, Math.round((passed % 60000) / 1000), 'second');

      return ago(lang, minutes, 'minute');
    }

    return ago(lang, hours, 'hour');
  }

  if (days < 0) return locale.now;
  if (days < 8) return ago(lang, days, 'day');

  const date = new Date(time);

  return `${pad(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const wordCount = (content: string): number =>
  (content
    .match(/[\w\d\s,.À-ɏЀ-ӿ]+/giu)
    ?.reduce((sum, word) => sum + (['', ',', '.'].includes(word.trim()) ? 0 : word.trim().split(/\s+/u).length), 0) ?? 0) +
  (content.match(/[一-鿕]/gu)?.length ?? 0);

export const userAgent = async (): Promise<string> => {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  let ua = navigator.userAgent;

  if (!data) return ua;

  const { platformVersion } = await data.getHighEntropyValues(['platformVersion']);

  if (!platformVersion) return ua;

  if (data.platform === 'Windows' && Math.trunc(Number(platformVersion.split('.')[0])) >= 13) {
    ua = ua.replace('Windows NT 10.0', 'Windows NT 11.0');
  }

  if (data.platform === 'macOS') {
    const [major, minor] = platformVersion.split('.').map((part) => Math.trunc(Number(part)));

    if (major > 10 || (major === 10 && minor >= 15)) {
      ua = ua.replace('Mac OS X 10_15_7', `Mac OS X ${platformVersion.replace(/\./gu, '_')}`);
    }
  }

  return ua;
};
