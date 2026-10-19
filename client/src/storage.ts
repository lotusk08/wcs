import { effectScope, onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';

interface UserMeta {
  nick: string;
  mail: string;
  link: string;
}

export interface Store {
  editor: Ref<string>;
  userMeta: Ref<UserMeta>;
  likes: Ref<(number | string)[]>;
}

const local = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const stored = <T>(key: string, initial: T, raw = false): Ref<T> => {
  const read = (value: string | null | undefined): T => {
    if (value == null) return initial;
    if (raw) return value as T;

    try {
      const parsed: unknown = JSON.parse(value);

      return parsed !== null && typeof parsed === typeof initial && Array.isArray(parsed) === Array.isArray(initial)
        ? (parsed as T)
        : initial;
    } catch {
      return initial;
    }
  };
  const get = (): string | null | undefined => {
    try {
      return local()?.getItem(key);
    } catch {
      return null;
    }
  };
  const value = ref(read(get())) as Ref<T>;
  const sync = (event: StorageEvent): void => {
    if (event.key === key && event.storageArea === local()) value.value = read(event.newValue);
  };

  effectScope(true).run(() =>
    watch(
      value,
      (next) => {
        try {
          local()?.setItem(key, raw ? String(next) : JSON.stringify(next));
        } catch {
          return;
        }
      },
      { deep: true },
    ),
  );

  window.addEventListener('storage', sync);
  onScopeDispose(() => window.removeEventListener('storage', sync));

  return value;
};

export const useStore = (): Store => ({
  editor: stored('WALINE_COMMENT_BOX_EDITOR', '', true),
  userMeta: stored<UserMeta>('WALINE_USER_META', { nick: '', mail: '', link: '' }),
  likes: stored<(number | string)[]>('WALINE_LIKE', []),
});
