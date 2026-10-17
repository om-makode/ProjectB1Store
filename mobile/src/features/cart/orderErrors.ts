import { AppError, toAppError } from '@/lib/errors';

import type { Quote } from './api';

/** Machine codes raised by the Phase 4 RPCs (plus NETWORK / UNKNOWN from the app). */
export const ORDER_ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'LOGIN_REQUIRED',
  'CART_EMPTY',
  'CART_NEEDS_REVIEW',
  'ADDRESS_REQUIRED',
  'ADDRESS_NOT_FOUND',
  'NOT_SERVICEABLE',
  'STORE_CLOSED',
  'BELOW_MIN_ORDER',
  'COD_NOT_ALLOWED',
  'COD_LIMIT_EXCEEDED',
  'ACCOUNT_BLOCKED',
  'TOO_MANY_OPEN_ORDERS',
  'RATE_LIMITED',
  'PRICE_CHANGED',
  'PAYMENT_METHOD_UNAVAILABLE',
  'STOCK_CHANGED',
  'OUT_OF_STOCK',
  'VARIANT_NOT_FOUND',
  'CART_TOO_LARGE',
  'NOTE_TOO_LONG',
  'IDEMPOTENCY_KEY_REQUIRED',
  'MAINTENANCE',
  'NETWORK',
  'UNKNOWN',
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** What the user can do about it. */
export type Recovery =
  | 'reviewCart' // re-quote, show what changed, "Update cart"
  | 'changeAddress'
  | 'addMore'
  | 'viewOrders'
  | 'login'
  | 'retry' // same idempotency key: safe
  | 'help'
  | 'none';

const RECOVERY: Record<OrderErrorCode, Recovery> = {
  NOT_AUTHENTICATED: 'login',
  LOGIN_REQUIRED: 'login',
  CART_EMPTY: 'addMore',
  CART_NEEDS_REVIEW: 'reviewCart',
  ADDRESS_REQUIRED: 'changeAddress',
  ADDRESS_NOT_FOUND: 'changeAddress',
  NOT_SERVICEABLE: 'changeAddress',
  STORE_CLOSED: 'none',
  BELOW_MIN_ORDER: 'addMore',
  COD_NOT_ALLOWED: 'help',
  COD_LIMIT_EXCEEDED: 'reviewCart',
  ACCOUNT_BLOCKED: 'help',
  TOO_MANY_OPEN_ORDERS: 'viewOrders',
  RATE_LIMITED: 'none',
  PRICE_CHANGED: 'reviewCart',
  PAYMENT_METHOD_UNAVAILABLE: 'none',
  STOCK_CHANGED: 'reviewCart',
  OUT_OF_STOCK: 'reviewCart',
  VARIANT_NOT_FOUND: 'reviewCart',
  CART_TOO_LARGE: 'reviewCart',
  NOTE_TOO_LONG: 'none',
  IDEMPOTENCY_KEY_REQUIRED: 'retry',
  MAINTENANCE: 'none',
  NETWORK: 'retry',
  UNKNOWN: 'retry',
};

export const recoveryFor = (code: OrderErrorCode): Recovery => RECOVERY[code];

const isCode = (v: string): v is OrderErrorCode =>
  (ORDER_ERROR_CODES as readonly string[]).includes(v);

/** Pull the machine code (and the fresh quote, when the server attached one) out of any error. */
export function parseOrderError(e: unknown): { code: OrderErrorCode; quote: Quote | null } {
  const err: AppError = toAppError(e);
  if (err.kind === 'network') return { code: 'NETWORK', quote: null };
  const raw = err.message.trim();
  const code: OrderErrorCode = isCode(raw) ? raw : 'UNKNOWN';
  let quote: Quote | null = null;
  if (typeof err.details === 'string' && err.details.startsWith('{')) {
    try {
      quote = JSON.parse(err.details) as Quote;
    } catch {
      quote = null;
    }
  }
  return { code, quote };
}

/** Blockers that the cart screen shows; login/address/payment ones are handled at checkout. */
export const CHECKOUT_STEP_BLOCKERS = new Set([
  'LOGIN_REQUIRED',
  'ADDRESS_REQUIRED',
  'ADDRESS_NOT_FOUND',
  'NOT_SERVICEABLE',
  'COD_NOT_ALLOWED',
  'COD_LIMIT_EXCEEDED',
  'PAYMENT_METHOD_UNAVAILABLE',
]);
