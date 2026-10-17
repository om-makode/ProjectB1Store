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
  select v_order.user_id, 'order_items_changed',
    jsonb_build_object('en', 'An item is unavailable', 'mr', 'एक वस्तू उपलब्ध नाही', 'hi', 'एक आइटम उपलब्ध नहीं है'),
    jsonb_build_object(
      'en', coalesce(v_name ->> 'en', '') || ' is unavailable and removed. New total ₹' || v_total || '.',
      'mr', coalesce(v_name ->> 'mr', v_name ->> 'en', '') || ' उपलब्ध नाही, काढली आहे. नवीन एकूण ₹' || v_total || '.',
      'hi', coalesce(v_name ->> 'hi', v_name ->> 'en', '') || ' उपलब्ध नहीं है, हटा दिया गया। नया कुल ₹' || v_total || '।'),
    jsonb_build_object('order_id', v_order.id, 'url', '/order/' || v_order.id)
  where v_order.user_id is not null;            -- deleted accounts keep orders but get no messages

  -- Paid online orders: the Phase 10 trigger on orders.grand_total queues the partial refund.
  return v_order;
end;
$$;

revoke execute on function public.staff_set_order_status(uuid, public.order_status, text) from public, anon;
revoke execute on function public.staff_mark_item_unavailable(bigint, text)            from public, anon;
grant  execute on function public.staff_set_order_status(uuid, public.order_status, text) to authenticated;
grant  execute on function public.staff_mark_item_unavailable(bigint, text)            to authenticated;

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

-- pg_cron is enabled in the Phase 0 foundation migration.
select cron.schedule('auto-cancel-stale-orders', '* * * * *', $$select public.auto_cancel_stale_orders()$$);

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
