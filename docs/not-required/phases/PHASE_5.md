# Phase 5: Orders: Live Tracking & Notifications

> **Goal:** after placing an order, the customer sees everything that happens to it **live**: accepted, packing, an item that turned out to be unavailable, out for delivery, delivered. They can cancel while it's still allowed, reorder in one tap, download the invoice, report a problem with photos, and get notifications even when the app is closed.
> **Duration:** about 1 week · **Depends on:** Phase 4 (Cart & Checkout) · **Next:** Phase 6 (Store Operations)

**Done when:**
- [ ] The **Orders** tab shows active orders on top (live) and past orders below (paginated)
- [ ] Changing an order's `status` in Supabase Studio updates the order screen on the customer phone in **about 1 second**, with no pull-to-refresh
- [ ] After the app has been in the background or offline, coming back shows the correct status (refetch on focus/reconnect)
- [ ] A customer can cancel while the order is `placed` or `confirmed`; stock goes back and a cancellation event is logged. After that, the button says "Call the store"
- [ ] **Reorder** puts every still-available item into the cart and lists what's missing
- [ ] A delivered order has an **invoice PDF** with the GST breakup, seller GSTIN and FSSAI
- [ ] Within 48 hours of delivery the customer can **report an issue** with up to 3 photos (private bucket)
- [ ] The 🔔 inbox lists notifications in the user's language, with an unread badge
- [ ] With the app **closed**, a status change produces a push notification on Android, and tapping it opens that order
- [ ] All pgTAP tests in `supabase/tests/0500_order_tracking.test.sql` pass

| # | Heading | Output |
|---|---|---|
| 5.0 | Migration foundation | `notifications`, `push_tokens`, `order_issues`, `notify_staff()`, Realtime publication |
| 5.1 | Orders tab (active + past) | `app/(shop)/orders.tsx`, `OrderCard`, `ActiveOrderBanner` |
| 5.2 | Live order detail & timeline | `app/order/[id].tsx`, `useMyOrdersRealtime`, `StatusTimeline` |
| 5.3 | Cancel order | `_cancel_order_internal()`, `cancel_order()`, `CancelOrderSheet` |
| 5.4 | Reorder | `reorder_to_cart()`, `ReorderButton` |
| 5.5 | Invoice PDF | `invoiceHtml.ts`, `gst.ts`, expo-print |
| 5.6 | Report an issue (photos) | `issues` bucket + policies, `report_order_issue()`, `app/order/[id]/issue.tsx` |
| 5.7 | In-app notifications inbox | `order_status_message()`, `notify_order_status` trigger, back-in-stock wiring, inbox screen, bell badge |
| 5.8 | Push: tokens, Edge Function, webhook | `register_push_token()`, `claim_pending_push()`, `dispatch_push` trigger, `supabase/functions/send-push`, Android channels |

**Migration file:** `supabase/migrations/0500_order_tracking_notifications.sql`. It is made of the SQL blocks in this file, **in heading order** (5.0 → 5.8). Every block is idempotent where Postgres allows it (`create or replace`, `if not exists`), so re-running locally with `supabase db reset` is safe.

**Error convention (same as Phase 4):** RPCs `raise exception '<CODE>'` (SQLSTATE `P0001`). The app maps `error.message` to the i18n key `errors.<CODE>`. Codes added in this phase: `NOT_AUTHENTICATED`, `ORDER_NOT_FOUND`, `ORDER_FINAL`, `CANCEL_NOT_ALLOWED`, `INVALID_REASON`, `ISSUE_WINDOW_CLOSED`, `ISSUE_LIMIT`, `PHOTO_REQUIRED`, `INVALID_PHOTO_PATH`, `INVALID_TOKEN`.

**Assumed from Phase 4** (check before starting): customers have `select` RLS on their own `orders`, `order_items` and `order_status_events`; `orders.id` is `uuid`; `order_items.id`, `stores.id` and `product_variants.id` are `bigint`; `set_updated_at()` is attached to `orders`; `place_order()` locks `inventory` rows **ordered by `variant_id`** (we use the same order here so cancels and checkouts never deadlock).

---

## 5.0 Migration foundation

**Goal:** the tables every heading below needs, plus Realtime.

**SQL**
```sql
-- 0500 part 0: foundation ------------------------------------------------------
create extension if not exists pg_net with schema extensions;   -- HTTP calls from Postgres (5.8)

-- Notifications: the in-app inbox (5.7) and the source of every push (5.8)
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'order_status','order_items_changed','back_in_stock',
                'issue_update','new_order','new_issue','announcement')),
  title       jsonb not null,             -- {"en","mr","hi"}
  body        jsonb not null,
  data        jsonb not null default '{}'::jsonb,   -- {order_id, url, ...}
  read_at     timestamptz,
  pushed_at   timestamptz,                -- set when send-push claims it (5.8)
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx      on public.notifications (user_id) where read_at is null;
create index if not exists notifications_pending_push_idx on public.notifications (id) where pushed_at is null;

alter table public.notifications enable row level security;
drop policy if exists "notifications: read own"   on public.notifications;
drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: read own"   on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
-- No insert/update policy: rows are written by triggers/RPCs; "mark read" is an RPC (5.7).

-- Expo push tokens, one row per device
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text not null check (platform in ('android','ios','web')),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "push_tokens: read own" on public.push_tokens;
create policy "push_tokens: read own" on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
-- Writes only through register/unregister RPCs (a device can move between accounts).

-- Problems reported after delivery (5.6)
create table if not exists public.order_issues (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  order_item_id    bigint references public.order_items(id) on delete set null,
  type             public.issue_type not null,
  message          text check (char_length(message) <= 1000),
  photo_paths      text[] not null default '{}',
  status           public.issue_status not null default 'open',
  resolution_note  text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists order_issues_order_idx  on public.order_issues (order_id);
create index if not exists order_issues_status_idx on public.order_issues (status, created_at);
alter table public.order_issues enable row level security;
drop policy if exists "order_issues: read own" on public.order_issues;
create policy "order_issues: read own" on public.order_issues for select to authenticated using (user_id = (select auth.uid()));
-- Staff policies come in Phase 6.

-- Helper: one notification for every staff/admin account (used here for new issues,
-- and in Phase 6 for new orders). Single store today; becomes store-scoped later.
create or replace function public.notify_staff(
  p_store_id bigint, p_type text, p_title jsonb, p_body jsonb, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, data)
  select p.id, p_type, p_title, p_body, p_data || jsonb_build_object('store_id', p_store_id)
  from public.profiles p
  where p.role in ('staff','admin') and not p.is_blocked;
$$;
revoke execute on function public.notify_staff(bigint, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Realtime: orders + notifications (plan Section 5). Add only if missing, so re-runs don't fail.
do $$
declare t text;
begin
  foreach t in array array['orders','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
```

**Realtime notes (read once, they save hours)**
- `postgres_changes` **respects RLS**: each subscriber only receives rows its JWT is allowed to `select`. A customer subscribed to `orders` with `filter: user_id=eq.<uid>` gets only their own rows, and the staff board (Phase 6) gets all rows because of the staff policy.
- The **new** row is always sent in full. The **old** row only contains the primary key unless the table has `REPLICA IDENTITY FULL`. We don't need the old row: the app compares against its own cache. So keep the default replica identity (cheaper WAL, fewer bytes on the free tier).
- `DELETE` events can't be RLS-checked, so we never rely on them (orders are never deleted).
- Item-level changes (an item marked unavailable) always also update the parent `orders` row (totals, `updated_at`), so **one channel on `orders` is enough**. We don't publish `order_items`.

**Checks**
- `select * from pg_publication_tables where pubname = 'supabase_realtime';` lists `orders` and `notifications`.
- As a customer in the SQL editor (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uid>"}';`): `insert into notifications …` fails with an RLS error.

---

## 5.1 Orders tab (active + past)

**Goal:** one tab that answers "where is my order?" first and "what did I buy last time?" second.

**Files**
```
mobile/app/(shop)/orders.tsx
mobile/src/features/orders/api.ts
mobile/src/features/orders/hooks.ts
mobile/src/features/orders/components/OrderCard.tsx
mobile/src/features/orders/components/ActiveOrderBanner.tsx   # also shown on Home
mobile/src/features/orders/status.ts                          # status lists, colours, i18n keys
```

**SQL:** none. (Phase 4 indexes `orders (user_id, placed_at desc)`; add it here if it's missing:)
```sql
-- 0500 part 1
create index if not exists orders_user_placed_idx on public.orders (user_id, placed_at desc);
```

**Steps**
1. Status constants, shared by every order screen:
   ```ts
   // src/features/orders/status.ts
   import type { Database } from '@/types/database';
   export type OrderStatus = Database['public']['Enums']['order_status'];

   export const ACTIVE_STATUSES: OrderStatus[] = ['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery'];
   export const TIMELINE: OrderStatus[] = ['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery', 'delivered'];
   export const isActive = (s: OrderStatus) => ACTIVE_STATUSES.includes(s);
   export const CUSTOMER_CAN_CANCEL: OrderStatus[] = ['placed', 'confirmed'];
   ```
2. Queries. List rows only need summary columns; `order_items(count)` returns the count without the lines:
   ```ts
   // src/features/orders/api.ts
   const LIST_COLUMNS =
     'id, order_number, status, grand_total, payment_method, placed_at, delivered_at, cancelled_at, order_items(count)';

   export async function fetchActiveOrders() {
     const { data, error } = await supabase
       .from('orders').select(LIST_COLUMNS)
       .in('status', ACTIVE_STATUSES)
       .order('placed_at', { ascending: false });
     if (error) throw error;
     return data;
   }

   export async function fetchPastOrders(page: number, size = 15) {
     const from = page * size;
     const { data, error } = await supabase
       .from('orders').select(LIST_COLUMNS)
       .in('status', ['delivered', 'cancelled'])
       .order('placed_at', { ascending: false })
       .range(from, from + size - 1);
     if (error) throw error;
     return data;
   }
   ```
   RLS already limits rows to the logged-in user, so there's no `user_id` filter in the query (and no way to fake one).
3. Hooks with stable keys, because Realtime (5.2) invalidates by key:
   ```ts
   export const orderKeys = {
     all: ['orders'] as const,
     active: ['orders', 'active'] as const,
     past: ['orders', 'past'] as const,
     detail: (id: string) => ['orders', 'detail', id] as const,
   };
   export const useActiveOrders = () => useQuery({ queryKey: orderKeys.active, queryFn: fetchActiveOrders });
   export const usePastOrders = () => useInfiniteQuery({
     queryKey: orderKeys.past,
     queryFn: ({ pageParam }) => fetchPastOrders(pageParam),
     initialPageParam: 0,
     getNextPageParam: (last, all) => (last.length < 15 ? undefined : all.length),
   });
   ```
4. Screen: a `FlashList` whose header holds the active orders (big cards with a live status line and a pulsing dot) and whose body holds past orders (compact cards: date, items count, total, "Delivered"/"Cancelled" chip, **Reorder** button). Guests see "Log in to see your orders" with the login button (`useRequireLogin`).
5. `ActiveOrderBanner`: on Home and Categories, above the floating cart bar: "🟢 NK-261016-0042 · Packing your order ›". It is hidden when there are no active orders. It uses the same `useActiveOrders()` cache, so it costs no extra request.
6. Pull-to-refresh is there for confidence, but it shouldn't be needed (5.2).

**Checks**
- With 2 active and 20 past orders: active ones appear first, and past ones load 15 then 5 more on scroll.
- Logged out: no request is made and the login prompt shows.

**Tests**
- RNTL: `OrderCard` renders each status with the right chip/colour and an accessible label ("Order NK-…, packing, 412 rupees").
- Unit: `isActive`, `TIMELINE` order.

---

## 5.2 Live order detail & timeline

**Goal:** the order screen is always right without the user doing anything.

**Files**
```
mobile/app/order/[id].tsx
mobile/src/features/orders/useMyOrdersRealtime.ts     # one app-wide channel per logged-in user
mobile/src/features/orders/components/StatusTimeline.tsx
mobile/src/features/orders/components/OrderLines.tsx
mobile/src/features/orders/components/OrderBill.tsx    # reuses BillDetails from Phase 4
mobile/src/lib/realtime.ts                             # (extend) connection state for the "Live" dot
```

**SQL:** none (Realtime set up in 5.0).

**Steps**
1. Detail query: order + lines + events + the store's phone in one request:
   ```ts
   export async function fetchOrder(id: string) {
     const { data, error } = await supabase
       .from('orders')
       .select(`*,
         order_items(id, variant_id, product_id, name_snapshot, variant_label_snapshot, image_path,
                     mrp, price, gst_rate, hsn_code, quantity, line_total, status),
         order_status_events(id, status, note, created_at),
         store:stores(id, name, phone, whatsapp, eta_minutes, gstin, fssai_license, address)`)
       .eq('id', id)
       .order('created_at', { referencedTable: 'order_status_events', ascending: true })
       .single();
     if (error) throw error;
     return data;
   }
   export const useOrder = (id: string) =>
     useQuery({ queryKey: orderKeys.detail(id), queryFn: () => fetchOrder(id) });
   ```
2. **One** Realtime channel for the logged-in customer, mounted in the root layout (not per screen). The plan's channel name is `my-orders:user=<uid>`:
   ```ts
   // src/features/orders/useMyOrdersRealtime.ts
   export function useMyOrdersRealtime(uid: string | undefined) {
     const qc = useQueryClient();
     const { t } = useTranslation();

     useEffect(() => {
       if (!uid) return;
       const channel = supabase
         .channel(`my-orders:user=${uid}`)
         .on('postgres_changes',
           { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${uid}` },
           (payload) => {
             const next = payload.new as { id: string; status: OrderStatus };
             const prev = qc.getQueryData<Order>(orderKeys.detail(next.id));
             if (prev && prev.status !== next.status) {
               toast.show(t(`orders.status.${next.status}.toast`));     // "Your order is packed 📦"
               Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
             }
             // Realtime is a hint; the source of truth is a fresh RLS-checked read.
             qc.invalidateQueries({ queryKey: orderKeys.detail(next.id) });
             qc.invalidateQueries({ queryKey: orderKeys.active });
             if (next.status === 'delivered' || next.status === 'cancelled') {
               qc.invalidateQueries({ queryKey: orderKeys.past });
             }
           })
         .subscribe((status) => {
           realtimeState.set('my-orders', status);           // drives the "Live" dot
           // After any (re)connect we may have missed events: refetch once.
           if (status === 'SUBSCRIBED') qc.invalidateQueries({ queryKey: orderKeys.all });
         });
       return () => { supabase.removeChannel(channel); };
     }, [uid, qc, t]);
   }
   ```
3. **Refetch on focus and reconnect.** Phase 0 wired TanStack Query's `focusManager` to `AppState` and `onlineManager` to NetInfo. Check it's there; without it, an app returning from the background shows stale status until the next event:
   ```ts
   AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
   NetInfo.addEventListener((s) => onlineManager.setOnline(!!s.isConnected));
   ```
   Also keep `refetchInterval: 60_000` on `useOrder` **only while the order is active**, as a last-resort fallback if the socket is silently dead (common on some Android battery savers):
   ```ts
   refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? 60_000 : false)
   ```
4. Realtime needs the user's JWT. `supabase-js` v2 updates the Realtime token on `TOKEN_REFRESHED`. If you see `CHANNEL_ERROR` after about an hour, call `supabase.realtime.setAuth(session.access_token)` in the `onAuthStateChange` listener.
5. **`StatusTimeline`**: a vertical list of the 6 `TIMELINE` steps. Each step's time comes from `placed_at / confirmed_at / packed_at / out_for_delivery_at / delivered_at` (packing uses the first `packing` event). Done steps get a filled check, the current step a pulsing dot (Reanimated, disabled under "Reduce motion"), future steps are grey. A cancelled order shows the steps reached, then a red "Cancelled" step with the reason and who cancelled ("by you" / "by the store" / "not accepted in time"). Never rely on colour alone: each step also has an icon and a text label.
6. Under the timeline, **events with notes** (from `order_status_events`) show as small lines, e.g. "8:14 PM · Amul Butter 100 g was unavailable. You won't be charged for it." (written by Phase 6).
7. **`OrderLines`**: lines with status `unavailable` are struck through with the label "Not available · not charged". The bill (`OrderBill`) uses the **order's** stored totals, never recomputed on the phone.
8. Header: order number (long-press copies it), "Live ●" dot (green when the channel is `SUBSCRIBED`, grey with "Reconnecting…" otherwise). Footer actions depend on status: **Cancel** (5.3), **Call store** (`tel:`), **WhatsApp store** (`https://wa.me/<number>?text=<order number>`), **Invoice** (5.5), **Report an issue** (5.6), **Reorder** (5.4).
9. "Expected by 8:05 PM" = `placed_at + stores.eta_minutes`. It's shown only while active and hidden once the time has passed (no "late" shaming copy; show "Taking a little longer than usual" instead).

**Checks**
- Open an order, then in Studio set `status = 'confirmed'`: the toast and timeline update within about 1 s.
- Turn on airplane mode, change the status in Studio, turn airplane mode off: the screen corrects itself within a few seconds.
- Background the app for 2 minutes, change the status, foreground it: it's correct immediately.

**Tests**
- RNTL `StatusTimeline`: every status, plus cancelled-after-confirmed; screen-reader text per step.
- Unit: the realtime handler invalidates the right keys (mock `qc`).

---

## 5.3 Cancel order

**Goal:** customers can cancel early without calling anyone, and stock goes back on the shelf in the same transaction.

**Files**
```
mobile/src/features/orders/components/CancelOrderSheet.tsx
mobile/src/features/orders/api.ts           # cancelOrder()
```

**SQL**
```sql
-- 0500 part 3: cancellation ---------------------------------------------------

-- Internal worker: no permission checks. Used by cancel_order() (customer/staff),
-- Phase 6 auto-cancel (system) and staff_mark_item_unavailable (store).
create or replace function public._cancel_order_internal(
  p_order_id uuid, p_reason text, p_actor public.cancel_actor, p_actor_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status in ('delivered', 'cancelled') then raise exception 'ORDER_FINAL'; end if;

  -- Lock stock rows in variant_id order (same as place_order) to avoid deadlocks.
  perform 1
  from public.inventory inv
  where inv.store_id = v_order.store_id
    and inv.variant_id in (
      select oi.variant_id from public.order_items oi
      where oi.order_id = p_order_id and oi.status = 'active')
  order by inv.variant_id
  for update;

  -- Put active lines back on the shelf and log each movement.
  with lines as (
    select oi.variant_id, sum(oi.quantity)::int as qty
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'active'
    group by oi.variant_id
  ), restocked as (
    update public.inventory inv
       set stock = inv.stock + l.qty, updated_at = now()
      from lines l
     where inv.store_id = v_order.store_id and inv.variant_id = l.variant_id
    returning inv.variant_id, l.qty
  )
  insert into public.inventory_movements (store_id, variant_id, delta, reason, order_id, note, actor_id)
  select v_order.store_id, r.variant_id, r.qty, 'order_cancel', p_order_id, p_reason, p_actor_id
  from restocked r;

  update public.orders
     set status = 'cancelled', cancel_reason = p_reason, cancelled_by = p_actor,
         cancelled_at = now(), updated_at = now()
   where id = p_order_id
  returning * into v_order;

  insert into public.order_status_events (order_id, status, note, actor_id)
  values (p_order_id, 'cancelled', p_reason, p_actor_id);

  -- Phase 10: if payment_status = 'paid', enqueue a refund here.
  return v_order;
end;
$$;
revoke execute on function public._cancel_order_internal(uuid, text, public.cancel_actor, uuid)
  from public, anon, authenticated;

-- Public RPC: customers in placed/confirmed; staff in any non-final status.
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_staff boolean := public.is_staff();
  v_order public.orders;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(p_reason) > 200 then
    raise exception 'INVALID_REASON';
  end if;

  -- Lock first, then check, so the store can't move it to "packing" in between.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (not v_staff and v_order.user_id <> v_uid) then
    raise exception 'ORDER_NOT_FOUND';      -- same error for "not yours": don't leak existence
  end if;
  if v_order.status in ('delivered', 'cancelled') then raise exception 'ORDER_FINAL'; end if;
  if not v_staff and v_order.status not in ('placed', 'confirmed') then
    raise exception 'CANCEL_NOT_ALLOWED';
  end if;

  return public._cancel_order_internal(
    p_order_id, btrim(p_reason),
    case when v_staff and v_order.user_id <> v_uid then 'store' else 'customer' end::public.cancel_actor,
    v_uid);
end;
$$;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant  execute on function public.cancel_order(uuid, text) to authenticated;
```

**Steps**
1. Show **Cancel order** only when `CUSTOMER_CAN_CANCEL.includes(status)`. Once packing has started, show "Packing has started. Call the store to make changes" with a call button. The server enforces the same rule, so a stale screen just gets `CANCEL_NOT_ALLOWED` → "The store has already started packing".
2. `CancelOrderSheet`: a bottom sheet with reason chips (codes stored, labels translated):
   `ordered_by_mistake` · `want_to_change_items` · `delivery_too_slow` · `address_wrong` · `other` (+ an optional text box). The primary button reads "Cancel order"; the secondary "Keep order" is the default focus.
3. Mutation:
   ```ts
   export function useCancelOrder(id: string) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: async (reason: string) => {
         const { data, error } = await supabase.rpc('cancel_order', { p_order_id: id, p_reason: reason });
         if (error) throw error;
         return data;
       },
       onSuccess: (order) => {
         qc.setQueryData(orderKeys.detail(id), (old: Order | undefined) => old && { ...old, ...order });
         qc.invalidateQueries({ queryKey: orderKeys.all });
         qc.invalidateQueries({ queryKey: ['catalog'] });     // stock went back up
       },
     });
   }
   ```
4. No optimistic update here. Cancelling is about money and stock, so wait for the server, show a spinner on the button, and keep the sheet open on error.

**Checks**
- Cancel a `confirmed` order: status is `cancelled`, `cancelled_by = 'customer'`, `inventory.stock` is back up by the quantities, and there's one `order_cancel` movement per variant.
- Set the order to `packing` in Studio, then try to cancel from a stale screen: you get the friendly error and the screen refreshes.
- Cancel the same order twice (double tap): the second call returns `ORDER_FINAL`, and stock was only added once.

**Tests:** pgTAP in 5.8's test file (cancel restocks; customer can't cancel `packing`; can't cancel someone else's; double cancel).

---

## 5.4 Reorder

**Goal:** "same as last time" in one tap, the most used button in grocery apps.

**Files**
```
mobile/src/features/orders/components/ReorderButton.tsx
mobile/src/features/cart/api.ts      # (extend) reorderToCart()
```

**SQL**
```sql
-- 0500 part 4: reorder ----------------------------------------------------------
create or replace function public.reorder_to_cart(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_store   bigint;
  v_added   jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_qty     int;
  r         record;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select o.store_id into v_store from public.orders o where o.id = p_order_id and o.user_id = v_uid;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  for r in
    select oi.variant_id,
           min(oi.name_snapshot::text)::jsonb          as name,
           min(oi.variant_label_snapshot::text)::jsonb as label,
           sum(oi.quantity)::int                       as qty,
           bool_and(pv.is_active and p.is_active)      as active,
           min(pv.max_per_order)                       as max_per_order,
           coalesce(min(inv.stock), 0)                 as stock,
           coalesce(bool_and(inv.is_available), false) as available
    from public.order_items oi
    join public.product_variants pv on pv.id = oi.variant_id
    join public.products p          on p.id  = pv.product_id
    left join public.inventory inv  on inv.variant_id = oi.variant_id and inv.store_id = v_store
    where oi.order_id = p_order_id               -- includes lines that were unavailable last time
    group by oi.variant_id
  loop
    v_qty := least(r.qty, r.max_per_order, r.stock);
    if not (r.active and r.available) or v_qty < 1 then
      v_missing := v_missing || jsonb_build_object('variant_id', r.variant_id, 'name', r.name, 'label', r.label);
    else
      insert into public.cart_items as ci (user_id, variant_id, quantity, updated_at)
      values (v_uid, r.variant_id, v_qty, now())
      on conflict (user_id, variant_id) do update
        set quantity   = least(greatest(ci.quantity, excluded.quantity), r.max_per_order),
            updated_at = now();
      v_added := v_added || jsonb_build_object(
        'variant_id', r.variant_id, 'quantity', v_qty, 'reduced', v_qty < r.qty);
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'missing', v_missing);
end;
$$;
revoke execute on function public.reorder_to_cart(uuid) from public, anon;
grant  execute on function public.reorder_to_cart(uuid) to authenticated;
```

**Steps**
1. `ReorderButton` (on past order cards and order detail) calls `supabase.rpc('reorder_to_cart', { p_order_id })`, then invalidates the cart query and the cart quote (Phase 4), then navigates to `/cart`.
2. If `missing` isn't empty, the cart screen shows a dismissible card: "3 items from your last order are out of stock: Amul Butter 100 g, …" with a **Notify me** button per item (uses Phase 2 `stock_alerts`). Lines with `reduced: true` show "Only 2 available".
3. Prices are **not** copied from the old order. The cart re-quotes at today's prices (Phase 4 `get_cart_quote`), so the user sees "Price changed ₹40 → ₹42" if needed.

**Checks**
- Reorder an order with one product now out of stock and one now inactive: both appear in `missing`; the rest are in the cart.
- Reorder twice: quantities don't double (the `greatest` rule).

**Tests:** pgTAP: out-of-stock goes to `missing`; `max_per_order` is respected; another user's order raises `ORDER_NOT_FOUND`.

---

## 5.5 Invoice PDF

**Goal:** a proper tax invoice for every delivered order, generated on the phone (no server, ₹0).

**Files**
```
mobile/src/features/orders/gst.ts
mobile/src/features/orders/invoiceHtml.ts      # reused by Phase 6 printing (A4 / 80 mm / 58 mm)
mobile/src/features/orders/useInvoice.ts
```

**SQL:** none. Everything needed is already on the order (`order_items.gst_rate`, `hsn_code`, `price`, `mrp`) and on `stores` (`gstin`, `fssai_license`, `address`).

**Steps**
1. Install: `npx expo install expo-print expo-sharing`.
2. Prices in India are **GST-inclusive** (MRP includes all taxes). Split each line back out:
   ```ts
   // src/features/orders/gst.ts
   const r2 = (n: number) => Math.round(n * 100) / 100;

   export function splitInclusive(amount: number, ratePct: number) {
     const taxable = r2(amount / (1 + ratePct / 100));
     const tax = r2(amount - taxable);
     const cgst = r2(tax / 2);
     return { taxable, cgst, sgst: r2(tax - cgst), tax };   // intra-state: CGST + SGST
   }

   /** Summary table grouped by rate: 0%, 5%, 12%, 18% … */
   export function gstSummary(lines: { line_total: number; gst_rate: number; status: string }[]) {
     const byRate = new Map<number, { taxable: number; cgst: number; sgst: number }>();
     for (const l of lines.filter((x) => x.status === 'active')) {
       const s = splitInclusive(l.line_total, l.gst_rate);
       const acc = byRate.get(l.gst_rate) ?? { taxable: 0, cgst: 0, sgst: 0 };
       byRate.set(l.gst_rate, { taxable: r2(acc.taxable + s.taxable), cgst: r2(acc.cgst + s.cgst), sgst: r2(acc.sgst + s.sgst) });
     }
     return [...byRate.entries()].sort(([a], [b]) => a - b);
   }
   ```
   > Fees (delivery, small-cart, packaging) are shown as separate lines. Whether they carry GST and under which SAC code depends on your registration. **Confirm with your CA** and add a `fee_gst_rate` to `stores` if needed.
3. HTML template. Escape every dynamic string, since product names come from admins:
   ```ts
   // src/features/orders/invoiceHtml.ts
   export type PaperSize = 'a4' | '80mm' | '58mm';
   const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

   export function invoiceHtml(order: OrderDetail, lang: Lang, paper: PaperSize = 'a4') {
     const L = (v: Localized) => esc(localize(v, lang));
     const rows = order.order_items.filter((i) => i.status === 'active').map((i) => `
       <tr><td>${L(i.name_snapshot)}<br><small>${L(i.variant_label_snapshot)} · HSN ${esc(i.hsn_code ?? '-')}</small></td>
           <td class="r">${i.quantity}</td><td class="r">${inr(i.price)}</td>
           <td class="r">${i.gst_rate}%</td><td class="r">${inr(i.line_total)}</td></tr>`).join('');
     const tax = gstSummary(order.order_items).map(([rate, s]) =>
       `<tr><td>${rate}%</td><td class="r">${inr(s.taxable)}</td><td class="r">${inr(s.cgst)}</td><td class="r">${inr(s.sgst)}</td></tr>`).join('');
     return `<!doctype html><html><head><meta charset="utf-8">
       <style>
         @page { size: ${paper === 'a4' ? 'A4' : `${paper} auto`}; margin: ${paper === 'a4' ? '14mm' : '2mm'}; }
         body { font-family: 'Noto Sans', 'Noto Sans Devanagari', sans-serif; font-size: ${paper === '58mm' ? 9 : paper === '80mm' ? 10 : 11}px; }
         table { width: 100%; border-collapse: collapse; } td, th { padding: 2px 3px; vertical-align: top; }
         .r { text-align: right; } h1 { font-size: 1.4em; margin: 0; } .muted { color: #555; }
         ${paper !== 'a4' ? 'th:nth-child(4), td:nth-child(4) { display: none; }' : ''}
       </style></head><body>
       <h1>${L(order.store.name)}</h1>
       <div class="muted">${L(order.store.address)}<br>GSTIN ${esc(order.store.gstin ?? '-')} · FSSAI ${esc(order.store.fssai_license ?? '-')}</div>
       <h2>${t('invoice.title', lang)} ${esc(order.order_number)}</h2>
       <div>${formatDateTime(order.delivered_at ?? order.placed_at, lang)} · ${t(`payment.${order.payment_method}`, lang)}</div>
       <div>${esc(order.address_snapshot.receiver_name)}, ${esc(order.address_snapshot.house)}, ${esc(order.address_snapshot.area)}</div>
       <table><thead><tr><th>${t('invoice.item', lang)}</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amt</th></tr></thead>
         <tbody>${rows}</tbody></table>
       <table>${feeRows(order, lang)}<tr><th>${t('invoice.total', lang)}</th><th class="r">${inr(order.grand_total)}</th></tr></table>
       <h3>${t('invoice.taxSummary', lang)}</h3>
       <table><tr><th>Rate</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>${tax}</table>
       <p class="muted">${t('invoice.footer', lang)}</p></body></html>`;
   }
   ```
4. `useInvoice(order)`:
   ```ts
   const { uri } = await Print.printToFileAsync({ html: invoiceHtml(order, lang, 'a4') });
   await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: order.order_number });
   ```
   Label the button **Invoice** once delivered and **Order summary** before that (same template, title "Order summary, not a tax invoice").
5. The invoice number is the `order_number` (unique, sequential per day from Phase 4). Ask your CA whether you need a separate continuous invoice series; if so, add `orders.invoice_number` in Phase 9.

**Checks**
- An order with 5% and 18% items shows two tax rows; taxable + CGST + SGST equals the line totals to the paisa.
- Devanagari names render correctly in the PDF on Android (fonts loaded in Phase 0).

**Tests:** unit tests for `splitInclusive` (₹105 @5% → 100 + 2.50 + 2.50), `gstSummary`, and `esc` (an XSS-y product name is escaped).

---

## 5.6 Report an issue (photos)

**Goal:** when something is missing or damaged, the customer tells the store in 30 seconds with proof, and the store sees it immediately.

**Files**
```
mobile/app/order/[id]/issue.tsx
mobile/src/features/issues/api.ts
mobile/src/features/issues/components/ReportIssueForm.tsx
mobile/src/lib/images.ts            # (from Phase 1) compressToWebp()
```

**SQL**
```sql
-- 0500 part 6: issues bucket + RPC -----------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issues', 'issues', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Path: <user_id>/<order_id>/<uuid>.webp
drop policy if exists "issues: upload own folder" on storage.objects;
drop policy if exists "issues: read own"          on storage.objects;
create policy "issues: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'issues' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "issues: read own" on storage.objects for select to authenticated
  using (bucket_id = 'issues' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Staff read policy: Phase 6.

create or replace function public.report_order_issue(
  p_order_id uuid, p_type public.issue_type, p_message text,
  p_order_item_id bigint default null, p_photo_paths text[] default '{}')
returns public.order_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_issue public.order_issues;
  v_prefix text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_order from public.orders where id = p_order_id and user_id = v_uid;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'delivered' or v_order.delivered_at < now() - interval '48 hours' then
    raise exception 'ISSUE_WINDOW_CLOSED';
  end if;
  if (select count(*) from public.order_issues i where i.order_id = p_order_id) >= 3 then
    raise exception 'ISSUE_LIMIT';
  end if;
  if p_order_item_id is not null and not exists (
       select 1 from public.order_items oi where oi.id = p_order_item_id and oi.order_id = p_order_id) then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if p_type in ('damaged', 'wrong_item', 'quality') and coalesce(cardinality(p_photo_paths), 0) = 0 then
    raise exception 'PHOTO_REQUIRED';
  end if;
  if cardinality(p_photo_paths) > 3 then raise exception 'INVALID_PHOTO_PATH'; end if;

  v_prefix := v_uid::text || '/' || p_order_id::text || '/';
  if exists (select 1 from unnest(p_photo_paths) p where left(p, length(v_prefix)) <> v_prefix or p like '%..%') then
    raise exception 'INVALID_PHOTO_PATH';
  end if;

  insert into public.order_issues (order_id, user_id, order_item_id, type, message, photo_paths)
  values (p_order_id, v_uid, p_order_item_id, p_type, nullif(btrim(p_message), ''), p_photo_paths)
  returning * into v_issue;

  perform public.notify_staff(
    v_order.store_id, 'new_issue',
    jsonb_build_object('en', 'Issue reported on ' || v_order.order_number,
                       'mr', v_order.order_number || ' ऑर्डरबद्दल तक्रार',
                       'hi', v_order.order_number || ' ऑर्डर पर शिकायत'),
    jsonb_build_object('en', 'A customer reported a problem. Please check and respond.',
                       'mr', 'ग्राहकाने समस्या कळवली आहे. कृपया तपासा.',
                       'hi', 'ग्राहक ने समस्या बताई है। कृपया जाँच करें।'),
    jsonb_build_object('order_id', p_order_id, 'issue_id', v_issue.id, 'url', '/store/order/' || p_order_id));

  return v_issue;
end;
$$;
revoke execute on function public.report_order_issue(uuid, public.issue_type, text, bigint, text[]) from public, anon;
grant  execute on function public.report_order_issue(uuid, public.issue_type, text, bigint, text[]) to authenticated;
```

**Steps**
1. Entry: **Report an issue** on a delivered order, visible for 48 h (hidden after that, with "Contact the store" instead).
2. Form: (a) pick the type as big tiles with icons: Missing item · Damaged · Wrong item · Quality · Other; (b) optionally pick the item from the order lines; (c) add up to 3 photos (camera or gallery); (d) a short message; (e) submit. Photos are required for damaged/wrong/quality, and the UI says so before the server does.
3. Compress, then upload each photo, then call the RPC:
   ```ts
   export async function uploadIssuePhoto(uid: string, orderId: string, uri: string) {
     const webp = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }],
       { compress: 0.7, format: ImageManipulator.SaveFormat.WEBP });   // re-encode also drops EXIF/GPS
     const path = `${uid}/${orderId}/${Crypto.randomUUID()}.webp`;
     const body = await (await fetch(webp.uri)).arrayBuffer();
     const { error } = await supabase.storage.from('issues').upload(path, body, { contentType: 'image/webp' });
     if (error) throw error;
     return path;
   }
   ```
   Show per-photo progress, and keep uploaded paths if the RPC fails, so a retry doesn't upload again.
4. After submit: "Thanks. The store will contact you." The order screen lists the issue with its status (open / resolved / rejected) and the store's note. Staff resolve it in Phase 6, which notifies the customer (`issue_update`).
5. Photos are shown with `createSignedUrl(path, 3600)` (private bucket).

**Checks**
- Delivered 49 h ago: the RPC returns `ISSUE_WINDOW_CLOSED`.
- An upload to someone else's folder fails with an RLS error.
- A staff account gets a `new_issue` notification.

**Tests:** pgTAP: window; photo required; path prefix check; limit of 3.

---

## 5.7 In-app notifications inbox

**Goal:** every important event lands in a 🔔 inbox in the user's language, for customers and staff alike, whether or not push is enabled.

**Files**
```
mobile/app/account/notifications.tsx
mobile/src/features/notifications/api.ts
mobile/src/features/notifications/hooks.ts         # useNotifications, useUnreadCount, useMarkRead
mobile/src/features/notifications/components/NotificationBell.tsx
mobile/src/features/notifications/components/NotificationRow.tsx
```

**SQL**
```sql
-- 0500 part 7: messages, triggers, mark-read -----------------------------------------

-- Localized title/body for each status. Returns null for statuses we don't announce.
create or replace function public.order_status_message(
  p_status public.order_status, p_order_number text, p_cancelled_by public.cancel_actor)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'placed' then jsonb_build_object(
      'title', jsonb_build_object('en','Order placed 🛒','mr','ऑर्डर दिली 🛒','hi','ऑर्डर हो गया 🛒'),
      'body',  jsonb_build_object(
        'en', 'We sent order ' || p_order_number || ' to the store.',
        'mr', 'ऑर्डर ' || p_order_number || ' दुकानाकडे पाठवली आहे.',
        'hi', 'ऑर्डर ' || p_order_number || ' स्टोर को भेज दिया गया है।'))
    when 'confirmed' then jsonb_build_object(
      'title', jsonb_build_object('en','Order confirmed ✅','mr','ऑर्डर स्वीकारली ✅','hi','ऑर्डर कन्फर्म ✅'),
      'body',  jsonb_build_object(
        'en', 'The store accepted order ' || p_order_number || ' and will start packing soon.',
        'mr', 'दुकानाने ऑर्डर ' || p_order_number || ' स्वीकारली आहे, लवकरच पॅकिंग सुरू होईल.',
        'hi', 'स्टोर ने ऑर्डर ' || p_order_number || ' स्वीकार कर लिया है, जल्द ही पैकिंग शुरू होगी।'))
    when 'packing' then jsonb_build_object(
      'title', jsonb_build_object('en','Packing your order 📦','mr','तुमची ऑर्डर पॅक होत आहे 📦','hi','आपका ऑर्डर पैक हो रहा है 📦'),
      'body',  jsonb_build_object(
        'en', 'Your items for ' || p_order_number || ' are being picked.',
        'mr', p_order_number || ' मधील वस्तू काढल्या जात आहेत.',
        'hi', p_order_number || ' का सामान निकाला जा रहा है।'))
    when 'packed' then jsonb_build_object(
      'title', jsonb_build_object('en','Order packed','mr','ऑर्डर पॅक झाली','hi','ऑर्डर पैक हो गया'),
      'body',  jsonb_build_object(
        'en', 'Order ' || p_order_number || ' is packed and will leave soon.',
        'mr', 'ऑर्डर ' || p_order_number || ' पॅक झाली आहे, लवकरच निघेल.',
        'hi', 'ऑर्डर ' || p_order_number || ' पैक हो गया है, जल्द ही निकलेगा।'))
    when 'out_for_delivery' then jsonb_build_object(
      'title', jsonb_build_object('en','On the way 🛵','mr','ऑर्डर निघाली 🛵','hi','ऑर्डर रास्ते में है 🛵'),
      'body',  jsonb_build_object(
        'en', 'Order ' || p_order_number || ' is out for delivery. Keep your phone handy.',
        'mr', 'ऑर्डर ' || p_order_number || ' डिलिव्हरीसाठी निघाली आहे. फोन जवळ ठेवा.',
        'hi', 'ऑर्डर ' || p_order_number || ' डिलीवरी के लिए निकल चुका है। फ़ोन पास रखें।'))
    when 'delivered' then jsonb_build_object(
      'title', jsonb_build_object('en','Delivered 🎉','mr','ऑर्डर पोहोचली 🎉','hi','ऑर्डर डिलीवर हो गया 🎉'),
      'body',  jsonb_build_object(
        'en', 'Order ' || p_order_number || ' was delivered. Something wrong? Report it within 48 hours.',
        'mr', 'ऑर्डर ' || p_order_number || ' पोहोचली. काही अडचण? ४८ तासांत कळवा.',
        'hi', 'ऑर्डर ' || p_order_number || ' डिलीवर हो गया। कोई समस्या? 48 घंटे में बताएं।'))
    when 'cancelled' then jsonb_build_object(
      'title', jsonb_build_object('en','Order cancelled','mr','ऑर्डर रद्द','hi','ऑर्डर रद्द'),
      'body',  case p_cancelled_by
        when 'customer' then jsonb_build_object(
          'en', 'You cancelled order ' || p_order_number || '.',
          'mr', 'तुम्ही ऑर्डर ' || p_order_number || ' रद्द केली.',
          'hi', 'आपने ऑर्डर ' || p_order_number || ' रद्द किया।')
        when 'system' then jsonb_build_object(
          'en', 'Sorry, the store could not accept order ' || p_order_number || ' in time. You were not charged.',
          'mr', 'माफ करा, दुकान ऑर्डर ' || p_order_number || ' वेळेत स्वीकारू शकले नाही. कोणतेही शुल्क नाही.',
          'hi', 'माफ़ कीजिए, स्टोर ऑर्डर ' || p_order_number || ' समय पर स्वीकार नहीं कर सका। कोई शुल्क नहीं लगा।')
        else jsonb_build_object(
          'en', 'Sorry, the store cancelled order ' || p_order_number || '. Open it to see why.',
          'mr', 'माफ करा, दुकानाने ऑर्डर ' || p_order_number || ' रद्द केली. कारण पाहण्यासाठी उघडा.',
          'hi', 'माफ़ कीजिए, स्टोर ने ऑर्डर ' || p_order_number || ' रद्द किया। कारण देखने के लिए खोलें।')
      end)
    else null          -- any other status (e.g. Phase 10 'awaiting_payment') is not announced
  end;
$$;

create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg jsonb;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_msg := public.order_status_message(new.status, new.order_number, new.cancelled_by);
  if v_msg is null then return new; end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (new.user_id, 'order_status', v_msg -> 'title', v_msg -> 'body',
          jsonb_build_object('order_id', new.id, 'status', new.status, 'url', '/order/' || new.id));
  return new;
end;
$$;

drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status
  after insert or update of status on public.orders
  for each row execute function public.notify_order_status();

-- Back-in-stock: replaces the Phase 2 body of notify_back_in_stock() (the trigger defined
-- in 0200 keeps pointing at this function). Phase 2 only stamped stock_alerts.notified_at;
-- now it also writes the inbox row, which 5.8 turns into a push.
create or replace function public.notify_back_in_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.stock = 0 or not old.is_available) and new.stock > 0 and new.is_available then
    with due as (
      update public.stock_alerts sa
         set notified_at = now()
       where sa.variant_id = new.variant_id and sa.notified_at is null
      returning sa.user_id
    )
    insert into public.notifications (user_id, type, title, body, data)
    select d.user_id, 'back_in_stock',
           jsonb_build_object('en','Back in stock 🎉','mr','पुन्हा उपलब्ध 🎉','hi','फिर से उपलब्ध 🎉'),
           jsonb_build_object(
             'en', coalesce(p.name->>'en','') || ' ' || coalesce(pv.label->>'en','') || ' is available again.',
             'mr', coalesce(p.name->>'mr', p.name->>'en','') || ' ' || coalesce(pv.label->>'mr', pv.label->>'en','') || ' पुन्हा उपलब्ध आहे.',
             'hi', coalesce(p.name->>'hi', p.name->>'en','') || ' ' || coalesce(pv.label->>'hi', pv.label->>'en','') || ' फिर से उपलब्ध है।'),
           jsonb_build_object('variant_id', new.variant_id, 'url', '/product/' || p.slug)
    from due d
    join public.product_variants pv on pv.id = new.variant_id
    join public.products p          on p.id  = pv.product_id;
  end if;
  return new;
end;
$$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant  execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- Housekeeping: keep the free-tier DB small. Inbox keeps 90 days.
create extension if not exists pg_cron;
select cron.schedule('purge-old-notifications', '30 21 * * *',      -- 03:00 IST
  $$delete from public.notifications where created_at < now() - interval '90 days'$$);
```

**Steps**
1. Queries:
   ```ts
   export const notifKeys = { list: ['notifications'] as const, unread: ['notifications', 'unread'] as const };

   export const useUnreadCount = () => useQuery({
     queryKey: notifKeys.unread,
     queryFn: async () => {
       const { count, error } = await supabase.from('notifications')
         .select('id', { count: 'exact', head: true }).is('read_at', null);
       if (error) throw error;
       return count ?? 0;
     },
   });
   ```
   The list is an infinite query of 20 at a time, ordered by `created_at desc`.
2. Live: add a second listener to the same per-user channel from 5.2 (no extra socket):
   ```ts
   .on('postgres_changes',
     { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
     () => { qc.invalidateQueries({ queryKey: notifKeys.list }); qc.invalidateQueries({ queryKey: notifKeys.unread }); })
   ```
   This is the plan's `my-notifications:user=<uid>` channel, merged into the same channel to save connections on the free tier.
3. `NotificationBell` in the Home and Account headers shows a badge (`99+` cap) and an accessibility label ("Notifications, 3 unread").
4. Inbox screen: rows with an icon per type, localized title/body (`localize(row.title)`), relative time, and an unread dot. Tapping a row marks it read (`mark_notifications_read([id])`, optimistic) and navigates to `row.data.url`. "Mark all as read" sits in the header. Swipe to delete (RLS delete policy).
5. Empty state: "No notifications yet. We'll tell you when your order moves."

**Checks**
- Changing an order's status inserts exactly one `order_status` notification. Updating other columns (e.g. `staff_note`) inserts none.
- Restocking a variant from 0 → 5 with 2 alerts creates 2 `back_in_stock` rows and stamps `notified_at`. Restocking 5 → 10 creates none.

**Tests:** pgTAP (5.8 file); RNTL `NotificationRow` in all 3 languages.

---

## 5.8 Push: tokens, Edge Function, webhook

**Goal:** notifications reach the phone even when the app is closed, at ₹0, with no Firebase SDK in the app.

**Flow**
```
orders UPDATE ─► notify_order_status() ─► INSERT notifications ─► dispatch_push() (pg_net, async)
                                                                       │ POST {notification_id} + secret
                                                                       ▼
                                           Edge Function send-push ─► claim_pending_push() (skip locked)
                                                                       │ batches of 100
                                                                       ▼
                                                              Expo Push API ─► FCM / APNs ─► phone
                                                                       │ DeviceNotRegistered
                                                                       ▼
                                                              delete from push_tokens
```
The function **claims all pending rows** each time it is called, not just the one in the request. A burst (50 back-in-stock alerts) collapses into a few HTTP calls, and anything missed is picked up by the next call (or by the sweep job below).

**Files**
```
supabase/functions/send-push/index.ts
mobile/src/features/notifications/push.ts          # channels, permission, token, register
mobile/src/features/notifications/useNotificationRouting.ts
mobile/app.config.ts                               # expo-notifications plugin, googleServicesFile
```

**SQL**
```sql
-- 0500 part 8: push -------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_token !~ '^(Expo|Exponent)PushToken\[[^\]]+\]$' or p_platform not in ('android','ios','web') then
    raise exception 'INVALID_TOKEN';
  end if;
  -- A shared device (e.g. the store tablet) moves to whoever logged in last.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text)      from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated;
grant  execute on function public.unregister_push_token(text)      to authenticated;

-- Called only by the Edge Function (service_role). Claims a batch atomically.
create or replace function public.claim_pending_push(p_limit int default 300)
returns table (notification_id bigint, type text, title jsonb, body jsonb, data jsonb, language text, tokens text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '1 hour'   -- don't push stale news
    order by n.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.notifications n
       set pushed_at = now()
      from picked
     where n.id = picked.id
    returning n.id, n.user_id, n.type, n.title, n.body, n.data
  )
  select c.id, c.type, c.title, c.body, c.data, coalesce(p.language, 'en'),
         coalesce(array_agg(t.token) filter (where t.token is not null), '{}'::text[])
  from claimed c
  join public.profiles p on p.id = c.user_id
  left join public.push_tokens t on t.user_id = c.user_id
  group by c.id, c.type, c.title, c.body, c.data, p.language;
end;
$$;
revoke execute on function public.claim_pending_push(int) from public, anon, authenticated;
grant  execute on function public.claim_pending_push(int) to service_role;

-- Fire-and-forget HTTP call to the Edge Function on every new notification.
-- URL and secret live in Supabase Vault (never in the migration).
create or replace function public.dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'send_push_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'send_push_secret';
  if v_url is null or v_secret is null then
    return new;                 -- push not configured (local dev): the inbox still works
  end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000);
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_push on public.notifications;
create trigger notifications_dispatch_push
  after insert on public.notifications
  for each row execute function public.dispatch_push();

-- Safety sweep: if a call failed, the next minute's sweep pushes what's still pending.
select cron.schedule('push-sweep', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_url'),
    body    := '{"sweep":true}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_secret')))
  where exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '1 hour')
    and exists (select 1 from vault.decrypted_secrets where name = 'send_push_url')
$$);
```
> Why a trigger with `pg_net` instead of a dashboard "Database Webhook"? Dashboard webhooks are the same thing (`pg_net` under the hood), but this way the setup lives in git and is recreated by `supabase db reset`.

**Edge Function** (`supabase/functions/send-push/index.ts`)
```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Lang = 'en' | 'mr' | 'hi';
type Localized = Partial<Record<Lang, string>>;
type PendingRow = {
  notification_id: number; type: string; title: Localized; body: Localized;
  data: Record<string, unknown>; language: Lang; tokens: string[];
};
type ExpoMessage = {
  to: string; title: string; body: string; data: Record<string, unknown>;
  channelId: string; sound: string | null; priority: 'default' | 'high';
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ROUTING: Record<string, Pick<ExpoMessage, 'channelId' | 'sound' | 'priority'>> = {
  order_status:        { channelId: 'orders',       sound: 'default',       priority: 'high' },
  order_items_changed: { channelId: 'orders',       sound: 'default',       priority: 'high' },
  issue_update:        { channelId: 'orders',       sound: 'default',       priority: 'default' },
  back_in_stock:       { channelId: 'stock',        sound: null,            priority: 'default' },
  announcement:        { channelId: 'stock',        sound: null,            priority: 'default' },
  new_order:           { channelId: 'store_orders', sound: 'new_order.wav', priority: 'high' },   // Phase 6
  new_issue:           { channelId: 'store_orders', sound: 'default',       priority: 'high' },
};

const pick = (v: Localized, lang: Lang) => v[lang] || v.en || Object.values(v).find(Boolean) || '';

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

  const { data, error } = await supabase.rpc('claim_pending_push', { p_limit: 300 });
  if (error) return new Response(error.message, { status: 500 });

  const messages: ExpoMessage[] = [];
  for (const row of (data ?? []) as PendingRow[]) {
    const route = ROUTING[row.type] ?? ROUTING.order_status;
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

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');   // optional "enhanced push security"
  const deadTokens: string[] = [];

  for (let i = 0; i < messages.length; i += 100) {          // Expo accepts up to 100 per request
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
    if (!res.ok) { console.error('expo push failed', res.status, await res.text()); continue; }
    const { data: tickets } = await res.json() as {
      data: { status: 'ok' | 'error'; details?: { error?: string } }[];
    };
    tickets.forEach((t, j) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') deadTokens.push(chunk[j].to);
    });
  }

  if (deadTokens.length) await supabase.from('push_tokens').delete().in('token', deadTokens);
  return Response.json({ messages: messages.length, removedTokens: deadTokens.length });
});
```

**Steps**
1. **Firebase (free, only as Android's push channel):** create a Firebase project → add an Android app with your package name → download `google-services.json` (git-ignored; point `android.googleServicesFile` at it in `app.config.ts`). Create a service-account key for **FCM V1** and upload it to Expo: `eas credentials` → Android → Push Notifications. No Firebase SDK is added to the app.
2. Packages and config:
   ```bash
   npx expo install expo-notifications expo-device expo-constants
   ```
   ```ts
   // app.config.ts (excerpt)
   plugins: [
     ['expo-notifications', {
       icon: './assets/notification-icon.png',     // white-on-transparent, 96×96
       color: '#0C831F',
       sounds: ['./assets/sounds/new_order.wav'],  // used by the staff channel (Phase 6)
     }],
   ],
   android: { googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json' },
   extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
   ```
3. Android channels: create them at startup. Channel names show in system settings, so translate them:
   ```ts
   // src/features/notifications/push.ts
   export async function setupAndroidChannels(t: TFunction) {
     if (Platform.OS !== 'android') return;
     await Notifications.setNotificationChannelAsync('orders', {
       name: t('channels.orders'), importance: Notifications.AndroidImportance.HIGH,
       vibrationPattern: [0, 250, 250, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
     });
     await Notifications.setNotificationChannelAsync('stock', {
       name: t('channels.stock'), importance: Notifications.AndroidImportance.DEFAULT,
     });
     await Notifications.setNotificationChannelAsync('store_orders', {      // staff only, Phase 6
       name: t('channels.storeOrders'), importance: Notifications.AndroidImportance.MAX,
       sound: 'new_order.wav', vibrationPattern: [0, 600, 300, 600, 300, 600],
       lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
     });
   }
   ```
   > Android fixes a channel's sound and importance when it's first created. If you change them later, create a channel with a **new id** (e.g. `store_orders_v2`) and update `ROUTING`.
4. Permission at the **right moment**, not on first launch:
   - **Customers:** on the "Order placed" screen, show a soft card: "Get live updates about this order? [Allow] [Not now]". Only **Allow** triggers the system prompt (Android 13+ and iOS). If they decline, the inbox and live screen still work.
   - **Staff:** when entering Store mode (Phase 6), with a firm explanation ("You'll miss orders without this").
   ```ts
   export async function registerForPush(): Promise<string | null> {
     if (!Device.isDevice) return null;
     let { status } = await Notifications.getPermissionsAsync();
     if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
     if (status !== 'granted') return null;
     const projectId = Constants.expoConfig?.extra?.eas?.projectId;
     const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
     const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
     if (error) throw error;
     storage.set('push.token', token);
     return token;
   }
   ```
   Re-register on every app start while logged in (tokens can change; the upsert is cheap). On logout, call `unregister_push_token(token)` **before** `supabase.auth.signOut()`.
5. Foreground behaviour and taps:
   ```ts
   Notifications.setNotificationHandler({
     handleNotification: async (n) => {
       const url = n.request.content.data?.url as string | undefined;
       const onSameScreen = url && url === currentPathname();      // already looking at that order
       return { shouldShowBanner: !onSameScreen, shouldShowList: true, shouldPlaySound: !onSameScreen, shouldSetBadge: false };
     },
   });

   // useNotificationRouting.ts (mounted in the root layout)
   useEffect(() => {
     Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));     // cold start
     const sub = Notifications.addNotificationResponseReceivedListener(open);        // warm
     return () => sub.remove();
     function open(r: Notifications.NotificationResponse) {
       const { url, notification_id } = r.notification.request.content.data as { url?: string; notification_id?: number };
       if (notification_id) supabase.rpc('mark_notifications_read', { p_ids: [notification_id] });
       if (url) router.push(url as Href);
     }
   }, []);
   ```
6. Deploy and configure secrets:
   ```bash
   supabase functions deploy send-push --no-verify-jwt     # we check our own secret instead of a JWT
   supabase secrets set PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"
   # optional: EXPO_ACCESS_TOKEN if you enable "enhanced push security" in Expo
   ```
   Then in the SQL editor (production; never committed):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push', 'send_push_url');
   select vault.create_secret('<same value as PUSH_WEBHOOK_SECRET>', 'send_push_secret');
   ```
   Locally: `supabase functions serve send-push --env-file supabase/.env.local` and use `http://host.docker.internal:54321/functions/v1/send-push` as the URL.
7. Free-tier math: Edge Functions allow 500k invocations/month. Even at 300 orders/day × ~6 notifications each, that's about 55k calls/month, well inside it. Expo Push is free.
8. Known limit: if Expo is down, rows are already claimed and those pushes are skipped. That's acceptable, because the inbox and the live screen still have them. To retry later, store failed ids and reset `pushed_at` to null.

**Checks**
- With the app killed, set an order to `packed` in Studio: a push arrives in the user's language within a few seconds; tapping it opens `/order/<id>`.
- Log in on a second device with the same account: both get the push. Log out on one: only the other does.
- Call the function URL without the secret: 403.
- Uninstall the app and trigger a push: the token is removed after the next send.

**Tests** (`supabase/tests/0500_order_tracking.test.sql`, pgTAP with `supabase_test_helpers` from Phase 0)
```sql
begin;
select plan(12);

-- fixtures (as postgres): two customers, one staff, an address, a cart, a placed order
select tests.create_supabase_user('alice'); select tests.create_supabase_user('bob'); select tests.create_supabase_user('staff');
update public.profiles set role = 'staff' where id = tests.get_supabase_uid('staff');
-- (Phase 4 test helper) creates an address + cart for alice with 2 × variant 1 and places a COD order
select tests.place_test_order('alice', 1, 2) as order_id \gset

-- 1. placing an order wrote a notification
select is((select count(*) from public.notifications where user_id = tests.get_supabase_uid('alice') and type = 'order_status')::int, 1, 'placed → 1 notification');

-- 2. bob cannot see alice's order and cannot cancel it
select tests.authenticate_as('bob');
select is((select count(*) from public.orders where id = :'order_id')::int, 0, 'RLS hides other users orders');
select throws_ok(format($$select public.cancel_order(%L, 'x')$$, :'order_id'), 'ORDER_NOT_FOUND');

-- 3. alice cancels; stock returns once
select tests.clear_authentication();
select stock as stock_before from public.inventory where variant_id = 1 \gset
select tests.authenticate_as('alice');
select lives_ok(format($$select public.cancel_order(%L, 'ordered_by_mistake')$$, :'order_id'), 'customer can cancel placed order');
select throws_ok(format($$select public.cancel_order(%L, 'again')$$, :'order_id'), 'ORDER_FINAL', 'double cancel blocked');
select tests.clear_authentication();
select is((select stock from public.inventory where variant_id = 1), :stock_before + 2, 'stock restored exactly once');
select is((select count(*) from public.inventory_movements where order_id = :'order_id' and reason = 'order_cancel')::int, 1, 'one movement');

-- 4. customer cannot cancel once packing
select tests.place_test_order('alice', 1, 1) as order2 \gset
update public.orders set status = 'packing' where id = :'order2';
select tests.authenticate_as('alice');
select throws_ok(format($$select public.cancel_order(%L, 'late')$$, :'order2'), 'CANCEL_NOT_ALLOWED');

-- 5. customers can't insert notifications or claim pushes
select throws_ok($$insert into public.notifications (user_id, type, title, body) values (auth.uid(), 'announcement', '{}', '{}')$$);
select throws_ok($$select * from public.claim_pending_push(10)$$, '42501');

-- 6. non-status updates don't notify
select tests.clear_authentication();
select count(*) as n_before from public.notifications \gset
update public.orders set staff_note = 'ring twice' where id = :'order2';
select is((select count(*) from public.notifications)::int, :n_before::int, 'no notification for non-status update');

-- 7. back in stock
update public.inventory set stock = 0 where variant_id = 2;
insert into public.stock_alerts (user_id, variant_id) values (tests.get_supabase_uid('bob'), 2);
update public.inventory set stock = 5 where variant_id = 2;
select is((select count(*) from public.notifications where user_id = tests.get_supabase_uid('bob') and type = 'back_in_stock')::int, 1, 'back-in-stock notified');

select * from finish();
rollback;
```
Also: RNTL for `CancelOrderSheet` (Keep order is the default), unit tests for `splitInclusive`, and a Maestro flow `order_live_status.yaml` (place an order → script updates the status through the Supabase REST API with the service key in CI only → assert the timeline text changes).

---

## Phase 5 wrap-up

- **Regenerate types:** `supabase gen types typescript --local > mobile/src/types/database.ts`.
- **i18n keys added:** `orders.*` (statuses, toasts, empty states), `cancel.reasons.*`, `issues.*`, `invoice.*`, `notifications.*`, `channels.*`, `errors.<CODE>` for every new code. Check them in all 3 languages with a native speaker.
- **Realtime budget:** one channel per logged-in customer (orders + notifications). Phase 1's inventory channel is still per-screen. Staff add one board channel in Phase 6.
- **What Phase 6 relies on from here:** `_cancel_order_internal()`, `notify_staff()`, the `store_orders` Android channel + `new_order.wav`, `invoiceHtml()` with `80mm`/`58mm` paper sizes, and the `new_order` / `new_issue` push routing.
- **Definition of done:** the checklist at the top, in EN/MR/HI, dark mode, large text, TalkBack labels on the timeline and bell, and all pgTAP tests green in CI.
