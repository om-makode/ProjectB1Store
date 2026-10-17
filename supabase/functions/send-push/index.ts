// send-push: turns pending `notifications` rows into Expo push messages.
// Called by the `notifications_dispatch_push` trigger and the `push-sweep` cron job
// (migration 20261101050000_p5_order_tracking_notifications.sql) through pg_net, with the
// header `x-webhook-secret` = Vault secret `send_push_secret` = function secret PUSH_WEBHOOK_SECRET.
// Deploy: npx supabase functions deploy send-push --no-verify-jwt   (see docs/required/NEXT_STEPS.md)
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Lang = 'en' | 'mr' | 'hi';
type Localized = Partial<Record<Lang, string>>;
type PendingRow = {
  notification_id: number;
  type: string;
  title: Localized;
  body: Localized;
  data: Record<string, unknown>;
  language: Lang;
  tokens: string[];
};
type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: string;
  sound: string | null;
  priority: 'default' | 'high';
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Android channel per notification type. Channel ids must match the app
// (mobile/src/features/notifications/push.ts: orders, store_orders, stock, offers, reminders).
type Route = Pick<ExpoMessage, 'channelId' | 'sound' | 'priority'>;
const ORDERS: Route = { channelId: 'orders', sound: 'default', priority: 'high' };
const ROUTING: Record<string, Route> = {
  order_status: ORDERS,
  order_items_changed: ORDERS,
  issue_update: { ...ORDERS, priority: 'default' },
  refund_update: { ...ORDERS, priority: 'default' },
  back_in_stock: { channelId: 'stock', sound: null, priority: 'default' },
  price_drop: { channelId: 'offers', sound: null, priority: 'default' },
  campaign: { channelId: 'offers', sound: null, priority: 'default' },
  campaign_test: { channelId: 'offers', sound: null, priority: 'default' },
  announcement: { channelId: 'offers', sound: null, priority: 'default' },
  review_prompt: { channelId: 'reminders', sound: null, priority: 'default' },
  role_changed: { channelId: 'reminders', sound: null, priority: 'default' },
  // Staff (Phase 6). A custom alarm sound needs an asset + a new channel id; see PHASE_6.
  new_order: { channelId: 'store_orders', sound: 'default', priority: 'high' },
  new_issue: { channelId: 'store_orders', sound: 'default', priority: 'high' },
};

const pick = (v: Localized, lang: Lang) =>
  v?.[lang] || v?.en || Object.values(v ?? {}).find(Boolean) || '';

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Atomically claims a batch (sets pushed_at), so a trigger call and the sweep never double-send.
  const { data, error } = await supabase.rpc('claim_pending_push', { p_limit: 300 });
  if (error) return new Response(error.message, { status: 500 });

  const messages: ExpoMessage[] = [];
  for (const row of (data ?? []) as PendingRow[]) {
    const route = ROUTING[row.type] ?? ORDERS;
    for (const to of row.tokens) {
      messages.push({
        to,
        title: pick(row.title, row.language),
        body: pick(row.body, row.language),
        data: { ...row.data, notification_id: row.notification_id },
        ...route,
      });
    }
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional "enhanced push security"
  const deadTokens: string[] = [];

  for (let i = 0; i < messages.length; i += 100) {
    // Expo accepts up to 100 messages per request
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error('expo push failed', res.status, await res.text());
      continue;
    }
    const { data: tickets } = (await res.json()) as {
      data: { status: 'ok' | 'error'; details?: { error?: string } }[];
    };
    tickets.forEach((t, j) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
        deadTokens.push(chunk[j]!.to);
      }
    });
  }

  if (deadTokens.length) await supabase.from('push_tokens').delete().in('token', deadTokens);
  return Response.json({ messages: messages.length, removedTokens: deadTokens.length });
});
