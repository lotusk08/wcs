import type { ComputedRef, InjectionKey, Ref } from 'vue';

import type { Locale } from './locale.ts';
import type { Store } from './storage.ts';

export interface LineProps {
  serverURL: string;
  path: string;
  lang?: string;
  locale?: Partial<Locale>;
  meta?: 'nick'[];
}

export interface LineConfig {
  serverURL: string;
  path: string;
  lang: string;
  locale: Locale;
  named: boolean;
}

interface LineContext extends Store {
  config: ComputedRef<LineConfig>;
  now: Ref<number>;
}

export const contextKey: InjectionKey<LineContext> = Symbol('line');
