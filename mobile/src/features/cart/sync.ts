import { useAuth } from '@/features/auth/store';
import i18n from '@/i18n';
import { logger } from '@/lib/logger';
import { queryClient } from '@/lib/queryClient';
import { showToast } from '@/ui/Toast';

import { mergeGuestCart, setCartQuantity, type Quote } from './api';
import { useGuestCart, type CartLine } from './store';

/**
 * One cart facade for both modes.
 * - The local store (useGuestCart) is the instant, optimistic copy every screen reads.
 * - Guests: that's all; the server only prices it (quote_guest_cart).
 * - Logged in: each change is also written to cart_items via set_cart_quantity
 *   (debounced per item), and the local copy is rebuilt from the server quote whenever
 *   no write is pending, so other devices' changes show up too.
 */

const DEBOUNCE_MS = 350;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let inFlight = 0;

export const cartQuoteKey = ['cartQuote'] as const;

const isLoggedIn = () => !!useAuth.getState().session;

/** True when no local change is waiting to reach the server. */
export const isCartIdle = () => timers.size === 0 && inFlight === 0;

function refreshQuote() {
  void queryClient.invalidateQueries({ queryKey: cartQuoteKey });
}

function scheduleWrite(variantId: number) {
  if (!isLoggedIn()) return;
  const prev = timers.get(variantId);
  if (prev) clearTimeout(prev);
  timers.set(
    variantId,
    setTimeout(() => {
      timers.delete(variantId);
      void writeNow(variantId);
    }, DEBOUNCE_MS),
  );
}

async function writeNow(variantId: number) {
  const wanted = useGuestCart.getState().lines[variantId]?.qty ?? 0;
  inFlight += 1;
  try {
    const res = await setCartQuantity(variantId, wanted);
    if (res.quantity !== wanted && wanted > 0) {
      useGuestCart.getState().setQty(variantId, res.quantity);
      showToast(
        res.clamp_reason === 'stock'
          ? i18n.t('checkout.onlyLeft', { count: res.quantity })
          : i18n.t('cart.maxPerOrder', { max: res.quantity }),
        'warning',
      );
    }
  } catch (e) {
    logger.warn('cart write failed', String(e));
    const msg = e instanceof Error ? e.message : '';
    showToast(
      msg === 'OUT_OF_STOCK' ? i18n.t('orderErrors.OUT_OF_STOCK') : i18n.t('errors.server'),
      'danger',
    );
  } finally {
    inFlight -= 1;
    if (isCartIdle()) refreshQuote();
  }
}

type AddInput = Omit<CartLine, 'qty'>;

export const cart = {
  add(line: AddInput) {
    useGuestCart.getState().add(line);
    scheduleWrite(line.variantId);
  },
  increment(variantId: number, maxQty?: number) {
    useGuestCart.getState().increment(variantId, maxQty);
    scheduleWrite(variantId);
  },
  decrement(variantId: number) {
    useGuestCart.getState().decrement(variantId);
    scheduleWrite(variantId);
  },
  setQty(variantId: number, qty: number) {
    useGuestCart.getState().setQty(variantId, qty);
    scheduleWrite(variantId);
  },
};

/** Quote line → local cart line. */
export function lineFromQuote(l: Quote['lines'][number]): CartLine {
  const cap = Math.min(l.max_per_order, 50);
  const maxQty = l.flags.includes('out_of_stock')
    ? 0
    : l.stock_left != null
      ? Math.min(l.stock_left, cap)
      : cap;
  return {
    variantId: l.variant_id,
    productId: l.product_id,
    slug: l.slug,
    name: l.name,
    label: l.variant_label,
    thumbPath: l.image_path,
    isVeg: l.is_veg,
    price: l.price,
    mrp: l.mrp,
    qty: l.quantity,
    maxQty,
  };
}

/** Logged in: make the local copy match the server cart (skipped while writes are pending). */
export function reconcileFromQuote(q: Quote) {
  if (!isLoggedIn() || !isCartIdle()) return;
  useGuestCart.getState().replaceAll(q.lines.map(lineFromQuote));
}

/** Guests: keep local prices/limits in step with the server quote (quantities untouched). */
export function syncGuestFromQuote(q: Quote) {
  const { sync } = useGuestCart.getState();
  for (const l of q.lines) {
    const { price, mrp, maxQty } = lineFromQuote(l);
    sync(l.variant_id, { price, mrp, maxQty });
  }
}

/** Right after login: push the phone's cart into cart_items (takes the larger qty, never doubles). */
export async function mergeGuestCartAfterLogin() {
  const lines = Object.values(useGuestCart.getState().lines);
  if (lines.length === 0) return refreshQuote();
  inFlight += 1; // the local copy must not be replaced by the server cart until this lands
  try {
    await mergeGuestCart(lines.map((l) => ({ variant_id: l.variantId, quantity: l.qty })));
  } catch (e) {
    logger.warn('merge guest cart failed', String(e));
  } finally {
    inFlight -= 1;
  }
  refreshQuote();
}

/** After logout the cart belonged to that account: drop the local copy. */
export function clearLocalCart() {
  timers.forEach(clearTimeout);
  timers.clear();
  useGuestCart.getState().clear();
}
