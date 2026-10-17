import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { LocalizedString } from '@/i18n/localize';
import { kv } from '@/lib/kv';

/**
 * Guest cart (Phase 1): lives on the phone so browsing never needs a login.
 * Prices here are only for the cart bar estimate; Phase 4 re-prices everything on the
 * server (get_cart_quote) and merges this cart into cart_items after login.
 */
export type CartLine = {
  variantId: number;
  productId: number;
  slug: string;
  name: LocalizedString;
  label: LocalizedString;
  thumbPath: string | null;
  isVeg: boolean | null;
  price: number;
  mrp: number;
  qty: number;
  /** least(stock, max_per_order) when last seen */
  maxQty: number;
};

type CartState = {
  lines: Record<number, CartLine>;
  add: (line: Omit<CartLine, 'qty'>) => void;
  increment: (variantId: number, maxQty?: number) => void;
  decrement: (variantId: number) => void;
  /** Refresh price/limits from the latest server data (never raises qty). */
  sync: (variantId: number, patch: Pick<CartLine, 'price' | 'mrp' | 'maxQty'>) => void;
  /** Exact quantity (0 removes the line). */
  setQty: (variantId: number, qty: number) => void;
  /** Replace every line (logged-in mirror rebuilt from the server quote). */
  replaceAll: (lines: CartLine[]) => void;
  clear: () => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

export const clampQty = (qty: number, max: number) => Math.max(0, Math.min(qty, Math.max(max, 0)));

export const useGuestCart = create<CartState>()(
  persist(
    (set) => ({
      lines: {},
      add: (line) =>
        set((s) => {
          if (line.maxQty <= 0) return s;
          const prev = s.lines[line.variantId];
          const qty = clampQty((prev?.qty ?? 0) + 1, line.maxQty);
          return { lines: { ...s.lines, [line.variantId]: { ...line, qty } } };
        }),
      increment: (id, maxQty) =>
        set((s) => {
          const l = s.lines[id];
          if (!l) return s;
          const max = maxQty ?? l.maxQty;
          return {
            lines: { ...s.lines, [id]: { ...l, maxQty: max, qty: clampQty(l.qty + 1, max) } },
          };
        }),
      decrement: (id) =>
        set((s) => {
          const l = s.lines[id];
          if (!l) return s;
          const { [id]: _removed, ...rest } = s.lines;
          return l.qty <= 1
            ? { lines: rest }
            : { lines: { ...s.lines, [id]: { ...l, qty: l.qty - 1 } } };
        }),
      sync: (id, patch) =>
        set((s) => {
          const l = s.lines[id];
          if (!l) return s;
          if (l.price === patch.price && l.mrp === patch.mrp && l.maxQty === patch.maxQty) return s;
          return {
            lines: {
              ...s.lines,
              // Out of stock keeps the line (the cart shows it as unavailable); otherwise clamp.
              [id]: {
                ...l,
                ...patch,
                qty: patch.maxQty > 0 ? Math.min(l.qty, patch.maxQty) : l.qty,
              },
            },
          };
        }),
      setQty: (id, qty) =>
        set((s) => {
          const l = s.lines[id];
          if (!l) return s;
          if (qty <= 0) {
            const { [id]: _removed, ...rest } = s.lines;
            return { lines: rest };
          }
          return { lines: { ...s.lines, [id]: { ...l, qty } } };
        }),
      replaceAll: (lines) => set({ lines: Object.fromEntries(lines.map((l) => [l.variantId, l])) }),
      clear: () => set({ lines: {} }),
    }),
    {
      name: 'guest-cart',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ lines }) => ({ lines }),
    },
  ),
);

export type CartSummary = { count: number; total: number; mrpTotal: number };

export function summarize(lines: Record<number, CartLine>): CartSummary {
  let count = 0;
  let total = 0;
  let mrpTotal = 0;
  for (const l of Object.values(lines)) {
    count += l.qty;
    total += l.qty * l.price;
    mrpTotal += l.qty * l.mrp;
  }
  return {
    count,
    total: Math.round(total * 100) / 100,
    mrpTotal: Math.round(mrpTotal * 100) / 100,
  };
}
