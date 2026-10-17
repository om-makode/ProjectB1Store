import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { toAppError } from '@/lib/errors';
import { kv } from '@/lib/kv';
import { logger } from '@/lib/logger';

import { hasSession, setStockAlert } from './api';

/**
 * "Notify me" for out-of-stock variants.
 * - Logged in: saved on the server right away (toggle_stock_alert).
 * - Guest: kept on the phone as `pending` and sent by flushPendingStockAlerts() after login (Phase 3).
 * `on` mirrors what this phone has asked for, so the button shows the right state offline.
 */
type AlertState = {
  on: number[];
  pending: number[];
  set: (variantId: number, enabled: boolean, pending: boolean) => void;
  markSynced: (variantIds: number[]) => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

const without = (xs: number[], x: number) => xs.filter((v) => v !== x);

export const useStockAlerts = create<AlertState>()(
  persist(
    (set) => ({
      on: [],
      pending: [],
      set: (id, enabled, pending) =>
        set((s) => ({
          on: enabled ? [...without(s.on, id), id] : without(s.on, id),
          pending: enabled && pending ? [...without(s.pending, id), id] : without(s.pending, id),
        })),
      markSynced: (ids) => set((s) => ({ pending: s.pending.filter((x) => !ids.includes(x)) })),
    }),
    {
      name: 'stock-alerts',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ on, pending }) => ({ on, pending }),
    },
  ),
);

export type ToggleResult = 'saved' | 'pending' | 'removed';

/** Turn "Notify me" on/off for one variant. Throws AppError (e.g. too_many_alerts) on server errors. */
export async function toggleStockAlert(variantId: number): Promise<ToggleResult> {
  const store = useStockAlerts.getState();
  const enable = !store.on.includes(variantId);
  if (!(await hasSession())) {
    store.set(variantId, enable, true);
    return enable ? 'pending' : 'removed';
  }
  await setStockAlert(variantId, enable);
  store.set(variantId, enable, false);
  return enable ? 'saved' : 'removed';
}

/** Call right after login (Phase 3): sends alerts tapped while logged out. */
export async function flushPendingStockAlerts(): Promise<void> {
  const { pending, markSynced } = useStockAlerts.getState();
  if (pending.length === 0 || !(await hasSession())) return;
  const done: number[] = [];
  for (const id of pending) {
    try {
      await setStockAlert(id, true);
      done.push(id);
    } catch (e) {
      const err = toAppError(e);
      logger.warn('stock alert sync failed', id, err.message);
      if (err.message.includes('too_many_alerts')) break;
    }
  }
  markSynced(done);
}
