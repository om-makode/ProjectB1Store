import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useUserId } from '@/features/auth/store';
import { useLiveCatalog } from '@/features/catalog/live';

import {
  fixCart,
  getCartQuote,
  placeOrder,
  quoteGuestCart,
  subscribeCartChanges,
  type PlaceOrderInput,
  type Quote,
} from './api';
import { useGuestCart } from './store';
import { cartQuoteKey, reconcileFromQuote, syncGuestFromQuote } from './sync';

/**
 * The server's price for the cart, re-run on open, on focus, on live stock/price
 * events and on cart changes. Logged in → get_cart_quote; guest → quote_guest_cart.
 */
export function useCartQuote(
  opts: { addressId?: string | null; enabled?: boolean; method?: 'cod' | 'upi' } = {},
) {
  const uid = useUserId();
  const lines = useGuestCart((s) => s.lines);
  // Guests: key on what's in the cart (not prices, so syncing prices doesn't refetch).
  const guestItems = useMemo(
    () =>
      Object.values(lines)
        .map((l) => ({ variant_id: l.variantId, quantity: l.qty, price_at_add: l.price }))
        .sort((a, b) => a.variant_id - b.variant_id),
    [lines],
  );
  const guestSig = guestItems.map((i) => `${i.variant_id}x${i.quantity}`).join(',');
  const addressId = opts.addressId ?? null;
  const method = opts.method ?? 'cod';

  const q = useQuery({
    queryKey: uid
      ? method === 'cod'
        ? [...cartQuoteKey, 'user', uid, addressId]
        : [...cartQuoteKey, 'user', uid, addressId, method]
      : [...cartQuoteKey, 'guest', guestSig],
    queryFn: () => (uid ? getCartQuote(addressId, method) : quoteGuestCart(guestItems)),
    enabled: opts.enabled !== false && (!!uid || guestItems.length > 0),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!q.data || q.isPlaceholderData) return;
    if (uid) reconcileFromQuote(q.data);
    else syncGuestFromQuote(q.data);
  }, [q.data, q.isPlaceholderData, uid]);

  return q;
}

export function useFixCart() {
  const qc = useQueryClient();
  const uid = useUserId();
  return useMutation({
    mutationFn: async (quote: Quote | undefined) => {
      if (uid) return fixCart();
      // Guests: apply the same rules on the phone.
      const { setQty } = useGuestCart.getState();
      for (const l of quote?.lines ?? []) {
        if (l.billable_quantity !== l.quantity) setQty(l.variant_id, l.billable_quantity);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cartQuoteKey }),
  });
}

export function usePlaceOrder() {
  return useMutation({ mutationFn: (i: PlaceOrderInput) => placeOrder(i) });
}

/**
 * Mounted once at the root:
 * - live stock/price patches → re-quote the cart (debounced; only active queries refetch)
 * - logged in: private Broadcast `cart:<uid>` → re-quote (cart changed on another device)
 * - logged in: keep the local mirror in step with the server cart
 */
export function CartSync() {
  const qc = useQueryClient();
  const uid = useUserId();

  // Live catalog events → re-quote.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useLiveCatalog.subscribe(() => {
      if (Object.keys(useGuestCart.getState().lines).length === 0) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void qc.invalidateQueries({ queryKey: cartQuoteKey }), 800);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [qc]);

  // Cross-device sync over the private Broadcast topic.
  useEffect(() => {
    if (!uid) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeCartChanges(uid, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void qc.invalidateQueries({ queryKey: cartQuoteKey }), 500);
    });
    return () => {
      if (t) clearTimeout(t);
      unsubscribe();
    };
  }, [qc, uid]);

  // Logged in: fetch the server cart in the background so the cart bar is right on launch.
  useCartQuote({ enabled: !!uid });

  return null;
}
