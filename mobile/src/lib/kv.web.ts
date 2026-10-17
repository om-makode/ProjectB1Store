/** Web variant of kv.ts. Every access is guarded: storage can throw in private mode. */
const ls = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const kv = {
  getString: (key: string): string | null => {
    try {
      return ls()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: (key: string, value: string): void => {
    try {
      ls()?.setItem(key, value);
    } catch {
      // ignore: settings just won't persist
    }
  },
  delete: (key: string): void => {
    try {
      ls()?.removeItem(key);
    } catch {
      // ignore
    }
  },
};
