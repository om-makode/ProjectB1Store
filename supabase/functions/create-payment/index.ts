// create-payment: create (or reuse) a Razorpay order for one of OUR orders.
// The amount comes only from orders.grand_total; the app sends just { orderId }.
// Deploy: npx supabase functions deploy create-payment   (JWT verification ON)
import {
  RazorpayError,
  adminClient,
  callerId,
  env,
  json,
  razorpayConfigured,
  rzp,
  toPaise,
} from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!razorpayConfigured()) return json({ error: 'payments_not_configured' }, 503);

  const uid = await callerId(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) return json({ error: 'bad_request' }, 400);

  const admin = adminClient();

  // OUR order: the caller's, awaiting payment, hold not expired.
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, user_id, status, grand_total, payment_expires_at')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || order.user_id !== uid) return json({ error: 'not_found' }, 404);
  if (order.status !== 'awaiting_payment')
    return json({ error: 'not_payable', status: order.status }, 409);
  const secondsLeft = Math.floor((Date.parse(order.payment_expires_at) - Date.now()) / 1000);
  if (!(secondsLeft >= 60)) return json({ error: 'hold_expired' }, 409);

  const amountPaise = toPaise(order.grand_total);

  try {
    // Reuse an open Razorpay order for the same amount (a retry must not create a 2nd payment).
    const { data: existing } = await admin
      .from('payments')
      .select('provider_order_id')
      .eq('order_id', order.id)
      .in('status', ['created', 'failed'])
      .eq('amount', order.grand_total)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let providerOrderId = existing?.provider_order_id as string | undefined;
    if (!providerOrderId) {
      const created = await rzp<{ id: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: String(order.order_number).slice(0, 40),
          notes: { order_id: order.id },
        }),
      });
      providerOrderId = created.id;
      const { error } = await admin.from('payments').insert({
        order_id: order.id,
        user_id: uid,
        provider_order_id: providerOrderId,
        amount: order.grand_total,
      });
      if (error) throw error;
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', uid)
      .maybeSingle();

    return json({
      keyId: env('RAZORPAY_KEY_ID'), // public key id (test or live, decided by server secrets)
      razorpayOrderId: providerOrderId,
      amountPaise,
      currency: 'INR',
      orderNumber: order.order_number,
      timeoutSeconds: Math.max(60, secondsLeft - 30), // Checkout closes before our hold ends
      prefill: {
        name: profile?.full_name ?? '',
        email: profile?.email ?? '',
        contact: profile?.phone ?? '',
      },
    });
  } catch (e) {
    console.error('create-payment failed', e instanceof RazorpayError ? e.code : '', String(e));
    return json({ error: 'provider_error' }, 502);
  }
});
