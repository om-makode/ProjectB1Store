import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import { logger } from './logger';
import { utf8Decode, utf8Encode } from './utf8';

/**
 * Encrypted storage for the Supabase session (native only).
 *
 * A session (access JWT + refresh token + user) is often larger than SecureStore's ~2 KB limit,
 * so the session itself is stored AES-256-GCM encrypted in the SQLite kv-store, and only the
 * 32-byte key (64 hex chars) lives in SecureStore (Keychain / Android Keystore).
 */
const KEY_NAME = 'nk_auth_key_v1';
const PREFIX = 'nk_auth:';

let keyPromise: Promise<AESEncryptionKey> | null = null;

function getKey(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const hex = await SecureStore.getItemAsync(KEY_NAME);
    if (hex) return AESEncryptionKey.import(hex, 'hex');
    const key = await AESEncryptionKey.generate(256);
    await SecureStore.setItemAsync(KEY_NAME, await key.encoded('hex'), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    return key;
  })();
  return keyPromise;
}

export const supabaseAuthStorage = {
  async getItem(name: string): Promise<string | null> {
    const stored = await Storage.getItemAsync(PREFIX + name);
    if (!stored) return null;
    try {
      const sealed = AESSealedData.fromCombined(stored);
      const bytes = await aesDecryptAsync(sealed, await getKey());
      return utf8Decode(bytes);
    } catch (e) {
      // Key lost (e.g. reinstall wiped the Keychain) or data corrupted: treat as logged out.
      logger.warn('auth storage: could not decrypt session, clearing it', e);
      await Storage.removeItemAsync(PREFIX + name);
      return null;
    }
  },
  async setItem(name: string, value: string): Promise<void> {
    const sealed = await aesEncryptAsync(utf8Encode(value), await getKey());
    await Storage.setItemAsync(PREFIX + name, await sealed.combined('base64'));
  },
  async removeItem(name: string): Promise<void> {
    await Storage.removeItemAsync(PREFIX + name);
  },
};
