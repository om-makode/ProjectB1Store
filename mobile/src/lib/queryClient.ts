import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { AppError } from './errors';
import { kv } from './kv';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)),
);

if (Platform.OS !== 'web') {
  // Refetch when the app returns to the foreground (also covers missed Realtime events).
  AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // catalog hooks override with longer times; live data uses Realtime
      gcTime: 24 * 60 * 60_000, // keep 24 h (needed for persistence)
      retry: (count, err) => (err instanceof AppError ? err.retryable && count < 2 : count < 2),
      networkMode: 'offlineFirst',
    },
    // Never silently replay money/stock writes: placing an order offline must fail visibly.
    mutations: { networkMode: 'online', retry: 0 },
  },
});

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (k) => kv.getString(k),
    setItem: async (k, v) => kv.set(k, v),
    removeItem: async (k) => kv.delete(k),
  },
  key: 'rq-cache',
  throttleTime: 1000,
});

/**
 * Whitelist of query-key prefixes saved for offline use (Phase 9.1): catalog, home, orders,
 * profile/addresses/wishlist ('me'), notifications and app config. Everything else is
 * fresh-only: cart quote, checkout, serviceability, and the staff/admin screens.
 * The cart itself lives in its own persisted store.
 */
export const PERSIST_PREFIXES = ['catalog', 'orders', 'me', 'notifications', 'appConfig'];

export const shouldPersistQuery = (key: readonly unknown[]) =>
  PERSIST_PREFIXES.includes(String(key[0]));
