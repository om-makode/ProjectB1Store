import { create } from 'zustand';

import type { VariantOffer } from './types';

/**
 * Live patches from Realtime, keyed by variant id. Product cards merge these over the
 * (possibly cached) server data so stock and price change on screen within a second,
 * without refetching every list. Cleared whenever catalog queries are refetched.
 */
type InventoryPatch = { stock: number; is_available: boolean; low_stock_threshold: number };
type VariantPatch = { price: number; mrp: number; max_per_order: number; is_active: boolean };

type LiveState = {
  inventory: Record<number, InventoryPatch>;
  variants: Record<number, VariantPatch>;
  patchInventory: (variantId: number, p: InventoryPatch) => void;
  patchVariant: (variantId: number, p: VariantPatch) => void;
  reset: () => void;
};

export const useLiveCatalog = create<LiveState>()((set) => ({
  inventory: {},
  variants: {},
  patchInventory: (id, p) => set((s) => ({ inventory: { ...s.inventory, [id]: p } })),
  patchVariant: (id, p) => set((s) => ({ variants: { ...s.variants, [id]: p } })),
  reset: () => set({ inventory: {}, variants: {} }),
}));

/** Same rules as the SQL view v_variant_offers. */
export function mergeOffer<T extends VariantOffer>(
  offer: T,
  inv: InventoryPatch | undefined,
  v: VariantPatch | undefined,
): T {
  if (!inv && !v) return offer;
  const price = v?.price ?? offer.price;
  const mrp = v?.mrp ?? offer.mrp;
  const max = v?.max_per_order ?? offer.max_per_order;
  const active = v?.is_active ?? true;
  let available = offer.available_qty;
  let low = offer.low_stock;
  if (inv) {
    const sellable = active && inv.is_available;
    available = sellable ? Math.min(Math.max(inv.stock, 0), max) : 0;
    low = sellable && inv.stock > 0 && inv.stock <= inv.low_stock_threshold;
  } else if (!active) {
    available = 0;
  } else {
    available = Math.min(available, max);
  }
  return {
    ...offer,
    price,
    mrp,
    max_per_order: max,
    discount_pct: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
    available_qty: available,
    low_stock: low,
  };
}

/** The offer to show for a variant, with any live patch applied. */
export function useLiveOffer<T extends VariantOffer>(offer: T): T {
  const inv = useLiveCatalog((s) => s.inventory[offer.id]);
  const v = useLiveCatalog((s) => s.variants[offer.id]);
  return mergeOffer(offer, inv, v);
}
