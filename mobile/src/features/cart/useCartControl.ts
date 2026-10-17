import { useEffect } from 'react';

import type { LocalizedString } from '@/i18n/localize';

import { useGuestCart } from './store';
import { cart } from './sync';

export type CartControlInput = {
  productId: number;
  slug: string;
  name: LocalizedString;
  isVeg: boolean | null;
  thumbPath: string | null;
  variant: {
    id: number;
    label: LocalizedString;
    price: number;
    mrp: number;
    available_qty: number;
  };
};

/** Props for <Stepper/> bound to the cart (guest or logged in) for one variant. */
export function useCartControl({
  productId,
  slug,
  name,
  isVeg,
  thumbPath,
  variant,
}: CartControlInput) {
  const qty = useGuestCart((s) => s.lines[variant.id]?.qty ?? 0);
  const sync = useGuestCart((s) => s.sync);
  const max = variant.available_qty;

  // Keep the cart's price/limit in step with what's on screen (live stock & price).
  useEffect(() => {
    if (qty > 0) sync(variant.id, { price: variant.price, mrp: variant.mrp, maxQty: max });
  }, [qty, sync, variant.id, variant.price, variant.mrp, max]);

  return {
    quantity: qty,
    max,
    disabled: max <= 0 && qty === 0,
    onAdd: () =>
      cart.add({
        variantId: variant.id,
        productId,
        slug,
        name,
        label: variant.label,
        thumbPath,
        isVeg,
        price: variant.price,
        mrp: variant.mrp,
        maxQty: max,
      }),
    onIncrement: () => cart.increment(variant.id, max),
    onDecrement: () => cart.decrement(variant.id),
  };
}
