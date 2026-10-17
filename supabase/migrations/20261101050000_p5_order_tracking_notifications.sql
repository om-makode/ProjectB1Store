-- 0500 part 0: foundation ------------------------------------------------------
-- pg_net and pg_cron are enabled in the Phase 0 foundation migration.

-- Notifications: the in-app inbox (5.7) and the source of every push (5.8)
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Every type used by any phase lives here, so later phases never alter the constraint:
  --   Phase 5/6: order_status, order_items_changed, back_in_stock, issue_update, new_order, new_issue, announcement
  --   Phase 7: role_changed · Phase 8: price_drop, review_prompt, campaign, campaign_test · Phase 10: refund_update
  type        text not null check (type in (
                'order_status','order_items_changed','back_in_stock',
                'issue_update','new_order','new_issue','announcement',
                'role_changed','price_drop','review_prompt','campaign','campaign_test','refund_update')),
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

-- 0500 part 1
create index if not exists orders_user_placed_idx on public.orders (user_id, placed_at desc);

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

  -- Refunds for paid online orders are queued by the Phase 10 trigger on orders (queue_refund_if_needed).
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
  -- ::text so this compiles before Phase 10 adds 'awaiting_payment' (an unpaid order can always be cancelled).
  if not v_staff and v_order.status::text not in ('awaiting_payment', 'placed', 'confirmed') then
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
           min(pv.price)                               as price,
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
      insert into public.cart_items as ci (user_id, variant_id, quantity, price_at_add)
      values (v_uid, r.variant_id, least(v_qty, 50), r.price)
      on conflict (user_id, variant_id) do update
        set quantity = least(greatest(ci.quantity, excluded.quantity), r.max_per_order, 50);
      v_added := v_added || jsonb_build_object(
        'variant_id', r.variant_id, 'quantity', v_qty, 'reduced', v_qty < r.qty);
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'missing', v_missing);
end;
$$;
revoke execute on function public.reorder_to_cart(uuid) from public, anon;
grant  execute on function public.reorder_to_cart(uuid) to authenticated;

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
  -- Only real status changes are announced (other order updates, e.g. Phase 8's
  -- review_prompt_sent_at, must stay silent). Orders of deleted accounts have no user.
  if (tg_op = 'UPDATE' and new.status is not distinct from old.status) or new.user_id is null then
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
         set triggered_at = coalesce(sa.triggered_at, now()),   -- same meaning as Phase 2
             notified_at  = now()                                -- the inbox row below is the notification
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
select cron.schedule('purge-old-notifications', '30 21 * * *',      -- 03:00 IST
  $$delete from public.notifications where created_at < now() - interval '90 days'$$);

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
