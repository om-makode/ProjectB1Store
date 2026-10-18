-- =====================================================================
-- 1. Allow eta_minutes to be 0 (e.g. to hide delivery time on Home Screen).
-- 2. Configurable store theme_color (emerald, amber, yellow, purple, navy, slate).
-- 3. Customer item cancellation in 'out_for_delivery'.
-- =====================================================================

-- 1. Add theme_color column and update check constraint on stores table
alter table public.stores add column if not exists theme_color text not null default 'emerald';

do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.conrelid = 'public.stores'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%eta_minutes%'
  ) loop
    execute format('alter table public.stores drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.stores add constraint stores_eta_minutes_check check (eta_minutes between 0 and 240);

-- 2. Update admin_update_store_settings to allow 0–240 minutes and theme_color
create or replace function public.admin_update_store_settings(p_store_id bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  s        public.stores;
  d        jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_jsonb(st) into v_before from public.stores st where st.id = p_store_id for update;
  if v_before is null then raise exception 'store not found' using errcode = 'P0002'; end if;

  update public.stores set
    name                     = coalesce(p_patch->'name', name),
    address                  = coalesce(p_patch->'address', address),
    phone                    = coalesce(p_patch->>'phone', phone),
    whatsapp                 = coalesce(p_patch->>'whatsapp', whatsapp),
    gstin                    = coalesce(upper(p_patch->>'gstin'), gstin),
    fssai_license            = coalesce(p_patch->>'fssai_license', fssai_license),
    opening_hours            = coalesce(p_patch->'opening_hours', opening_hours),
    eta_minutes              = coalesce((p_patch->>'eta_minutes')::int, eta_minutes),
    min_order_value          = coalesce((p_patch->>'min_order_value')::numeric, min_order_value),
    delivery_fee             = coalesce((p_patch->>'delivery_fee')::numeric, delivery_fee),
    free_delivery_above      = coalesce((p_patch->>'free_delivery_above')::numeric, free_delivery_above),
    small_cart_threshold     = coalesce((p_patch->>'small_cart_threshold')::numeric, small_cart_threshold),
    small_cart_fee           = coalesce((p_patch->>'small_cart_fee')::numeric, small_cart_fee),
    packaging_fee            = coalesce((p_patch->>'packaging_fee')::numeric, packaging_fee),
    max_cod_order_value      = coalesce((p_patch->>'max_cod_order_value')::numeric, max_cod_order_value),
    max_open_orders_per_user = coalesce((p_patch->>'max_open_orders_per_user')::int, max_open_orders_per_user),
    auto_cancel_minutes      = coalesce((p_patch->>'auto_cancel_minutes')::int, auto_cancel_minutes),
    service_radius_km        = coalesce((p_patch->>'service_radius_km')::numeric, service_radius_km),
    location = case when p_patch ? 'location' then
                 extensions.st_setsrid(extensions.st_makepoint(
                   (p_patch#>>'{location,lng}')::float8, (p_patch#>>'{location,lat}')::float8), 4326)::extensions.geography
               else location end,
    service_area = case
                 when not (p_patch ? 'service_area') then service_area
                 when p_patch->'service_area' = 'null'::jsonb then null
                 else extensions.st_setsrid(extensions.st_geomfromgeojson(p_patch->>'service_area'), 4326)::extensions.geography
               end,
    serviceable_pincodes = case
                 when not (p_patch ? 'serviceable_pincodes') then serviceable_pincodes
                 else coalesce((
                   select array_agg(distinct btrim(x) order by btrim(x))
                     from jsonb_array_elements_text(p_patch->'serviceable_pincodes') x
                    where btrim(x) <> ''), '{}'::text[])
               end,
    upi_enabled          = coalesce((p_patch->>'upi_enabled')::boolean, upi_enabled),
    payment_hold_minutes = coalesce((p_patch->>'payment_hold_minutes')::int, payment_hold_minutes),
    theme_color          = coalesce(p_patch->>'theme_color', theme_color)
  where id = p_store_id
  returning * into s;

  -- validation after the update: any failure rolls the update back
  if s.min_order_value < 0 or s.delivery_fee < 0 or s.free_delivery_above < 0 or s.small_cart_fee < 0
     or s.small_cart_threshold < 0 or s.packaging_fee < 0 then
    raise exception 'fees and thresholds cannot be negative' using errcode = '22023';
  end if;
  if s.max_cod_order_value <= 0 then raise exception 'max COD value must be above 0' using errcode = '22023'; end if;
  if s.max_cod_order_value < s.min_order_value then
    raise exception 'max COD value is below the minimum order: nobody could check out' using errcode = '22023';
  end if;
  if s.auto_cancel_minutes not between 2 and 60 then
    raise exception 'auto-cancel must be 2–60 minutes' using errcode = '22023';
  end if;
  if s.eta_minutes not between 0 and 240 then raise exception 'ETA must be 0–240 minutes' using errcode = '22023'; end if;
  if s.service_radius_km not between 0.3 and 30 then
    raise exception 'service radius must be 0.3–30 km' using errcode = '22023';
  end if;
  if s.max_open_orders_per_user not between 1 and 10 then
    raise exception 'open orders per user must be 1–10' using errcode = '22023';
  end if;
  if coalesce(s.gstin, '') <> '' and s.gstin !~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'GSTIN format looks wrong' using errcode = '22023';
  end if;
  if coalesce(s.fssai_license, '') <> '' and s.fssai_license !~ '^\d{14}$' then
    raise exception 'FSSAI licence is 14 digits' using errcode = '22023';
  end if;
  if p_patch ? 'serviceable_pincodes' and jsonb_typeof(p_patch->'serviceable_pincodes') <> 'array' then
    raise exception 'serviceable_pincodes must be a list of pincodes' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(s.serviceable_pincodes) pc where pc !~ '^[1-9][0-9]{5}$') then
    raise exception 'pincodes must be 6 digits and not start with 0' using errcode = '22023';
  end if;
  if cardinality(s.serviceable_pincodes) > 200 then
    raise exception 'at most 200 delivery pincodes' using errcode = '22023';
  end if;
  if s.payment_hold_minutes not between 5 and 60 then
    raise exception 'payment hold must be 5–60 minutes' using errcode = '22023';
  end if;
  if s.theme_color not in ('emerald', 'amber', 'yellow', 'purple', 'navy', 'slate') then
    raise exception 'invalid theme_color' using errcode = '22023';
  end if;
  if jsonb_typeof(s.opening_hours) <> 'object' then
    raise exception 'opening_hours must be an object of weekday → ranges' using errcode = '22023';
  end if;
  for d in select value from jsonb_each(s.opening_hours) loop
    if jsonb_typeof(d) <> 'array' or exists (
         select 1 from jsonb_array_elements(d) rng
         where coalesce(rng.value->>'open', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
            or coalesce(rng.value->>'close', '') !~ '^([01]\d|2[0-3]):[0-5]\d$') then
      raise exception 'opening hours must be HH:MM ranges' using errcode = '22023';
    end if;
  end loop;

  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'store_settings', 'store', p_store_id::text, v_before, to_jsonb(s));

  return to_jsonb(s);
end;
$$;
revoke execute on function public.admin_update_store_settings(bigint, jsonb) from public, anon;
grant  execute on function public.admin_update_store_settings(bigint, jsonb) to authenticated;

-- 3. Update store_status to return theme_color
create or replace function public.store_status(p_store_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s           public.stores;
  v_local     timestamp;
  v_day       date;
  v_key       text;
  v_slot      jsonb;
  v_open_now  boolean := false;
  v_opens_at  timestamptz;
  v_closes_at timestamptz;
begin
  select * into s from public.stores
   where id = coalesce(p_store_id, public.default_store_id()) and is_active;
  if not found then return null; end if;

  v_local := now() at time zone s.timezone;

  if s.opening_hours = '{}'::jsonb then
    v_open_now := true;
  else
    for d in 0..7 loop
      v_day := v_local::date + d;
      v_key := lower(to_char(v_day, 'dy'));
      for v_slot in
        select e.value from jsonb_array_elements(coalesce(s.opening_hours->v_key, '[]'::jsonb)) e
         order by e.value->>'open'
      loop
        if d = 0 and v_local::time >= (v_slot->>'open')::time
                 and v_local::time <  (v_slot->>'close')::time then
          v_open_now  := true;
          v_closes_at := (v_day + (v_slot->>'close')::time) at time zone s.timezone;
        elsif v_opens_at is null and (v_day + (v_slot->>'open')::time) > v_local then
          v_opens_at := (v_day + (v_slot->>'open')::time) at time zone s.timezone;
        end if;
      end loop;
      exit when v_opens_at is not null;
    end loop;
  end if;

  return jsonb_build_object(
    'store_id',    s.id,
    'name',        s.name,
    'city',        s.city,
    'phone',       s.phone,
    'accepting',   s.is_accepting_orders,
    'open_now',    v_open_now,
    'is_open',     v_open_now and s.is_accepting_orders,
    'opens_at',    v_opens_at,
    'closes_at',   v_closes_at,
    'eta_minutes', s.eta_minutes,
    'message',     s.busy_message,
    'theme_color', coalesce(s.theme_color, 'emerald'),
    'fees', jsonb_build_object(
      'min_order_value', s.min_order_value, 'delivery_fee', s.delivery_fee,
      'free_delivery_above', s.free_delivery_above, 'small_cart_threshold', s.small_cart_threshold,
      'small_cart_fee', s.small_cart_fee, 'packaging_fee', s.packaging_fee
    )
  );
end;
$$;
revoke execute on function public.store_status(bigint) from public, anon;
grant  execute on function public.store_status(bigint) to authenticated, anon;

-- 4. Update staff_set_store_open to allow 0–240 minutes
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
  if p_eta_minutes is not null and (p_eta_minutes < 0 or p_eta_minutes > 240) then
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
  return v_store;
end;
$$;
revoke execute on function public.staff_set_store_open(bigint, boolean, jsonb, int) from public, anon;
grant  execute on function public.staff_set_store_open(bigint, boolean, jsonb, int) to authenticated;

-- 5. Update staff_mark_item_unavailable to allow cancellation in 'packed' and 'out_for_delivery'
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
  if v_order.status not in ('placed', 'confirmed', 'packing', 'packed', 'out_for_delivery') then
    raise exception 'ORDER_LOCKED';
  end if;
  if v_item.status = 'unavailable' then return v_order; end if;

  update public.order_items set status = 'unavailable', picked = false where id = p_order_item_id;

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
    return public._cancel_order_internal(v_order.id, 'all_items_unavailable', 'store', v_uid);
  end if;

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
  where v_order.user_id is not null;

  return v_order;
end;
$$;
revoke execute on function public.staff_mark_item_unavailable(bigint, text) from public, anon;
grant  execute on function public.staff_mark_item_unavailable(bigint, text) to authenticated;
