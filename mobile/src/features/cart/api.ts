import type { LocalizedString } from '@/i18n/localize';
import { unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

/** Shapes returned by private._quote (supabase/migrations/…_p4_cart_orders.sql). */
export type QuoteFlag = 'out_of_stock' | 'low_stock' | 'over_limit' | 'price_changed';

export type QuoteLine = {
  variant_id: number;
  product_id: number;
  slug: string;
  name: LocalizedString;
  variant_label: LocalizedString;
  is_veg: boolean | null;
  image_path: string | null;
  mrp: number;
  price: number;
  price_at_add: number | null;
  quantity: number;
  billable_quantity: number;
  max_per_order: number;
  stock_left: number | null;
  line_total: number;
  line_mrp_total: number;
  flags: QuoteFlag[];
};

export type Blocker = {
  code: string;
  opens_at?: string | null;
  message?: LocalizedString | null;
  amount_needed?: number;
  min_order_value?: number;
  max_cod_order_value?: number;
  distance_km?: number;
  max?: number;
};

export type PaymentOption = {
  method: 'cod' | 'upi';
  allowed: boolean;
  reason: string | null;
  limit?: number | null;
};

export type Quote = {
  store_id: number;
  address_id: string | null;
  payment_method: 'cod' | 'upi';
  lines: QuoteLine[];
  item_count: number;
  item_total: number;
  mrp_total: number;
  savings: number;
  delivery_fee: number;
  delivery_fee_waived: number;
  small_cart_fee: number;
  small_cart_threshold: number | null;
  packaging_fee: number;
  grand_total: number;
  free_delivery_above: number | null;
  add_for_free_delivery: number | null;
  min_order_value: number | null;
  eta_minutes: number | null;
  payment_methods: PaymentOption[];
  can_checkout: boolean;
  blockers: Blocker[];
  quoted_at: string;
};

export type OrderSummary = {
  order_id: string;
  order_number: string;
  status: string;
  payment_method: 'cod' | 'upi';
  grand_total: number;
  item_count: number;
  eta_minutes: number | null;
  placed_at: string;
  replayed: boolean;
};

export type SetQtyResult = {
  variant_id: number;
  quantity: number;
  clamped?: boolean;
  clamp_reason?: 'stock' | 'max_per_order' | null;
};

export type GuestItem = { variant_id: number; quantity: number; price_at_add?: number };

export const setCartQuantity = async (variantId: number, quantity: number) =>
  (await unwrap(
    getSupabase().rpc('set_cart_quantity', { p_variant_id: variantId, p_quantity: quantity }),
  )) as unknown as SetQtyResult;

export const mergeGuestCart = async (items: GuestItem[]) =>
  unwrap(getSupabase().rpc('merge_guest_cart', { p_items: items as unknown as Json }));

export const fixCart = async () => {
  await unwrap(getSupabase().rpc('fix_cart'));
};

export const getCartQuote = async (addressId: string | null, method: 'cod' | 'upi' = 'cod') =>
  (await unwrap(
    getSupabase().rpc('get_cart_quote', {
      ...(addressId ? { p_address_id: addressId } : {}),
      p_payment_method: method,
    }),
  )) as unknown as Quote;

export const quoteGuestCart = async (items: GuestItem[]) =>
  (await unwrap(
    getSupabase().rpc('quote_guest_cart', { p_items: items as unknown as Json }),
  )) as unknown as Quote;

export type PlaceOrderInput = {
  addressId: string;
  method: 'cod' | 'upi';
  note: string;
  idempotencyKey: string;
  expectedTotal: number;
};

export const placeOrder = async (i: PlaceOrderInput) =>
  (await unwrap(
    getSupabase().rpc('place_order', {
      p_address_id: i.addressId,
      p_payment_method: i.method,
      p_customer_note: i.note,
      p_idempotency_key: i.idempotencyKey,
      p_expected_total: i.expectedTotal,
    }),
  )) as unknown as OrderSummary;

/**
 * Live cart across devices: private Broadcast topic `cart:<uid>` (sent by a trigger on
 * cart_items). Returns an unsubscribe function. Silently does nothing when not configured.
 */
export function subscribeCartChanges(uid: string, onChange: () => void): () => void {
  let supabase: ReturnType<typeof getSupabase>;
  try {
    supabase = getSupabase();
  } catch {
    return () => {};
  }
  let cancelled = false;
  let channel: ReturnType<typeof supabase.channel> | undefined;
  void (async () => {
    try {
      await supabase.realtime.setAuth(); // private channels need the user's JWT
    } catch (e) {
      logger.warn('realtime setAuth failed', String(e));
    }
    if (cancelled) return;
    // The broadcast topic must stay `cart:<uid>`, so fully remove any leftover channel first:
    // channel() would otherwise return it (already subscribed) and `.on()` would throw.
    const topic = `realtime:cart:${uid}`;
    await Promise.all(
      supabase
        .getChannels()
        .filter((c) => c.topic === topic)
        .map((c) => supabase.removeChannel(c)),
    );
    if (cancelled) return;
    channel = supabase
      .channel(`cart:${uid}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, onChange)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('realtime: cart channel', status);
      });
  })();
  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
