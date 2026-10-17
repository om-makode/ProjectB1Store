// verify-payment: fast confirmation right after Razorpay Checkout succeeds.
// The webhook (razorpay-webhook) is the source of truth; this just makes the app feel instant.
// Deploy: npx supabase functions deploy verify-payment   (JWT verification ON)
import {
  adminClient,
  callerId,
  env,
  json,
  razorpayConfigured,
  rzp,
  verifyCheckoutSignature,
} from '../_shared/razorpay.ts';

type Body = { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
type RzpPayment = { id: string; order_id: string; status: string; amount: number; method: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!razorpayConfigured()) return json({ error: 'payments_not_configured' }, 503);

  const uid = await callerId(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.razorpay_order_id || !b.razorpay_payment_id || !b.razorpay_signature)
    return json({ error: 'bad_request' }, 400);

  // 1. Signature proves the response came from Razorpay Checkout for this order.
  const ok = await verifyCheckoutSignature(
    env('RAZORPAY_KEY_SECRET'),
    b.razorpay_order_id,
    b.razorpay_payment_id,
    b.razorpay_signature,
  );
  if (!ok) return json({ error: 'bad_signature' }, 400);

  const admin = adminClient();

  // 2. The caller must own this payment attempt.
  const { data: attempt } = await admin
    .from('payments')
    .select('order_id, user_id')
    .eq('provider_order_id', b.razorpay_order_id)
    .maybeSingle();
  if (!attempt || attempt.user_id !== uid) return json({ error: 'not_found' }, 404);

  // 3. A valid signature isn't proof of capture: ask Razorpay for the payment itself.
  try {
    const payment = await rzp<RzpPayment>(`/payments/${b.razorpay_payment_id}`);
    if (payment.order_id !== b.razorpay_order_id) return json({ error: 'order_mismatch' }, 400);

    if (payment.status === 'captured') {
      const { data, error } = await admin.rpc('confirm_payment', {
        p_provider_order_id: b.razorpay_order_id,
        p_provider_payment_id: payment.id,
        p_amount_paise: payment.amount,
        p_method: payment.method,
        p_raw: payment,
      });
      if (error) throw error;
      const result = data === 'confirmed' || data === 'already_confirmed' ? 'confirmed' : data;
      return json({ result, orderId: attempt.order_id });
    }
    // 'authorized' → auto-capture follows; the webhook confirms the order.
    return json({ result: 'pending', orderId: attempt.order_id });
  } catch (e) {
    console.error('verify-payment failed', String(e));
    return json({ result: 'pending', orderId: attempt.order_id }); // webhook will settle it
  }
});
