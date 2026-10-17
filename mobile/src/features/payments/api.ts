import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/helpers';

/** What create-payment returns: everything Razorpay Checkout needs. No secrets. */
export type PaymentSession = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  orderNumber: string;
  timeoutSeconds: number;
  prefill: { name: string; email: string; contact: string };
};

/** Razorpay Checkout success payload (same shape on native and web). */
export type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type VerifyResult = {
  result: 'confirmed' | 'pending' | 'refund_late' | 'refund_duplicate' | 'amount_mismatch';
  orderId: string;
};

/**
 * Error codes from the payment Edge Functions, plus app-side ones.
 * `payments_not_configured`: Razorpay keys aren't set yet (or the functions aren't deployed).
 */
export type PaymentErrorCode =
  | 'payments_not_configured'
  | 'unauthorized'
  | 'not_found'
  | 'not_payable'
  | 'hold_expired'
  | 'bad_signature'
  | 'provider_error'
  | 'checkout_unavailable'
  | 'dismissed'
  | 'failed'
  | 'network';

export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PaymentError';
  }
}

const KNOWN = new Set<string>([
  'payments_not_configured',
  'unauthorized',
  'not_found',
  'not_payable',
  'hold_expired',
  'bad_signature',
  'provider_error',
]);

/** Call an Edge Function and turn its `{ error }` replies into PaymentError codes. */
async function invoke<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body: body as object });
  if (!error) return data as T;

  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    const reply = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (reply?.error && KNOWN.has(reply.error))
      throw new PaymentError(reply.error as PaymentErrorCode);
    // Function not deployed yet → 404 without our JSON.
    if (ctx.status === 404) throw new PaymentError('payments_not_configured');
    throw new PaymentError('provider_error', reply?.error);
  }
  throw new PaymentError('network', error.message);
}

export const createPayment = (orderId: string) =>
  invoke<PaymentSession>('create-payment', { orderId });

export const verifyPayment = (res: CheckoutSuccess) => invoke<VerifyResult>('verify-payment', res);

/** Customer: give up on paying online and pay on delivery instead (re-checks COD limits). */
export const switchOrderToCod = async (orderId: string) =>
  unwrap(getSupabase().rpc('switch_order_to_cod', { p_order_id: orderId }));

export type PaymentAttempt = Pick<
  Tables<'payments'>,
  'id' | 'status' | 'method' | 'amount' | 'error_description' | 'created_at'
>;
export type Refund = Pick<
  Tables<'refunds'>,
  'id' | 'amount' | 'reason' | 'status' | 'provider_refund_id' | 'created_at' | 'updated_at'
>;

export type OrderPayments = { attempts: PaymentAttempt[]; refunds: Refund[] };

export async function fetchOrderPayments(orderId: string): Promise<OrderPayments> {
  const [attempts, refunds] = await Promise.all([
    unwrap(
      getSupabase()
        .from('payments')
        .select('id, status, method, amount, error_description, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false }),
    ),
    unwrap(
      getSupabase()
        .from('refunds')
        .select('id, amount, reason, status, provider_refund_id, created_at, updated_at')
        .eq('order_id', orderId)
        .order('created_at'),
    ),
  ]);
  return { attempts: attempts as PaymentAttempt[], refunds: refunds as Refund[] };
}

// ---------- admin ----------

export type AdminRefund = Tables<'refunds'> & {
  orders: Pick<Tables<'orders'>, 'order_number' | 'grand_total'> | null;
};

export const fetchAdminRefunds = async (filter: 'attention' | 'all'): Promise<AdminRefund[]> => {
  let q = getSupabase()
    .from('refunds')
    .select('*, orders(order_number, grand_total)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (filter === 'attention') q = q.in('status', ['pending', 'processing', 'failed']);
  return (await unwrap(q)) as unknown as AdminRefund[];
};

export const adminResolveRefund = async (refundId: string, note: string) =>
  unwrap(getSupabase().rpc('admin_resolve_refund', { p_refund_id: refundId, p_note: note }));
