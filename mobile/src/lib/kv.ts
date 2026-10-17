import Storage from 'expo-sqlite/kv-store';

/**
 * Small synchronous key-value store (native): settings, query cache, guest cart.
 * Backed by expo-sqlite's kv-store, which is maintained with each Expo SDK.
 * Web uses localStorage instead (kv.web.ts).
 */
export const kv = {
  getString: (key: string): string | null => Storage.getItemSync(key),
  set: (key: string, value: string): void => Storage.setItemSync(key, value),
  delete: (key: string): void => {
    Storage.removeItemSync(key);
  },
};
