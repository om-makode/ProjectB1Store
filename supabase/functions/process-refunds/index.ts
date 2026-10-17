// process-refunds: sends queued refunds (public.refunds pending/failed, < 5 attempts) to Razorpay.
// Called every 2 minutes by the `process-refunds` pg_cron job (migration p10) through pg_net,
// with header x-internal-secret = Vault internal_cron_secret = function secret INTERNAL_CRON_SECRET.
// Deploy: npx supabase functions deploy process-refunds --no-verify-jwt
import {
  adminClient,
  isInternalCall,
  json,
  razorpayConfigured,
  rzp,
  toPaise,
} from '../_shared/razorpay.ts';

type Due = {
  id: string;
  amount: number;
  attempts: number;
  provider_refund_id: string | null;
  payments: { provider_payment_id: string | null } | null;
};
type RzpRefund = { id: string; status: string; receipt?: string | null };

Deno.serve(async (req) => {
  if (!isInternalCall(req)) return json({ error: 'unauthorized' }, 401);
  if (!razorpayConfigured()) return json({ error: 'payments_not_configured' }, 503);

  const admin = adminClient();
  const { data: due, error } = await admin
    .from('refunds')
    .select('id, amount, attempts, provider_refund_id, payments!inner(provider_payment_id)')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 5)
    .order('created_at')
    .limit(20);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const r of (due ?? []) as unknown as Due[]) {
    const paymentId = r.payments?.provider_payment_id;
    if (!paymentId) continue;

    // Claim the row so two runs never refund it twice.
    const { data: claimed } = await admin
      .from('refunds')
      .update({ status: 'processing', attempts: r.attempts + 1 })
      .eq('id', r.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      // A timed-out earlier attempt may have created the refund anyway: look for our receipt first.
      let refund: RzpRefund | undefined;
      if (r.attempts > 0) {
        const list = await rzp<{ items: RzpRefund[] }>(`/payments/${paymentId}/refunds?count=100`);
        refund = list.items.find((x) => x.receipt === r.id);
      }
      refund ??= await rzp<RzpRefund>(`/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amount: toPaise(r.amount), // partial refunds allowed
          speed: 'normal', // 'optimum' = instant where possible, extra fee ⚠️
          receipt: r.id,
          notes: { refund_id: r.id },
        }),
      });

      await admin.from('refunds').update({ provider_refund_id: refund.id, last_error: null }).eq('id', r.id);
      if (refund.status === 'processed') {
        await admin.rpc('mark_refund_result', {
          p_provider_refund_id: refund.id,
          p_status: 'processed',
          p_error: null,
        });
      }
      // otherwise it stays 'processing' until the refund.processed / refund.failed webhook
      sent++;
    } catch (e) {
      await admin.from('refunds').update({ status: 'failed', last_error: String(e).slice(0, 500) }).eq('id', r.id);
    }
  }
  return json({ processed: sent, due: due?.length ?? 0 });
});
