# Phase 6: Store Operations (Store mode)

> **Goal:** the store can run a whole day from one tablet (or a phone, or the counter laptop in a browser). New orders ring loudly the moment they're placed. Staff accept, pick with a checklist (or by scanning barcodes), mark missing items, print the pick list and invoice, mark the order handed over and delivered, and keep stock correct. Orders nobody accepts are auto-cancelled so customers never wait on a dead order.
> **Duration:** about 1.5 weeks · **Depends on:** Phase 5 (Orders: Live Tracking & Notifications) · **Next:** Phase 7 (Admin), Phase 8 (Engagement)

**This is the MVP gate.** At the end of this phase a real customer can order and the store can fulfil it end to end.

**Done when:**
- [ ] Only `staff`/`admin` accounts can open `/store/*`; the server rejects every `staff_*` RPC for customers anyway
- [ ] A new order appears on the board **within about 1 s** with a looping alarm and vibration that stop only when every new order is accepted (or muted for 1 minute)
- [ ] The tablet screen stays on in Store mode; with the app in the background, a high-priority push with the order sound still arrives
- [ ] The board shows **New · Accepted · Packing · Ready · Out · Done** with ages, auto-cancel countdowns, "first order" and "frequent canceller" badges
- [ ] Picking: tapping (or scanning) a line marks it picked, the first pick moves the order to *Packing*, and *Mark packed* stays disabled until every active line is picked
- [ ] Marking an item unavailable recalculates the total (fees never go up), corrects stock by reason, notifies the customer live, and cancels the order if nothing is left
- [ ] Staff can print a **pick list** and **invoice** on A4 or a 58/80 mm thermal printer
- [ ] Stock screen: search or **scan a barcode**, change stock with a reason, switch availability, see low/out-of-stock lists and a short history; **Receiving mode** books a supplier delivery by scanning
- [ ] The **Accepting / Paused** switch and busy ETA update every customer's app live
- [ ] A `placed` order older than `stores.auto_cancel_minutes` is cancelled by `pg_cron`, stock is returned, and the customer and staff are told
- [ ] All pgTAP tests in `supabase/tests/0600_store_ops.test.sql` pass, and the two-device Maestro flow passes

| # | Heading | Output |
|---|---|---|
| 6.0 | Staff access (RLS) & foundations | Staff read policies, `order_status_transitions`, `stores` in Realtime |
| 6.1 | Store mode shell & role guard | `app/store/_layout.tsx`, keep-awake, live/offline bar, push enforcement |
| 6.2 | Live orders board + new-order alarm | `staff_list_board()`, `staff_today_summary()`, new-order staff trigger, board UI, `NewOrderAlarm` |
| 6.3 | Staff order screen & pick checklist | `staff_toggle_picked()`, `staff_set_order_note()`, pick list UI, **scan to pick** |
| 6.4 | Status flow & item unavailable | `staff_set_order_status()`, `staff_mark_item_unavailable()`, `StatusActionBar`, reject flow |
| 6.5 | Pick list & invoice printing | `pickListHtml.ts`, reuse of `invoiceHtml()`, paper settings |
| 6.6 | Stock screen, barcode scan & receiving | `staff_list_stock()`, `staff_adjust_stock()`, `staff_set_stock()`, `staff_set_available()`, `staff_receive_stock()` |
| 6.7 | Store switch & busy mode | `staff_set_store_open()`, `StoreSwitch` |
| 6.8 | Auto-cancel job | `auto_cancel_stale_orders()` + `pg_cron` |
| 6.9 | Staff notifications & issues | Push routing for staff, `staff_resolve_issue()`, issues screen |

**Migration file:** `supabase/migrations/0600_store_ops.sql`, made of the SQL blocks in this file **in heading order**.

**New error codes** (mapped to `errors.<CODE>` in the app): `FORBIDDEN`, `INVALID_TRANSITION`, `ITEMS_NOT_PICKED`, `ORDER_NOT_ACCEPTED`, `ORDER_LOCKED`, `ITEM_UNAVAILABLE`, `STOCK_NEGATIVE`, `INVALID_QUANTITY`, `INVALID_ETA`. Phase 5 codes are reused.

**Operating model without riders (for now):** the store's own person (or the shopkeeper) takes the bag. Staff tap **Out for delivery** when it leaves and **Delivered** when cash is collected; for customers who walk in to collect, **Handed over at store** goes straight from *Ready* to *Delivered*. Who delivered can go in the order note. The rider phase later replaces these two taps with a rider app.

---

## 6.0 Staff access (RLS) & foundations

**Goal:** staff can **read** everything needed to fulfil orders. Every **write** still goes through a `staff_*` RPC that checks the role and writes an audit row.

**SQL**
```sql
-- 0600 part 0: staff access --------------------------------------------------------
-- Read-only staff policies (OR-ed with the customer "own rows" policies from Phases 4/5).
drop policy if exists "orders: staff read"              on public.orders;
drop policy if exists "order_items: staff read"         on public.order_items;
drop policy if exists "order_status_events: staff read" on public.order_status_events;
drop policy if exists "inventory_movements: staff read" on public.inventory_movements;
drop policy if exists "order_issues: staff read"        on public.order_issues;

create policy "orders: staff read"              on public.orders              for select to authenticated using ((select public.is_staff()));
create policy "order_items: staff read"         on public.order_items         for select to authenticated using ((select public.is_staff()));
create policy "order_status_events: staff read" on public.order_status_events for select to authenticated using ((select public.is_staff()));
create policy "inventory_movements: staff read" on public.inventory_movements for select to authenticated using ((select public.is_staff()));
create policy "order_issues: staff read"        on public.order_issues        for select to authenticated using ((select public.is_staff()));

-- Issue photos (private bucket from Phase 5)
drop policy if exists "issues: staff read" on storage.objects;
create policy "issues: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'issues' and (select public.is_staff()));

-- Customer phone/name come from orders.address_snapshot, so staff need no access to profiles
-- or addresses (data minimisation, DPDP).

-- Allowed status moves. Data, not code: the app reads it to decide which buttons to show.
create table if not exists public.order_status_transitions (
  from_status public.order_status not null,
  to_status   public.order_status not null,
  primary key (from_status, to_status)
);
insert into public.order_status_transitions (from_status, to_status) values
  ('placed',           'confirmed'),
  ('confirmed',        'packing'),
  ('confirmed',        'packed'),             -- tiny orders: pick everything in one go
  ('packing',          'packed'),
  ('packed',           'out_for_delivery'),
  ('packed',           'delivered'),          -- "handed over at store" (customer pickup)
  ('out_for_delivery', 'delivered')
on conflict do nothing;
-- Cancelling is not a transition here: it always goes through cancel_order() (restock + reason).

alter table public.order_status_transitions enable row level security;
drop policy if exists "transitions: read" on public.order_status_transitions;
create policy "transitions: read" on public.order_status_transitions for select to authenticated using (true);

-- is_staff() is used inside RLS for every Realtime event: make sure it is cheap.
-- (Phase 0 defined it as STABLE SECURITY DEFINER reading profiles by primary key. Keep it that way.)

-- Realtime: the open/closed switch and ETA must reach every app (plan Section 5, channel store:<id>).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stores') then
    alter publication supabase_realtime add table public.stores;
  end if;
end $$;

create index if not exists orders_store_status_idx on public.orders (store_id, status, placed_at);
```

> **Multi-store later:** `is_staff()` is not store-scoped yet (one store). When a second store opens, add `staff_stores(user_id, store_id)` and change these policies to `using (public.is_staff_of(store_id))`. Every RPC below already takes or derives `store_id`, so only the check changes.

**Checks**
- As a customer: `select count(*) from orders` returns only their own orders. As staff it returns all of them.
- As staff: `update orders set status = 'delivered'` affects 0 rows (no update policy).

---

## 6.1 Store mode shell & role guard

**Goal:** a dedicated, distraction-free workspace that is safe on a shared tablet and never silently goes deaf.

**Files**
```
mobile/app/store/_layout.tsx               # guard + providers for all store screens
mobile/app/store/settings.tsx              # printer paper, alarm test, device checklist
mobile/src/features/store-ops/useStoreRealtime.ts
mobile/src/features/store-ops/LiveBar.tsx
mobile/src/features/store-ops/settings.ts  # Zustand + MMKV: paper size, auto-print, alarm volume hint
```

**SQL:** none.

**Steps**
1. Install: `npx expo install expo-keep-awake expo-audio expo-camera`.
2. Guard and shell:
   ```tsx
   // app/store/_layout.tsx
   export default function StoreLayout() {
     const { profile, isLoading } = useAuth();
     useKeepAwake();                                   // screen never sleeps in Store mode
     if (isLoading) return <SplashSkeleton />;
     if (!profile || !['staff', 'admin'].includes(profile.role)) return <Redirect href="/" />;
     return (
       <StoreProvider storeId={profile.default_store_id ?? DEFAULT_STORE_ID}>
         <StoreRealtime />          {/* one board channel, 6.2 */}
         <NewOrderAlarmHost />      {/* global alarm, 6.2 */}
         <LiveBar />                {/* green "LIVE" / red "OFFLINE: you will not get new orders" */}
         <Stack screenOptions={{ headerRight: () => <StoreSwitch compact /> }} />
       </StoreProvider>
     );
   }
   ```
   The client guard is only for UX. Security is RLS + `is_staff()` checks inside every RPC.
3. Entry point: Account tab → **🏪 Store mode** (visible only to staff/admin). On a dedicated tablet, set Store mode as the start screen: `settings.startInStoreMode = true` and redirect from `(shop)/_layout.tsx`.
4. **Push is mandatory for staff.** On first entry, call `registerForPush()` (Phase 5). If permission is denied, show a blocking card: "Notifications are off. You will miss orders when the app is in the background." with **Open settings** (`Linking.openSettings()`).
5. `LiveBar` reads the board channel state (`SUBSCRIBED` → green "LIVE ●"; anything else, or NetInfo offline → red full-width bar "OFFLINE: new orders won't arrive. Check Wi-Fi/data."). Staff must trust the screen. A silent dead socket is the worst failure in this phase.
6. **Device checklist** in `store/settings.tsx` (one-time, with checkboxes saved in MMKV):
   - Battery optimisation **off** for the app (Android Settings → Apps → NearKart → Battery → Unrestricted)
   - "Do not disturb" off during store hours, and media + notification volume at maximum
   - Tablet on the charger; Wi-Fi plus mobile data as a fallback
   - The `store_orders` notification channel allowed, with sound
   - **Test alarm** button (plays the alarm for 3 s) and **Test push** (inserts a `new_order`-type test notification for yourself via an admin RPC, or from Studio)
7. Shared tablets: log in with a dedicated store Google account (e.g. `store.rajapeth@gmail.com`, role `staff`). The push token moves to whoever logged in last (Phase 5 `register_push_token`).

**Checks**
- A customer account typing `/store` in a deep link is redirected Home.
- Turn Wi-Fi off: the red bar shows within a few seconds. Turn it on: green, and the board refetches.

---

## 6.2 Live orders board + new-order alarm

**Goal:** no order is ever missed, and the oldest work is always the most visible.

**Files**
```
mobile/app/store/index.tsx                                 # the board
mobile/src/features/store-ops/api.ts                       # fetchBoard, fetchTodaySummary
mobile/src/features/store-ops/useOrdersBoard.ts
mobile/src/features/store-ops/components/BoardColumn.tsx
mobile/src/features/store-ops/components/BoardOrderCard.tsx
mobile/src/features/store-ops/components/TodaySummary.tsx
mobile/src/features/store-ops/NewOrderAlarm.tsx
mobile/src/lib/useNow.ts                                   # re-render every 15 s for ages/countdowns
mobile/assets/sounds/new_order.wav                         # loud, 2–3 s, loops cleanly
```

**SQL**
```sql
-- 0600 part 2: board -----------------------------------------------------------------
create or replace function public.staff_list_board(p_store_id bigint)
returns table (
  id uuid, order_number text, status public.order_status,
  placed_at timestamptz, updated_at timestamptz,
  grand_total numeric, payment_method public.payment_method,
  receiver_name text, area text, has_note boolean,
  item_count int, picked_count int, unavailable_count int,
  is_first_order boolean, customer_cancels_30d int,
  auto_cancel_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;

  return query
  select o.id, o.order_number, o.status, o.placed_at, o.updated_at,
         o.grand_total, o.payment_method,
         o.address_snapshot ->> 'receiver_name', o.address_snapshot ->> 'area',
         coalesce(btrim(o.customer_note), '') <> '',
         (select count(*) from public.order_items i where i.order_id = o.id and i.status = 'active')::int,
         (select count(*) from public.order_items i where i.order_id = o.id and i.status = 'active' and i.picked)::int,
         (select count(*) from public.order_items i where i.order_id = o.id and i.status = 'unavailable')::int,
         not exists (select 1 from public.orders p
                     where p.user_id = o.user_id and p.id <> o.id and p.status = 'delivered'),
         (select count(*) from public.orders c
           where c.user_id = o.user_id and c.cancelled_by = 'customer'
             and c.cancelled_at > now() - interval '30 days')::int,
         case when o.status = 'placed' and s.auto_cancel_minutes > 0
              then o.placed_at + make_interval(mins => s.auto_cancel_minutes) end
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.store_id = p_store_id
    -- Explicit status lists: anything else (e.g. Phase 10 'awaiting_payment') never reaches the board.
    and (o.status in ('placed', 'confirmed', 'packing', 'packed', 'out_for_delivery')
         or (o.status in ('delivered', 'cancelled')
             and (o.updated_at at time zone 'Asia/Kolkata')::date = v_today))
  order by o.placed_at;
end;
$$;

create or replace function public.staff_today_summary(p_store_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v jsonb;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'orders',          count(*),
    'delivered',       count(*) filter (where o.status = 'delivered'),
    'cancelled',       count(*) filter (where o.status = 'cancelled'),
    'auto_cancelled',  count(*) filter (where o.cancelled_by = 'system'),
    'revenue',         coalesce(sum(o.grand_total) filter (where o.status = 'delivered'), 0),
    'cod_collected',   coalesce(sum(o.grand_total) filter (where o.status = 'delivered' and o.payment_method = 'cod'), 0),
    'cod_outstanding', coalesce(sum(o.grand_total) filter (where o.status = 'out_for_delivery' and o.payment_method = 'cod'), 0),
    'avg_accept_sec',  round(avg(extract(epoch from o.confirmed_at - o.placed_at)) filter (where o.confirmed_at is not null)),
    'avg_pack_sec',    round(avg(extract(epoch from o.packed_at - o.confirmed_at)) filter (where o.packed_at is not null))
  ) into v
  from public.orders o
  where o.store_id = p_store_id and (o.placed_at at time zone 'Asia/Kolkata')::date = v_today
    and o.status in ('placed', 'confirmed', 'packing', 'packed', 'out_for_delivery', 'delivered', 'cancelled');
  return v;
end;
$$;

revoke execute on function public.staff_list_board(bigint)    from public, anon;
revoke execute on function public.staff_today_summary(bigint) from public, anon;
grant  execute on function public.staff_list_board(bigint)    to authenticated;
grant  execute on function public.staff_today_summary(bigint) to authenticated;

-- Staff push/inbox when an order becomes 'placed'. A DEFERRED constraint trigger runs at
-- COMMIT, after place_order() has inserted the order_items, so the item count is right.
-- It fires on INSERT (COD) and on UPDATE into 'placed' (Phase 10: awaiting_payment → placed).
create or replace function public.notify_staff_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items int;
  v_total text := to_char(new.grand_total, 'FM99999990.00');
  v_area  text := coalesce(new.address_snapshot ->> 'area', '');
begin
  if new.status <> 'placed' or (tg_op = 'UPDATE' and old.status = 'placed') then
    return null;
  end if;
  select count(*) into v_items from public.order_items where order_id = new.id;
  perform public.notify_staff(
    new.store_id, 'new_order',
    jsonb_build_object('en', '🔔 New order ' || new.order_number,
                       'mr', '🔔 नवीन ऑर्डर ' || new.order_number,
                       'hi', '🔔 नया ऑर्डर ' || new.order_number),
    jsonb_build_object('en', '₹' || v_total || ' · ' || v_items || ' items · ' || v_area || case when new.payment_method = 'cod' then ' · COD' else '' end,
                       'mr', '₹' || v_total || ' · ' || v_items || ' वस्तू · ' || v_area,
                       'hi', '₹' || v_total || ' · ' || v_items || ' आइटम · ' || v_area),
    jsonb_build_object('order_id', new.id, 'url', '/store/order/' || new.id));
  return null;
end;
$$;

drop trigger if exists orders_notify_staff_new on public.orders;
create constraint trigger orders_notify_staff_new
  after insert or update of status on public.orders
  deferrable initially deferred
  for each row execute function public.notify_staff_new_order();
```

**Steps**
1. Data and live updates:
   ```ts
   // useOrdersBoard.ts
   export const boardKeys = {
     board: (storeId: number) => ['store', storeId, 'board'] as const,
     summary: (storeId: number) => ['store', storeId, 'summary'] as const,
     order: (id: string) => ['store', 'order', id] as const,
   };

   export const useOrdersBoard = (storeId: number) => useQuery({
     queryKey: boardKeys.board(storeId),
     queryFn: async () => {
       const { data, error } = await supabase.rpc('staff_list_board', { p_store_id: storeId });
       if (error) throw error;
       return data;
     },
     refetchInterval: 20_000,          // safety net if the socket dies silently
     refetchIntervalInBackground: false,
   });

   // useStoreRealtime.ts: the plan's channel "store-orders:store=<id>"
   export function useStoreRealtime(storeId: number) {
     const qc = useQueryClient();
     useEffect(() => {
       const ch = supabase.channel(`store-orders:store=${storeId}`)
         .on('postgres_changes',
           { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
           (p) => {
             qc.invalidateQueries({ queryKey: boardKeys.board(storeId) });
             qc.invalidateQueries({ queryKey: boardKeys.summary(storeId) });
             const id = (p.new as { id?: string }).id;
             if (id) qc.invalidateQueries({ queryKey: boardKeys.order(id) });
           })
         .subscribe((status) => {
           realtimeState.set('store-orders', status);
           if (status === 'SUBSCRIBED') qc.invalidateQueries({ queryKey: ['store', storeId] });
         });
       return () => { supabase.removeChannel(ch); };
     }, [storeId, qc]);
   }
   ```
   The board RPC is a **read**, and Realtime only says "something changed". Two tablets can't drift apart.
2. Columns (from status):
   | Column | Statuses | Card's main action |
   |---|---|---|
   | **New** | `placed` | Accept / Reject |
   | **Accepted** | `confirmed` | Start packing |
   | **Packing** | `packing` | Open (picked 5/8) |
   | **Ready** | `packed` | Out for delivery / Handed over |
   | **Out** | `out_for_delivery` | Delivered · collect ₹ |
   | **Done** | `delivered`, `cancelled` (today only) | View |
   Layout: `useWindowDimensions().width >= 900` → horizontal columns side by side (Done collapsed to a count). Phones → segmented tabs with counts ("New 2 · Packing 1 …"), with **New** auto-selected whenever it isn't empty.
3. `BoardOrderCard` contents, top to bottom:
   - **Order number** in large type, plus the age ("4 min") from `useNow(15_000)`, coloured green < 2 min, amber < 5 min, red ≥ 5 min (plus an icon, not colour alone)
   - **New only:** a countdown "Auto-cancels in 3:12" from `auto_cancel_at`
   - Items and progress ("8 items · 5 picked"), with "1 unavailable" when > 0
   - **"COD · collect ₹412"** or "Paid" (Phase 10)
   - Receiver name + area, a 📝 icon if the customer left a note
   - Badges: **First order** (call to confirm if the value is high) and **⚠ 3 cancels in 30 days** (from `customer_cancels_30d`)
   - Tap → `/store/order/[id]`. Primary action buttons right on the card for *Accept*, *Out for delivery* and *Delivered* so busy staff don't need to open it.
4. `TodaySummary` strip (from `staff_today_summary`): "Today: 38 orders · 34 delivered · 2 cancelled (1 missed) · **Cash collected ₹12,340** · on the road ₹820 · avg accept 1m 40s". This is the shopkeeper's end-of-day cash reconciliation.
5. **New-order alarm**: one global component, driven by the count of `placed` orders on the board:
   ```tsx
   // NewOrderAlarm.tsx
   const ALARM = require('@/../assets/sounds/new_order.wav');

   export function NewOrderAlarmHost() {
     const { storeId } = useStore();
     const { data } = useOrdersBoard(storeId);
     const pending = data?.filter((o) => o.status === 'placed').length ?? 0;
     const [mutedUntil, setMutedUntil] = useState(0);
     const now = useNow(1_000);
     const ringing = pending > 0 && now > mutedUntil;
     const player = useAudioPlayer(ALARM);

     useEffect(() => {
       setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false });
     }, []);

     useEffect(() => {
       player.loop = true;
       if (ringing) {
         player.seekTo(0); player.play();
         Vibration.vibrate([0, 800, 400], true);       // repeat until cancelled
       } else {
         player.pause(); Vibration.cancel();
       }
       return () => { player.pause(); Vibration.cancel(); };
     }, [ringing, player]);

     if (!ringing) return null;
     return (
       <AlarmBanner
         text={t('store.newOrders', { count: pending })}          // "2 new orders. Accept now"
         onOpen={() => router.push('/store')}
         onMute={() => setMutedUntil(Date.now() + 60_000)}        // never "mute forever"
       />
     );
   }
   ```
   - The alarm stops by itself when there are no `placed` orders (accepted, rejected or auto-cancelled, on **any** tablet).
   - While muted, the banner still shows. It rings again after 1 minute if orders are still waiting.
   - In the background, JS may be suspended. That's what the `store_orders` push channel (MAX importance, custom sound, from Phase 5) is for.
6. Pull-to-refresh on the board and a "Last updated 8 s ago" label under the LiveBar.

**Checks**
- Place an order from a customer phone: the board shows it in about 1 s and the alarm rings. Accept it on a **second** tablet: the alarm stops on the first.
- Kill the board's socket (airplane mode for 30 s, then back): the board refetches and nothing is missing.
- The staff push says "🔔 New order NK-… · ₹412 · 8 items · Rajapeth · COD" (correct item count thanks to the deferred trigger).

**Tests**
- pgTAP: `staff_list_board` raises `FORBIDDEN` for customers; `is_first_order` and `customer_cancels_30d` are correct; Done shows only today's orders.
- RNTL: `BoardOrderCard` age colours and countdown; accessible label "New order NK-…, 4 minutes old, auto-cancels in 3 minutes".
- Unit: `NewOrderAlarmHost` ringing logic (pending, muted, unmuted).

---

## 6.3 Staff order screen & pick checklist

**Goal:** picking is fast, hard to get wrong, and visible to every tablet in real time.

**Files**
```
mobile/app/store/order/[id].tsx
mobile/src/features/store-ops/components/PickListRow.tsx
mobile/src/features/store-ops/components/CustomerCard.tsx
mobile/src/features/store-ops/components/ScanToPick.tsx
mobile/src/features/store-ops/components/BarcodeScanner.tsx     # shared with 6.6
```

**SQL**
```sql
-- 0600 part 3: picking ----------------------------------------------------------------
create or replace function public.staff_toggle_picked(p_order_item_id bigint, p_picked boolean)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  public.order_items;
  v_order public.orders;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;

  select * into v_item from public.order_items where id = p_order_item_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_item.order_id for update;
  if v_order.status = 'placed' then raise exception 'ORDER_NOT_ACCEPTED'; end if;
  if v_order.status not in ('confirmed', 'packing') then raise exception 'ORDER_LOCKED'; end if;
  if v_item.status <> 'active' then raise exception 'ITEM_UNAVAILABLE'; end if;

  update public.order_items set picked = p_picked where id = p_order_item_id;

  if p_picked and v_order.status = 'confirmed' then
    -- First pick starts packing automatically: one less button to press.
    update public.orders set status = 'packing', updated_at = now()
     where id = v_order.id returning * into v_order;
    insert into public.order_status_events (order_id, status, note, actor_id)
    values (v_order.id, 'packing', null, auth.uid());
  else
    -- Touch the order so the board (and other tablets) refresh the "5/8 picked" progress.
    update public.orders set updated_at = now() where id = v_order.id returning * into v_order;
  end if;
  return v_order;
end;
$$;

create or replace function public.staff_set_order_note(p_order_id uuid, p_note text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.orders;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  update public.orders set staff_note = nullif(btrim(left(p_note, 500)), ''), updated_at = now()
   where id = p_order_id returning * into v_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return v_order;
end;
$$;

revoke execute on function public.staff_toggle_picked(bigint, boolean) from public, anon;
revoke execute on function public.staff_set_order_note(uuid, text)     from public, anon;
grant  execute on function public.staff_toggle_picked(bigint, boolean) to authenticated;
grant  execute on function public.staff_set_order_note(uuid, text)     to authenticated;
```

**Steps**
1. Staff order query (RLS staff read). Join product/category for the **pick path** and the barcode for scan-to-pick:
   ```ts
   export async function fetchStaffOrder(id: string) {
     const { data, error } = await supabase.from('orders').select(`*,
       order_items(id, variant_id, name_snapshot, variant_label_snapshot, image_path, price, mrp,
                   quantity, line_total, status, picked, gst_rate, hsn_code,
                   variant:product_variants(barcode, sku),
                   product:products(category:categories(id, sort_order, name, parent:categories(sort_order)))),
       order_status_events(id, status, note, actor_id, created_at),
       order_issues(id, type, status, message, photo_paths, created_at)`)
       .eq('id', id).single();
     if (error) throw error;
     return data;
   }
   ```
2. Sort lines by **parent category → sub-category → name** and group them under headings ("Dairy", "Snacks"). That approximates the walk through the shelves. A real `shelf`/`aisle` attribute can be added per product in Phase 7 (`attributes.shelf`) and used as the first sort key.
3. Screen layout (tablet: two panes; phone: one scroll):
   - **Header:** order number, status chip, age, and **"COD · collect ₹412"** in large type
   - **`CustomerCard`:** receiver name, **📞 Call** (`tel:` with `address_snapshot.receiver_phone`), **WhatsApp**, address + landmark, **Open in Maps** (`geo:<lat>,<lng>?q=<lat>,<lng>(<name>)` on Android, `maps://?ll=` on iOS), the badges from the board, and the **customer note highlighted in yellow**
   - **Pick list:** `PickListRow` per line: 56 px image, name + variant label, **quantity badge** (large and red when > 1: "×3"), and a big tap target that toggles picked with a check animation. Unavailable lines are struck through. The "⋯" button opens the unavailable sheet (6.4).
   - **Progress:** "5 of 8 picked" bar
   - **Staff note** field (debounced save via `staff_set_order_note`)
   - **Timeline** (events with notes and who did what)
   - **`StatusActionBar`** pinned at the bottom (6.4)
4. Optimistic picking. Packing is a tap-tap-tap job; don't make staff wait for the network:
   ```ts
   export function useTogglePicked(orderId: string) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: async ({ itemId, picked }: { itemId: number; picked: boolean }) => {
         const { error } = await supabase.rpc('staff_toggle_picked', { p_order_item_id: itemId, p_picked: picked });
         if (error) throw error;
       },
       onMutate: async ({ itemId, picked }) => {
         await qc.cancelQueries({ queryKey: boardKeys.order(orderId) });
         const prev = qc.getQueryData<StaffOrder>(boardKeys.order(orderId));
         qc.setQueryData<StaffOrder>(boardKeys.order(orderId), (o) => o && ({
           ...o, order_items: o.order_items.map((i) => (i.id === itemId ? { ...i, picked } : i)),
         }));
         Haptics.selectionAsync();
         return { prev };
       },
       onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(boardKeys.order(orderId), ctx.prev),
       onSettled: () => qc.invalidateQueries({ queryKey: boardKeys.order(orderId) }),
     });
   }
   ```
5. **Scan to pick** (fewer wrong items): the button opens `BarcodeScanner` as an overlay. Each scan looks up the line whose `variant.barcode` matches:
   - match, not yet picked → mark picked + short beep + green flash. When `quantity > 1`, require that many scans (counter "2/3") or a "count ✓" tap.
   - match, already fully picked → "Already picked"
   - no match → loud error buzz + "**Not in this order**: 8901234567890". This catches the classic wrong-variant mistake (1 kg instead of 500 g).
6. `BarcodeScanner` (shared with 6.6):
   ```tsx
   export function BarcodeScanner({ onScan }: { onScan: (code: string) => void }) {
     const [permission, requestPermission] = useCameraPermissions();
     const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
     if (!permission) return null;
     if (!permission.granted) return <PermissionCard onAllow={requestPermission} reason={t('store.cameraWhy')} />;
     return (
       <CameraView
         style={StyleSheet.absoluteFill}
         facing="back"
         barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
         onBarcodeScanned={({ data }) => {
           const now = Date.now();
           if (data === last.current.code && now - last.current.at < 1500) return;   // debounce same code
           last.current = { code: data, at: now };
           onScan(data);
         }}
       />
     );
   }
   ```

**Checks**
- Tap 3 of 5 lines on tablet A: tablet B shows "3 of 5 picked" within about 1 s, and the order moved to *Packing* on the first tap.
- Picking a `placed` order shows "Accept the order first".
- Scanning the wrong variant gives the error and doesn't pick.

**Tests**
- pgTAP: first pick moves `confirmed → packing` and logs an event; picking an unavailable line raises `ITEM_UNAVAILABLE`; customers get `FORBIDDEN`.
- RNTL: `PickListRow` quantity badge and accessible label ("Amul Taaza 500 ml, quantity 3, not picked, double tap to mark picked").
- Unit: pick-path sorter; scan-to-pick reducer (match / multi-quantity / mismatch).

---

## 6.4 Status flow & item unavailable

**Goal:** every move is legal, logged and announced; a missing item never surprises the customer at the door.

**Files**
```
mobile/src/features/store-ops/components/StatusActionBar.tsx
mobile/src/features/store-ops/components/UnavailableSheet.tsx
mobile/src/features/store-ops/components/RejectOrderSheet.tsx
mobile/src/ui/HoldButton.tsx               # press-and-hold to confirm (1 s), no "Are you sure?" dialogs
```

**SQL**
```sql
-- 0600 part 4: status + unavailable --------------------------------------------------------
create or replace function public.staff_set_order_status(
  p_order_id uuid, p_status public.order_status, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_note  text := nullif(btrim(left(p_note, 500)), '');
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;

  if p_status = 'cancelled' then
    return public.cancel_order(p_order_id, coalesce(v_note, 'store_cancelled'));   -- restock + reason
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.status = p_status then
    return v_order;            -- two tablets pressed the same button: idempotent, no error
  end if;
  if not exists (select 1 from public.order_status_transitions t
                 where t.from_status = v_order.status and t.to_status = p_status) then
    raise exception 'INVALID_TRANSITION';
  end if;
  if p_status = 'packed' and exists (
       select 1 from public.order_items i
       where i.order_id = p_order_id and i.status = 'active' and not i.picked) then
    raise exception 'ITEMS_NOT_PICKED';
  end if;

  update public.orders
     set status              = p_status,
         confirmed_at        = case when p_status = 'confirmed'        then now() else confirmed_at end,
         packed_at           = case when p_status = 'packed'           then now() else packed_at end,
         out_for_delivery_at = case when p_status = 'out_for_delivery' then now() else out_for_delivery_at end,
         delivered_at        = case when p_status = 'delivered'        then now() else delivered_at end,
         -- Cash collected at the door marks a COD order paid.
         payment_status      = case when p_status = 'delivered' and payment_method = 'cod'
                                    then 'paid'::public.payment_status else payment_status end,
         staff_note          = coalesce(v_note, staff_note),
         updated_at          = now()
   where id = p_order_id
  returning * into v_order;

  insert into public.order_status_events (order_id, status, note, actor_id)
  values (p_order_id, p_status, v_note, auth.uid());

  return v_order;               -- customer notification: Phase 5 trigger on orders.status
end;
$$;

-- p_reason: 'not_found' | 'damaged' | 'expired' | 'customer_request'
create or replace function public.staff_mark_item_unavailable(p_order_item_id bigint, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   public.order_items;
  v_order  public.orders;
  v_stock  int;
  v_active int;
  v_name   jsonb;
  v_total  text;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_reason not in ('not_found', 'damaged', 'expired', 'customer_request') then
    raise exception 'INVALID_REASON';
  end if;

  select * into v_item from public.order_items where id = p_order_item_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_item.order_id for update;
  if v_order.status not in ('placed', 'confirmed', 'packing') then
    raise exception 'ORDER_LOCKED';   -- bag already packed: cancel or call the customer instead
  end if;
  if v_item.status = 'unavailable' then return v_order; end if;

  update public.order_items set status = 'unavailable', picked = false where id = p_order_item_id;

  -- Stock: the order already took these units off the books when it was placed.
  --   not_found        → the books were wrong: the shelf is empty, so set stock to 0 (log the gap)
  --   customer_request → units go back on the shelf: +qty
  --   damaged/expired  → units left the shelf and are binned: books are already right, no change
  if p_reason in ('not_found', 'customer_request') then
    select stock into v_stock from public.inventory
     where store_id = v_order.store_id and variant_id = v_item.variant_id for update;
    if p_reason = 'not_found' and coalesce(v_stock, 0) > 0 then
      update public.inventory set stock = 0, updated_at = now()
       where store_id = v_order.store_id and variant_id = v_item.variant_id;
      insert into public.inventory_movements (store_id, variant_id, delta, reason, order_id, note, actor_id)
      values (v_order.store_id, v_item.variant_id, -v_stock, 'item_unavailable', v_order.id,
              'Not found on shelf while packing ' || v_order.order_number, v_uid);
    elsif p_reason = 'customer_request' then
      update public.inventory set stock = stock + v_item.quantity, updated_at = now()
       where store_id = v_order.store_id and variant_id = v_item.variant_id;
      insert into public.inventory_movements (store_id, variant_id, delta, reason, order_id, note, actor_id)
      values (v_order.store_id, v_item.variant_id, v_item.quantity, 'item_unavailable', v_order.id,
              'Removed at customer request ' || v_order.order_number, v_uid);
    end if;
  end if;

  v_name := v_item.name_snapshot;
  insert into public.order_status_events (order_id, status, note, actor_id)
  values (v_order.id, v_order.status,
          'Item unavailable (' || p_reason || '): ' || coalesce(v_name ->> 'en', '') || ' ×' || v_item.quantity, v_uid);

  select count(*) into v_active from public.order_items where order_id = v_order.id and status = 'active';
  if v_active = 0 then
    -- Nothing left to deliver. The Phase 5 trigger tells the customer "store cancelled".
    return public._cancel_order_internal(v_order.id, 'all_items_unavailable', 'store', v_uid);
  end if;

  -- Recalculate. Rule: fees NEVER go up because the store couldn't supply an item.
  with t as (
    select sum(i.line_total) as item_total, sum(i.mrp * i.quantity) as mrp_total
    from public.order_items i where i.order_id = v_order.id and i.status = 'active'
  )
  update public.orders o
     set item_total  = t.item_total,
         mrp_total   = t.mrp_total,
         grand_total = t.item_total + o.delivery_fee + o.small_cart_fee + o.packaging_fee,
         updated_at  = now()
    from t
   where o.id = v_order.id
  returning o.* into v_order;

  v_total := to_char(v_order.grand_total, 'FM99999990.00');
  insert into public.notifications (user_id, type, title, body, data)
  values (v_order.user_id, 'order_items_changed',
    jsonb_build_object('en', 'An item is unavailable', 'mr', 'एक वस्तू उपलब्ध नाही', 'hi', 'एक आइटम उपलब्ध नहीं है'),
    jsonb_build_object(
      'en', coalesce(v_name ->> 'en', '') || ' is unavailable and removed. New total ₹' || v_total || '.',
      'mr', coalesce(v_name ->> 'mr', v_name ->> 'en', '') || ' उपलब्ध नाही, काढली आहे. नवीन एकूण ₹' || v_total || '.',
      'hi', coalesce(v_name ->> 'hi', v_name ->> 'en', '') || ' उपलब्ध नहीं है, हटा दिया गया। नया कुल ₹' || v_total || '।'),
    jsonb_build_object('order_id', v_order.id, 'url', '/order/' || v_order.id));

  -- Phase 10: for a paid UPI order, enqueue a partial refund of the line here.
  return v_order;
end;
$$;

revoke execute on function public.staff_set_order_status(uuid, public.order_status, text) from public, anon;
revoke execute on function public.staff_mark_item_unavailable(bigint, text)            from public, anon;
grant  execute on function public.staff_set_order_status(uuid, public.order_status, text) to authenticated;
grant  execute on function public.staff_mark_item_unavailable(bigint, text)            to authenticated;
```

**Steps**
1. `StatusActionBar`: the next action comes from the status, with the transitions table as a guard:
   | Status | Primary | Secondary |
   |---|---|---|
   | `placed` | **Accept order** → `confirmed` (optionally auto-print the pick list, 6.5) | **Reject** → `RejectOrderSheet` |
   | `confirmed` | **Start packing** → `packing` | Print pick list |
   | `packing` | **Mark packed** → `packed` (disabled with "3 left to pick" until done) | Print pick list |
   | `packed` | **Out for delivery** → `out_for_delivery` | **Handed over at store** → `delivered` (hold) |
   | `out_for_delivery` | **Delivered · collected ₹412** → `delivered` (`HoldButton`, 1 s hold) | Call customer |
   | `delivered` / `cancelled` | — | Print invoice |
   Final steps use press-and-hold instead of a dialog: fast for staff, but accident-proof. Every button shows a spinner and is disabled while its RPC runs. `ITEMS_NOT_PICKED` and `INVALID_TRANSITION` refetch the order and show a friendly toast ("Another tablet already moved this order").
2. `RejectOrderSheet` (cancel by store), with store reason codes: `out_of_stock` · `store_closing` · `area_not_serviceable` · `customer_unreachable` · `suspected_fake` · `other` (+ text). It calls `staff_set_order_status(id, 'cancelled', reason)`. For `suspected_fake`, an admin can block the user in Phase 7 (`profiles.is_blocked`, `cod_allowed`).
3. Before rejecting for `out_of_stock`, the sheet suggests **Mark items unavailable instead**. A partial order is better than none.
4. `UnavailableSheet` (from a line's "⋯"): four big options, **Not on shelf**, **Damaged**, **Expired**, **Customer asked to remove**, plus a preview "New total ₹388 (was ₹412)". The preview is computed on the phone **for display only**; the server recalculates. If it's the last active line: "This will cancel the order. The customer will be told."
5. A good habit for staff, shown as a hint in the sheet: **call the customer** for expensive items before removing them ("Shall I give the 1 kg instead?"). Swapping variants is a later feature; for now, remove it and the customer can reorder.

**Checks**
- Try `packed` with an unpicked line: `ITEMS_NOT_PICKED`. Pick everything: OK, and `packed_at` is set.
- Mark 1 of 3 lines unavailable (reason `not_found`): the line is unavailable, totals drop by its `line_total`, fees are unchanged, `inventory.stock = 0` with an `item_unavailable` movement of `-old stock`, and the customer screen shows the change live plus a notification.
- Mark the last line unavailable: the order is `cancelled` with `cancelled_by = 'store'`.
- Deliver a COD order: `payment_status = 'paid'`, `delivered_at` set.

**Tests:** pgTAP: every allowed transition succeeds and a sample of disallowed ones fail (`placed → packed`, `delivered → packing`); same-status call is a no-op; the unavailable stock rules per reason; fees never increase; last line cancels; customers get `FORBIDDEN`.

---

## 6.5 Pick list & invoice printing

**Goal:** paper where paper helps: a pick list for the packer and an invoice in the bag. Works with the printers small shops already have.

**Files**
```
mobile/src/features/store-ops/printing.ts
mobile/src/features/store-ops/pickListHtml.ts
mobile/src/features/orders/invoiceHtml.ts         # from Phase 5, paper sizes a4 / 80mm / 58mm
```

**SQL:** none.

**Steps**
1. Paper and behaviour settings (Zustand + MMKV, per device): `paper: 'a4' | '80mm' | '58mm'`, `autoPrintOnAccept: boolean`, `printInvoiceWhenPacked: boolean`.
2. Pick list template: large order number, a checkbox per line, quantity first and bold, grouped by category (same sorter as 6.3):
   ```ts
   // pickListHtml.ts
   export function pickListHtml(order: StaffOrder, lang: Lang, paper: PaperSize) {
     const groups = groupByCategory(sortForPicking(order.order_items.filter((i) => i.status === 'active')));
     const body = groups.map(([cat, items]) => `
       <h3>${esc(localize(cat.name, lang))}</h3>
       ${items.map((i) => `<div class="row"><span class="box">☐</span>
           <b class="qty">${i.quantity}×</b> ${esc(localize(i.name_snapshot, lang))}
           <small>${esc(localize(i.variant_label_snapshot, lang))}</small></div>`).join('')}`).join('');
     return `<!doctype html><html><head><meta charset="utf-8"><style>
       @page { size: ${paper === 'a4' ? 'A4' : `${paper} auto`}; margin: ${paper === 'a4' ? '12mm' : '2mm'}; }
       body { font-family: 'Noto Sans','Noto Sans Devanagari',sans-serif; font-size: ${paper === '58mm' ? 11 : 13}px; }
       .no { font-size: 2em; font-weight: 800; } .qty { font-size: 1.25em; }
       .row { padding: 4px 0; border-bottom: 1px dashed #999; } .box { font-size: 1.3em; margin-right: 6px; }
       .cod { font-size: 1.4em; font-weight: 800; border: 2px solid #000; padding: 4px; margin-top: 8px; }
     </style></head><body>
       <div class="no">${esc(order.order_number)}</div>
       <div>${esc(order.address_snapshot.receiver_name)} · ${esc(order.address_snapshot.area)}</div>
       ${order.customer_note ? `<p><b>Note:</b> ${esc(order.customer_note)}</p>` : ''}
       ${body}
       <p>${order.order_items.filter((i) => i.status === 'active').reduce((n, i) => n + i.quantity, 0)} units</p>
       ${order.payment_method === 'cod' ? `<div class="cod">COD ₹${inr(order.grand_total)}</div>` : ''}
     </body></html>`;
   }
   ```
3. Printing:
   ```ts
   // printing.ts
   export async function printPickList(order: StaffOrder) {
     const { paper } = useStoreSettings.getState();
     await Print.printAsync({ html: pickListHtml(order, i18n.language as Lang, paper) });
   }
   export async function printInvoice(order: StaffOrder) {
     const { paper } = useStoreSettings.getState();
     await Print.printAsync({ html: invoiceHtml(order, i18n.language as Lang, paper) });
   }
   export async function shareInvoicePdf(order: StaffOrder) {           // e.g. WhatsApp it to the customer
     const { uri } = await Print.printToFileAsync({ html: invoiceHtml(order, i18n.language as Lang, 'a4') });
     await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
   }
   ```
4. **Thermal printers:** `expo-print` uses the OS print dialog. Most 58/80 mm Bluetooth/USB printers work through the manufacturer's Android **print service plugin** or a generic one (e.g. *RawBT*, *Mopria*). Pick the paper size in the dialog once; Android remembers it. On the web admin, the browser's print dialog does the same.
   > Silent one-tap ESC/POS printing (no dialog) needs a native thermal-printer library and a printer-specific setup. It's a good later upgrade if the dialog slows the counter down.
5. Hooks: if `autoPrintOnAccept`, call `printPickList` right after **Accept** succeeds; if `printInvoiceWhenPacked`, call `printInvoice` after **Mark packed**.
6. Print the pick list **in the staff member's language** (the device language), and the invoice in the **customer's language** if you have it (`orders` doesn't store it; use EN by default, plus a language toggle in the print menu).

**Checks**
- An 80 mm print fits the width with no cut-off text; Devanagari prints correctly.
- A pick list with 25 lines spills onto several thermal "pages" cleanly (no clipped rows: `break-inside: avoid` on `.row`).

**Tests:** unit snapshot of `pickListHtml` for an order with 2 categories and an unavailable line (excluded); escaping test.

---

## 6.6 Stock screen, barcode scan & receiving

**Goal:** the numbers in the app match the shelf, because customers see stock live (Phase 1) and `place_order` trusts it.

**Files**
```
mobile/app/store/stock.tsx
mobile/app/store/receive.tsx                                   # receiving mode
mobile/src/features/store-ops/components/StockRow.tsx
mobile/src/features/store-ops/components/StockAdjustSheet.tsx
mobile/src/features/store-ops/receiveStore.ts                  # Zustand tally for receiving mode
```

**SQL**
```sql
-- 0600 part 6: stock ------------------------------------------------------------------
-- p_filter: 'all' | 'low' | 'out' | 'off'
create or replace function public.staff_list_stock(
  p_store_id bigint, p_filter text default 'all', p_q text default null, p_page int default 0)
returns table (
  variant_id bigint, product_id bigint, product_name jsonb, variant_label jsonb,
  sku text, barcode text, price numeric, mrp numeric,
  stock int, low_stock_threshold int, is_available boolean, thumb_path text, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := nullif(btrim(p_q), '');
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  return query
  select pv.id, p.id, p.name, pv.label, pv.sku, pv.barcode, pv.price, pv.mrp,
         coalesce(inv.stock, 0), coalesce(inv.low_stock_threshold, 5), coalesce(inv.is_available, false),
         (select im.thumb_path from public.product_images im
           where im.product_id = p.id and (im.variant_id is null or im.variant_id = pv.id)
           order by (im.variant_id is null), im.sort_order limit 1),
         inv.updated_at
  from public.product_variants pv
  join public.products p on p.id = pv.product_id
  left join public.inventory inv on inv.variant_id = pv.id and inv.store_id = p_store_id
  where pv.is_active and p.is_active
    and case p_filter
          when 'low' then coalesce(inv.stock, 0) > 0 and coalesce(inv.stock, 0) <= coalesce(inv.low_stock_threshold, 5)
          when 'out' then coalesce(inv.stock, 0) = 0
          when 'off' then not coalesce(inv.is_available, false)
          else true end
    and (v_q is null
         or pv.barcode = v_q
         or pv.sku ilike v_q || '%'
         or p.search_text ilike '%' || v_q || '%')
  order by case when p_filter in ('low', 'out') then coalesce(inv.stock, 0) end nulls last,
           p.name ->> 'en', pv.sort_order
  limit 50 offset greatest(p_page, 0) * 50;
end;
$$;

create or replace function public.staff_adjust_stock(
  p_store_id bigint, p_variant_id bigint, p_delta int, p_reason public.stock_reason, p_note text default null)
returns public.inventory
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.inventory;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_reason not in ('restock', 'adjustment', 'damage') or p_delta = 0
     or (p_reason = 'restock' and p_delta < 0) or (p_reason = 'damage' and p_delta > 0)
     or abs(p_delta) > 10000 then
    raise exception 'INVALID_QUANTITY';
  end if;

  insert into public.inventory (store_id, variant_id, stock) values (p_store_id, p_variant_id, 0)
  on conflict (store_id, variant_id) do nothing;

  select * into v_inv from public.inventory
   where store_id = p_store_id and variant_id = p_variant_id for update;
  if v_inv.stock + p_delta < 0 then raise exception 'STOCK_NEGATIVE'; end if;

  update public.inventory set stock = stock + p_delta, updated_at = now()
   where store_id = p_store_id and variant_id = p_variant_id
  returning * into v_inv;          -- Phase 5 notify_back_in_stock() fires on 0 → >0

  insert into public.inventory_movements (store_id, variant_id, delta, reason, note, actor_id)
  values (p_store_id, p_variant_id, p_delta, p_reason, nullif(btrim(p_note), ''), auth.uid());
  return v_inv;
end;
$$;

-- "I counted 14 on the shelf": sets the exact number, logs the difference as an adjustment.
create or replace function public.staff_set_stock(
  p_store_id bigint, p_variant_id bigint, p_stock int, p_note text default null)
returns public.inventory
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current int;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_stock < 0 or p_stock > 100000 then raise exception 'INVALID_QUANTITY'; end if;

  insert into public.inventory (store_id, variant_id, stock) values (p_store_id, p_variant_id, 0)
  on conflict (store_id, variant_id) do nothing;
  select stock into v_current from public.inventory
   where store_id = p_store_id and variant_id = p_variant_id for update;

  if p_stock = v_current then
    return (select i from public.inventory i where i.store_id = p_store_id and i.variant_id = p_variant_id);
  end if;
  return public.staff_adjust_stock(p_store_id, p_variant_id, p_stock - v_current, 'adjustment',
                                   coalesce(nullif(btrim(p_note), ''), 'Stock count'));
end;
$$;

create or replace function public.staff_set_available(p_store_id bigint, p_variant_id bigint, p_available boolean)
returns public.inventory
language plpgsql
security definer
set search_path = ''
as $$
declare v_inv public.inventory;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  insert into public.inventory (store_id, variant_id, stock, is_available)
  values (p_store_id, p_variant_id, 0, p_available)
  on conflict (store_id, variant_id) do update set is_available = excluded.is_available, updated_at = now()
  returning * into v_inv;
  return v_inv;
end;
$$;

-- Receiving mode: a whole supplier delivery in one transaction.
-- p_items: [{"variant_id": 12, "qty": 24}, ...]
create or replace function public.staff_receive_stock(p_store_id bigint, p_items jsonb, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'INVALID_QUANTITY';
  end if;
  for r in
    select (e ->> 'variant_id')::bigint as variant_id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1                                  -- consistent lock order
  loop
    perform public.staff_adjust_stock(p_store_id, r.variant_id, r.qty, 'restock',
                                      coalesce(nullif(btrim(p_note), ''), 'Supplier delivery'));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.staff_list_stock(bigint, text, text, int)                          from public, anon;
revoke execute on function public.staff_adjust_stock(bigint, bigint, int, public.stock_reason, text) from public, anon;
revoke execute on function public.staff_set_stock(bigint, bigint, int, text)                         from public, anon;
revoke execute on function public.staff_set_available(bigint, bigint, boolean)                       from public, anon;
revoke execute on function public.staff_receive_stock(bigint, jsonb, text)                           from public, anon;
grant  execute on function public.staff_list_stock(bigint, text, text, int)                          to authenticated;
grant  execute on function public.staff_adjust_stock(bigint, bigint, int, public.stock_reason, text) to authenticated;
grant  execute on function public.staff_set_stock(bigint, bigint, int, text)                         to authenticated;
grant  execute on function public.staff_set_available(bigint, bigint, boolean)                       to authenticated;
grant  execute on function public.staff_receive_stock(bigint, jsonb, text)                           to authenticated;
```

**Steps**
1. **Stock screen** tabs: **All · Low · Out · Off** (counts in the tab labels). A search box (name, SKU or barcode) plus a 📷 **Scan** button. Each `StockRow` shows a thumbnail, name + label, price, a big stock number coloured by level (with an icon), and an availability switch. An infinite list (50 per page) via `staff_list_stock`.
2. **Scan** → `BarcodeScanner` (6.3) → `staff_list_stock(store, 'all', code)`:
   - one match → open `StockAdjustSheet` directly
   - none → "Unknown barcode 8901…": an admin can add the product (Phase 7 product form, prefilled with the barcode); staff just see the message
3. `StockAdjustSheet`:
   - current stock (large) and "Low below 5"
   - quick buttons **−1 · +1 · +6 · +12 · +24** (common case sizes), with a reason chip row: **Restock** (positive only), **Damaged/expired** (negative only), **Correction**
   - **Set exact count** field → `staff_set_stock` (for counting a shelf)
   - **Available** switch → `staff_set_available` (e.g. "don't sell the last 2 bruised mangoes")
   - **History:** the last 10 `inventory_movements` for this variant (who, when, why, ±qty), e.g. "−1 · order NK-…-0042", "+24 · Supplier delivery · Ramesh"
   Each change is saved immediately (not optimistic: it's stock), and customers' screens update live through the Phase 1 inventory channel.
4. **Receiving mode** (`/store/receive`) for a supplier delivery: the camera stays open. Each scan adds +1 to a local tally (Zustand) with a beep and a haptic. Tap a row to type a quantity ("24"). Unknown barcodes collect in a separate list for the admin. **Save 23 lines** → `staff_receive_stock` (one transaction, all or nothing). The tally survives an app restart (MMKV) until saved or discarded.
5. **Low-stock nudges:** the board header shows "⚠ 6 items low · 3 out", tapping to the Low tab. A daily low-stock summary push to admins can come in Phase 7 with the reports.

**Checks**
- `+24 Restock` on a variant at 0 with "Notify me" subscribers: stock 24, a movement logged, back-in-stock notifications created (Phase 5), and customer screens flip from "Out of stock" to **ADD**.
- `−5` on a variant at 3: `STOCK_NEGATIVE`, nothing changes.
- Set exact count 14 when the books say 17: one `adjustment` movement of −3.
- Receiving 3 lines where one variant id doesn't exist: the whole call fails, and no stock changed.

**Tests:** pgTAP: reasons and sign rules; negative stock blocked; set-stock delta; receive is atomic; `staff_list_stock` filters (`low`, `out`, `off`) and barcode lookup; customers get `FORBIDDEN`.

---

## 6.7 Store switch & busy mode

**Goal:** the shopkeeper controls the flow of orders with one tap, and every customer sees it immediately.

**Files**
```
mobile/src/features/store-ops/components/StoreSwitch.tsx
mobile/src/features/store-ops/components/BusySheet.tsx
```

**SQL**
```sql
-- 0600 part 7: store switch --------------------------------------------------------------
-- The app always sends the full desired state (null busy message = clear it).
create or replace function public.staff_set_store_open(
  p_store_id bigint, p_accepting boolean, p_busy_message jsonb default null, p_eta_minutes int default null)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_eta_minutes is not null and (p_eta_minutes < 5 or p_eta_minutes > 180) then
    raise exception 'INVALID_ETA';
  end if;
  if p_busy_message is not null and jsonb_typeof(p_busy_message) <> 'object' then
    raise exception 'INVALID_REASON';
  end if;

  update public.stores
     set is_accepting_orders = p_accepting,
         busy_message        = p_busy_message,
         eta_minutes         = coalesce(p_eta_minutes, eta_minutes),
         updated_at          = now()
   where id = p_store_id
  returning * into v_store;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return v_store;               -- Realtime on stores pushes this to every app
end;
$$;
revoke execute on function public.staff_set_store_open(bigint, boolean, jsonb, int) from public, anon;
grant  execute on function public.staff_set_store_open(bigint, boolean, jsonb, int) to authenticated;
```
> Fees, minimum order, opening hours and the service area are **admin** settings (Phase 7), not staff switches.

**Steps**
1. `StoreSwitch` in the store header: a large pill **● Accepting orders** / **⏸ Paused**. Pausing asks one question inline (not a dialog): "Customers will see 'Store closed'. Pause?" plus a reason preset. If there are active orders: "You still have 4 orders to finish. They are not affected."
2. Also show the **schedule** state from Phase 1 `store_status()`: if the switch is on but it's outside opening hours, show "Outside opening hours: customers see *Opens at 7:00 AM*". The switch can't open the store outside its hours (hours are the admin's decision).
3. `BusySheet`: ETA chips **15 · 20 · 30 · 45 · 60 min** and message presets (localized `{en,mr,hi}` stored in the app's i18n files): "Heavy rain, deliveries may be late", "Very busy right now", "Stock-taking, back at 4 PM", plus custom text (typed in one language and copied to all three; admins can refine later). **Clear** resets to the normal ETA and no message.
4. On the customer side (Phase 1/3 store header and Phase 4 checkout), the `store:<id>` Realtime channel already refetches `store_status()`: the banner flips within about 1 s, and `place_order` refuses new orders while paused (Phase 4 rule).

**Checks**
- Pause on the tablet: a customer on the cart screen sees "Store closed" and the **Place order** button disabled within about 1 s; trying anyway returns the closed error.
- Set ETA 45 + "Heavy rain": the Home header shows "~45 min · Heavy rain, deliveries may be late" in the customer's language.

**Tests:** pgTAP: ETA bounds; customers get `FORBIDDEN`. RNTL: `StoreSwitch` states, including "outside opening hours".

---

## 6.8 Auto-cancel job

**Goal:** a customer never waits on an order nobody saw. It's better to cancel quickly and honestly.

**SQL**
```sql
-- 0600 part 8: auto-cancel ---------------------------------------------------------------
create or replace function public.auto_cancel_stale_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select o.id, o.store_id, o.order_number
    from public.orders o
    join public.stores s on s.id = o.store_id
    where o.status = 'placed'
      and s.auto_cancel_minutes > 0
      and o.placed_at < now() - make_interval(mins => s.auto_cancel_minutes)
    order by o.placed_at
    for update of o skip locked                  -- a tablet accepting it right now wins
  loop
    perform public._cancel_order_internal(r.id, 'not_accepted_in_time', 'system', null);
    -- Phase 5 trigger tells the customer; tell the staff too, so missed orders are visible.
    perform public.notify_staff(r.store_id, 'new_order',
      jsonb_build_object('en', 'Missed order ' || r.order_number,
                         'mr', 'चुकलेली ऑर्डर ' || r.order_number,
                         'hi', 'छूटा हुआ ऑर्डर ' || r.order_number),
      jsonb_build_object('en', 'It was not accepted in time and was cancelled automatically.',
                         'mr', 'वेळेत स्वीकारली नाही, आपोआप रद्द झाली.',
                         'hi', 'समय पर स्वीकार नहीं हुआ, अपने आप रद्द हो गया।'),
      jsonb_build_object('order_id', r.id, 'url', '/store/order/' || r.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.auto_cancel_stale_orders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('auto-cancel-stale-orders', '* * * * *', $$select public.auto_cancel_stale_orders()$$);
```

**Steps**
1. Choose `stores.auto_cancel_minutes` with the owner: **5–8 minutes** suits a 20-minute promise. `0` disables it (e.g. while testing).
2. The customer's live screen shows the cancelled step with "The store couldn't accept your order in time. You weren't charged." and a **Try again** button (reorder → cart).
3. The board's **Done** column shows auto-cancelled orders with a red "Missed" badge, and `staff_today_summary.auto_cancelled` counts them. This number should be **0** on a good day; review it weekly.
4. Watch the job: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'auto-cancel-stale-orders') order by start_time desc limit 20;` A failing run means customers wait forever, so add it to the Phase 9 monitoring checklist.
5. Optional (later): a half-time reminder push to staff ("NK-…-0042 waiting 4 min") using a `reminded_at` column. The board alarm usually makes it unnecessary.

**Checks**
- Set `auto_cancel_minutes = 1`, place an order, wait about 2 minutes: the order is cancelled by `system`, stock is back, the customer got the message, and staff got "Missed order".
- Accept an order at 0:59: the cron run skips it (`skip locked` / status no longer `placed`).

**Tests:** pgTAP: backdate `placed_at`, call `auto_cancel_stale_orders()` directly, and assert status, `cancelled_by = 'system'`, restock and the staff notification; a `confirmed` order with an old `placed_at` is not touched.

---

## 6.9 Staff notifications & issues

**Goal:** staff hear about everything that needs a human (new orders, missed orders, customer complaints) and can close the loop with the customer.

**Files**
```
mobile/app/store/issues.tsx
mobile/src/features/store-ops/components/IssueCard.tsx
mobile/src/features/store-ops/components/ResolveIssueSheet.tsx
```

**SQL**
```sql
-- 0600 part 9: issues ---------------------------------------------------------------------
create or replace function public.staff_resolve_issue(
  p_issue_id bigint, p_status public.issue_status, p_note text)
returns public.order_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.order_issues;
  v_order public.orders;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_status = 'open' then raise exception 'INVALID_TRANSITION'; end if;
  if p_note is null or char_length(btrim(p_note)) = 0 then raise exception 'INVALID_REASON'; end if;

  update public.order_issues
     set status = p_status, resolution_note = btrim(left(p_note, 1000)), resolved_at = now()
   where id = p_issue_id and status = 'open'
  returning * into v_issue;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_issue.order_id;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_issue.user_id, 'issue_update',
    case p_status when 'resolved'
      then jsonb_build_object('en','Your issue was resolved','mr','तुमची तक्रार सोडवली','hi','आपकी शिकायत हल हो गई')
      else jsonb_build_object('en','Update on your issue','mr','तुमच्या तक्रारीबद्दल माहिती','hi','आपकी शिकायत पर अपडेट') end,
    jsonb_build_object('en', v_order.order_number || ': ' || btrim(p_note),
                       'mr', v_order.order_number || ': ' || btrim(p_note),
                       'hi', v_order.order_number || ': ' || btrim(p_note)),   -- staff note as typed
    jsonb_build_object('order_id', v_order.id, 'issue_id', v_issue.id, 'url', '/order/' || v_order.id));
  return v_issue;
end;
$$;
revoke execute on function public.staff_resolve_issue(bigint, public.issue_status, text) from public, anon;
grant  execute on function public.staff_resolve_issue(bigint, public.issue_status, text) to authenticated;
```

**Steps**
1. **What staff get notified about** (all through `notifications`, so they show in the 🔔 inbox *and* as push via Phase 5's `send-push`):
   | Type | When | Push channel |
   |---|---|---|
   | `new_order` | every new order (6.2 trigger) and every auto-cancelled one (6.8) | `store_orders` (MAX importance, `new_order.wav`, bypasses the quiet default) |
   | `new_issue` | a customer reports a problem (Phase 5) | `store_orders` |
   Staff who are also customers get their customer notifications as usual.
2. **Issues screen** (`/store/issues`): open issues first, oldest first. Each `IssueCard` has the order number, customer, type, message, photos (signed URLs from the private bucket, tap to zoom), the item it refers to, and **Call customer**. A badge on the Store header shows the open count.
3. `ResolveIssueSheet`: **Resolved** / **Rejected**, plus a note preset or custom text. Presets: "Refund of ₹X given in cash", "Replacement delivered", "Amount adjusted on your next order", "Item was delivered as ordered (photo checked)". COD refunds are handled in person for now. Online refunds arrive with Phase 10.
4. The customer's order screen (Phase 5) shows the issue status and note live; the notification links there.
5. Treat a repeated pattern (same product damaged 3 times this week) as a supplier or packing problem: Phase 7's reports group issues by product.

**Checks**
- A customer reports "Damaged" with a photo: staff get a push, the issue shows with its photo, and resolving it notifies the customer and updates their screen.

**Tests:** pgTAP: only `open` issues can be resolved; the note is required; customers get `FORBIDDEN`; the customer notification is written.

---

## Testing for Phase 6

**pgTAP** (`supabase/tests/0600_store_ops.test.sql`), using the helpers from Phase 5 (`tests.place_test_order`, `tests.authenticate_as`):
```sql
begin;
select plan(18);

select tests.create_supabase_user('cust'); select tests.create_supabase_user('staff');
update public.profiles set role = 'staff' where id = tests.get_supabase_uid('staff');
select tests.place_test_order('cust', 1, 2) as o \gset          -- 2 lines: variant 1 ×2, plus helper adds variant 2 ×1

-- customers can't use staff RPCs
select tests.authenticate_as('cust');
select throws_ok(format($$select public.staff_set_order_status(%L, 'confirmed')$$, :'o'), 'FORBIDDEN');
select throws_ok($$select * from public.staff_list_board(1)$$, 'FORBIDDEN');
select throws_ok($$select public.staff_adjust_stock(1, 1, 5, 'restock')$$, 'FORBIDDEN');

-- staff flow
select tests.authenticate_as('staff');
select throws_ok(format($$select public.staff_set_order_status(%L, 'packed')$$, :'o'), 'INVALID_TRANSITION', 'placed → packed not allowed');
select lives_ok(format($$select public.staff_set_order_status(%L, 'confirmed')$$, :'o'));
select lives_ok(format($$select public.staff_set_order_status(%L, 'confirmed')$$, :'o'), 'same status is a no-op');
select throws_ok(format($$select public.staff_set_order_status(%L, 'packed')$$, :'o'), 'ITEMS_NOT_PICKED');

select id as item1 from public.order_items where order_id = :'o' order by id limit 1 \gset
select id as item2 from public.order_items where order_id = :'o' order by id offset 1 limit 1 \gset
select lives_ok(format('select public.staff_toggle_picked(%s, true)', :item1));
select is((select status::text from public.orders where id = :'o'), 'packing', 'first pick starts packing');

-- item unavailable: totals drop, fees unchanged, stock → 0 for not_found
select grand_total as g0, delivery_fee as f0 from public.orders where id = :'o' \gset
select line_total as l2 from public.order_items where id = :item2 \gset
select lives_ok(format($$select public.staff_mark_item_unavailable(%s, 'not_found')$$, :item2));
select is((select grand_total from public.orders where id = :'o'), :g0 - :l2, 'total reduced by the line');
select is((select delivery_fee from public.orders where id = :'o'), :f0::numeric, 'fees unchanged');
select is((select stock from public.inventory where variant_id = (select variant_id from public.order_items where id = :item2)), 0, 'not_found zeroes stock');

select lives_ok(format($$select public.staff_set_order_status(%L, 'packed')$$, :'o'), 'all active lines picked');
select lives_ok(format($$select public.staff_set_order_status(%L, 'out_for_delivery')$$, :'o'));
select lives_ok(format($$select public.staff_set_order_status(%L, 'delivered')$$, :'o'));
select is((select payment_status::text from public.orders where id = :'o'), 'paid', 'COD delivered = paid');

-- auto-cancel
select tests.clear_authentication();
select tests.place_test_order('cust', 1, 1) as o2 \gset
update public.orders set placed_at = now() - interval '1 hour' where id = :'o2';
select is(public.auto_cancel_stale_orders(), 1, 'one stale order cancelled');

select * from finish();
rollback;
```

**Maestro (two devices)** `e2e/store_fulfilment.yaml`: run the customer flow on an Android emulator and the store flow on a second emulator (or an iOS simulator), driven by a small shell script:
1. Customer: browse → add 2 items → place a COD order → assert "Placed".
2. Store: assert the alarm banner "1 new order" → Accept → pick both lines → Mark packed → Out for delivery → hold Delivered.
3. Customer: assert the timeline shows "Delivered" without any manual refresh.

**Manual "busy evening" drill (do it once before launch, with real staff):**
- 5 orders in 2 minutes from 3 phones; two tablets packing at once
- one item missing mid-pack; one customer cancels while confirmed; one order left alone until auto-cancel
- Wi-Fi off on one tablet for a minute
- end of day: `TodaySummary` cash matches the cash drawer

---

## Phase 6 wrap-up

- **Regenerate types:** `supabase gen types typescript --local > mobile/src/types/database.ts`.
- **i18n keys added:** `store.*` (board columns, card labels, alarm, summary, live bar, checklist), `store.reject.reasons.*`, `store.unavailable.reasons.*`, `store.busy.presets.*`, `store.issues.*`, `errors.<CODE>` for the new codes.
- **Realtime budget:** +1 channel per store device (`store-orders:store=<id>`); `stores` is now published (for the open/closed switch on every customer app).
- **Ops handbook (1 page, printed at the counter, in Marathi):** how to accept, pick, handle a missing item, reject, pause the store, print, and what to do when the bar turns red.
- **MVP is ready.** Phases 0–6 together let real customers order with COD and the store fulfil it, with live status both ways. Before a public launch, still do the Phase 9 essentials: RLS review, the free-tier keep-alive, legal pages and Sentry.
- **Definition of done:** the checklist at the top, in EN/MR/HI, tablet and phone layouts, dark mode, large text, TalkBack on the board and pick list, and all pgTAP tests green in CI.
