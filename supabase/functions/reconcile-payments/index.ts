// reconcile-payments: daily check that every payment Razorpay captured is known to us.
// Called at 06:00 IST by the `reconcile-payments` pg_cron job (migration p10) with the same
// x-internal-secret header as process-refunds. Writes problems to public.payment_mismatches
// (Admin → Payments). Deploy: npx supabase functions deploy reconcile-payments --no-verify-jwt
import { adminClient, isInternalCall, json, razorpayConfigured, rzp } from '../_shared/razorpay.ts';

type RzpPayment = { id: string; order_id: string | null; status: string; amount: number };

Deno.serve(async (req) => {
  if (!isInternalCall(req)) return json({ error: 'unauthorized' }, 401);
  if (!razorpayConfigured()) return json({ error: 'payments_not_configured' }, 503);

  const admin = adminClient();
  const to = Math.floor(Date.now() / 1000);
  const from = to - 2 * 24 * 3600; // last 48 hours (overlap is harmless)

  let skip = 0;
  let checked = 0;
  let mismatches = 0;
  for (let page = 0; page < 20; page++) {
    const list = await rzp<{ items: RzpPayment[] }>(
      `/payments?from=${from}&to=${to}&count=100&skip=${skip}`,
    );
    for (const p of list.items) {
      if (p.status !== 'captured' && p.status !== 'refunded') continue;
      checked++;
      const { data: mine } = await admin
        .from('payments')
        .select('provider_payment_id, status, amount')
        .eq('provider_order_id', p.order_id ?? '')
        .maybeSingle();

      let kind: string | null = null;
      if (!mine) kind = 'missing_locally';
      else if (mine.status !== 'captured') kind = 'status_differs';
      else if (Math.round(Number(mine.amount) * 100) !== p.amount) kind = 'amount_differs';
      if (!kind) continue;

      // One open mismatch per payment and kind.
      const { data: open } = await admin
        .from('payment_mismatches')
        .select('id')
        .eq('provider_payment_id', p.id)
        .eq('kind', kind)
        .is('resolved_at', null)
        .maybeSingle();
      if (open) continue;
      await admin.from('payment_mismatches').insert({
        provider_payment_id: p.id,
        provider_order_id: p.order_id,
        kind,
        details: { razorpay: p, local: mine ?? null },
      });
      mismatches++;
    }
    if (list.items.length < 100) break;
    skip += 100;
  }
  return json({ checked, mismatches });
});
