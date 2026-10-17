// razorpay-webhook: server-to-server events from Razorpay, the source of truth for payments
// and refunds. Authenticated by X-Razorpay-Signature (HMAC of the RAW body), not a Supabase JWT.
// Deploy: npx supabase functions deploy razorpay-webhook --no-verify-jwt
// Razorpay Dashboard → Webhooks: https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
// Events: payment.captured, payment.failed, order.paid, refund.processed, refund.failed
import { adminClient, env, verifyWebhookSignature } from '../_shared/razorpay.ts';

const text = (body: string, status: number) => new Response(body, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('method not allowed', 405);
  if (!env('RAZORPAY_WEBHOOK_SECRET')) return text('payments not configured', 503);

  const raw = await req.text(); // verify BEFORE parsing: re-serialising changes the bytes
  const ok = await verifyWebhookSignature(
    env('RAZORPAY_WEBHOOK_SECRET'),
    raw,
    req.headers.get('x-razorpay-signature') ?? '',
  );
  if (!ok) return text('bad signature', 400);

  // deno-lint-ignore no-explicit-any
  const body = JSON.parse(raw) as any;
  const eventId = req.headers.get('x-razorpay-event-id') ?? `${body.event}:${body.created_at}:${crypto.randomUUID()}`;
  const admin = adminClient();

  // Exactly once: first writer wins; a redelivery returns 200 and does nothing.
  const { error: dup } = await admin
    .from('payment_webhook_events')
    .insert({ event_id: eventId, event: body.event, payload: body });
  if (dup?.code === '23505') return text('duplicate', 200);
  if (dup) return text('retry', 500);

  try {
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid': {
        const p = body.payload?.payment?.entity;
        if (!p) break;
        const { error } = await admin.rpc('confirm_payment', {
          p_provider_order_id: p.order_id,
          p_provider_payment_id: p.id,
          p_amount_paise: p.amount,
          p_method: p.method,
          p_raw: p,
        });
        if (error) throw error;
        break;
      }
      case 'payment.failed': {
        const p = body.payload?.payment?.entity;
        if (!p) break;
        const { error } = await admin.rpc('fail_payment', {
          p_provider_order_id: p.order_id,
          p_code: p.error_code ?? null,
          p_description: p.error_description ?? null,
          p_raw: p,
        });
        if (error) throw error;
        break;
      }
      case 'refund.processed':
      case 'refund.failed': {
        const r = body.payload?.refund?.entity;
        if (!r) break;
        const { error } = await admin.rpc('mark_refund_result', {
          p_provider_refund_id: r.id,
          p_status: body.event === 'refund.processed' ? 'processed' : 'failed',
          p_error: r.error_description ?? null,
        });
        if (error) throw error;
        break;
      }
      default:
        break; // other events are stored for the record only
    }
    await admin
      .from('payment_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', eventId);
    return text('ok', 200);
  } catch (e) {
    console.error('webhook processing failed', body.event, String(e));
    // Remove the row so Razorpay's retry can process the event again.
    await admin.from('payment_webhook_events').delete().eq('event_id', eventId);
    return text('retry', 500);
  }
});
