import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { kv } from '@/lib/kv';

const MAX_RECENT = 10;

type RecentState = {
  items: string[];
  add: (q: string) => void;
  remove: (q: string) => void;
  clear: () => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

/** Most recent first, case-insensitive de-duplication, kept on the phone only. */
export function addRecent(items: string[], q: string): string[] {
  const clean = q.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return items;
  const key = clean.toLocaleLowerCase();
  return [clean, ...items.filter((x) => x.toLocaleLowerCase() !== key)].slice(0, MAX_RECENT);
}

export const useRecentSearches = create<RecentState>()(
  persist(
    (set) => ({
      items: [],
      add: (q) => set((s) => ({ items: addRecent(s.items, q) })),
      remove: (q) => set((s) => ({ items: s.items.filter((x) => x !== q) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'recent-searches',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ items }) => ({ items }),
    },
  ),
);
