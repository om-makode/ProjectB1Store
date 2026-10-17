-- =====================================================================
-- Addresses: GPS location optional; delivery area checked at checkout.
--
-- * addresses.latitude / longitude / location become nullable, so a customer can
--   save any address (typed by hand, any city).
-- * stores.serviceable_pincodes: pincodes the store delivers to. Used when an
--   address has no GPS point.
-- * private.serviceability_for_address(point, pincode): GPS point if present
--   (radius / service_area, as before), otherwise the pincode list.
-- * The address trigger, private._quote() and place_order() now use it. Their
--   bodies are copied from 20261101030000 / 20261101040000 with only that call
--   changed.
-- =====================================================================

alter table public.addresses
  alter column latitude  drop not null,
  alter column longitude drop not null,
  alter column location  drop not null;

alter table public.stores
  add column if not exists serviceable_pincodes text[] not null default '{}';

comment on column public.stores.serviceable_pincodes is
  'Pincodes this store delivers to; used for addresses saved without a GPS location.';

-- Amravati city pincodes for the seeded store (edit in the admin / SQL editor).
update public.stores
   set serviceable_pincodes = array['444601','444602','444603','444604','444605','444606','444607']
 where city = 'Amravati' and serviceable_pincodes = '{}';

create or replace function private.serviceability_for_address(
  p_point   extensions.geography,
  p_pincode text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_store record;
begin
  if p_point is not null then
    return private.serviceability_for_point(p_point);
  end if;

  select s.id, s.eta_minutes
    into v_store
    from public.stores s
   where s.is_active and p_pincode = any (s.serviceable_pincodes)
   order by s.id
   limit 1;

  if not found then
    return jsonb_build_object('serviceable', false, 'reason', 'OUTSIDE_AREA', 'distance_km', null);
  end if;

  return jsonb_build_object(
    'serviceable',      true,
    'store_id',         v_store.id,
    'nearest_store_id', v_store.id,
    'distance_km',      null,
    'eta_minutes',      v_store.eta_minutes,
    'reason',           null
  );
end;
$$;

revoke all on function private.serviceability_for_address(extensions.geography, text) from public;

-- ---------- address trigger (from 20261101030000) ----------
create or replace function private.addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live_count int;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'ADDRESS_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;

  -- GPS is optional: an address can be saved anywhere; delivery is checked at checkout.
  if (new.latitude is null) <> (new.longitude is null) then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;
  new.location := case
    when new.latitude is not null then
      extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography
  end;

  new.is_serviceable := coalesce(
    (private.serviceability_for_address(new.location, new.pincode) ->> 'serviceable')::boolean, false
  );

  if new.deleted_at is not null then
    new.is_default := false;
    return new;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_live_count
    from public.addresses a
    where a.user_id = new.user_id and a.deleted_at is null;

    if v_live_count >= 20 then
      raise exception 'ADDRESS_LIMIT' using errcode = 'P0001';
    end if;

    if v_live_count = 0 then
      new.is_default := true;          -- the first address is the default
    end if;
  end if;

  if new.is_default then
    update public.addresses a
       set is_default = false
     where a.user_id = new.user_id
       and a.is_default
       and a.id <> new.id;
  end if;

  return new;
end;
$$;


-- ---------- quote (from 20261101040000) ----------
create or replace function private._quote(
  p_items           jsonb,
  p_user_id         uuid,
  p_address_id      uuid,
  p_payment_method  public.payment_method
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blockers      jsonb := '[]'::jsonb;
  v_addr          public.addresses%rowtype;
  v_service       jsonb;
  v_store_id      bigint;
  v_store         public.stores%rowtype;
  v_status        jsonb;
  v_profile       public.profiles%rowtype;
  v_lines         jsonb;
  v_item_total    numeric(10,2);
  v_mrp_total     numeric(10,2);
  v_item_count    int;
  v_needs_review  boolean;
  v_delivery      numeric(10,2) := 0;
  v_delivery_full numeric(10,2) := 0;
  v_small         numeric(10,2) := 0;
  v_packaging     numeric(10,2) := 0;
  v_grand         numeric(10,2);
  v_open_orders   int;
  v_upi_enabled   boolean;
  v_cod_reason    text;
begin
  -- 1. Address → store ----------------------------------------------------
  if p_address_id is null then
    v_blockers := v_blockers || jsonb_build_object('code', 'ADDRESS_REQUIRED');
  else
    select * into v_addr
    from public.addresses a
    where a.id = p_address_id and a.user_id = p_user_id and a.deleted_at is null;

    if not found then
      v_blockers := v_blockers || jsonb_build_object('code', 'ADDRESS_NOT_FOUND');
    else
      v_service := private.serviceability_for_address(v_addr.location, v_addr.pincode);
      if coalesce((v_service ->> 'serviceable')::boolean, false) then
        v_store_id := (v_service ->> 'store_id')::bigint;
      else
        v_blockers := v_blockers || jsonb_build_object(
          'code', 'NOT_SERVICEABLE', 'distance_km', v_service -> 'distance_km');
      end if;
    end if;
  end if;

  v_store_id := coalesce(v_store_id, public.default_store_id());
  select * into v_store from public.stores s where s.id = v_store_id;

  -- 2. Lines, priced from current data ------------------------------------
  with req as (
    select (e ->> 'variant_id')::bigint                          as variant_id,
           sum(greatest(coalesce((e ->> 'quantity')::int, 0), 0)) as quantity,
           max(nullif(e ->> 'price_at_add', '')::numeric)        as price_at_add
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    group by 1
  ),
  l as (
    select r.variant_id, v.product_id, p.slug, p.name, v.label, p.is_veg,
           img.thumb_path,
           v.mrp, v.price, r.price_at_add, r.quantity,
           coalesce(v.max_per_order, 10) as max_per_order,
           case when v.is_active and p.is_active and coalesce(i.is_available, false)
                then coalesce(i.stock, 0) else 0 end as stock,
           coalesce(i.low_stock_threshold, 5) as low_stock_threshold
    from req r
    join public.product_variants v on v.id = r.variant_id
    join public.products p on p.id = v.product_id
    left join public.inventory i on i.store_id = v_store_id and i.variant_id = v.id
    left join lateral (
      select pi.thumb_path
      from public.product_images pi
      where pi.product_id = p.id and (pi.variant_id is null or pi.variant_id = v.id)
      order by (pi.variant_id is null), pi.sort_order
      limit 1
    ) img on true
    where r.quantity > 0
  ),
  b as (
    select l.*, least(l.quantity, l.stock, l.max_per_order, 50) as billable
    from l
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'variant_id',        b.variant_id,
      'product_id',        b.product_id,
      'slug',              b.slug,
      'name',              b.name,
      'variant_label',     b.label,
      'is_veg',            b.is_veg,
      'image_path',        b.thumb_path,
      'mrp',               b.mrp,
      'price',             b.price,
      'price_at_add',      b.price_at_add,
      'quantity',          b.quantity,
      'billable_quantity', b.billable,
      'max_per_order',     b.max_per_order,
      'stock_left',        case when b.stock <= b.low_stock_threshold then b.stock end,  -- only shown when low
      'line_total',        b.price * b.billable,
      'line_mrp_total',    b.mrp * b.billable,
      'flags', to_jsonb(array_remove(array[
        case when b.stock = 0 then 'out_of_stock' end,
        case when b.stock > 0 and b.quantity > b.stock then 'low_stock' end,
        case when b.quantity > b.max_per_order then 'over_limit' end,
        case when b.price_at_add is not null and b.price_at_add <> b.price then 'price_changed' end
      ], null))
    ) order by b.variant_id), '[]'::jsonb),
    coalesce(sum(b.price * b.billable), 0),
    coalesce(sum(b.mrp * b.billable), 0),
    coalesce(sum(b.billable), 0),
    coalesce(bool_or(b.billable < b.quantity), false)
  into v_lines, v_item_total, v_mrp_total, v_item_count, v_needs_review
  from b;

  -- 3. Fees ------------------------------------------------------------------
  if v_item_total > 0 then
    v_delivery_full := coalesce(v_store.delivery_fee, 0);
    v_delivery := case
      when v_store.free_delivery_above is not null and v_item_total >= v_store.free_delivery_above then 0
      else v_delivery_full end;
    v_small := case
      when v_store.small_cart_threshold is not null and v_item_total < v_store.small_cart_threshold
      then coalesce(v_store.small_cart_fee, 0) else 0 end;
    v_packaging := coalesce(v_store.packaging_fee, 0);
  end if;
  v_grand := v_item_total + v_delivery + v_small + v_packaging;

  -- 4. Blockers --------------------------------------------------------------
  -- CART_EMPTY only when there are no lines at all. Lines that exist but can't
  -- be sold (stock 0) give CART_NEEDS_REVIEW, so the UI can show what changed.
  if jsonb_array_length(v_lines) = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'CART_EMPTY');
  end if;

  if v_needs_review then
    v_blockers := v_blockers || jsonb_build_object('code', 'CART_NEEDS_REVIEW');
  end if;

  v_status := public.store_status(v_store_id);
  if not coalesce((v_status ->> 'is_open')::boolean, false)
     or not coalesce((v_status ->> 'accepting')::boolean, false) then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'STORE_CLOSED', 'opens_at', v_status -> 'opens_at', 'message', v_status -> 'message');
  end if;

  if v_item_count > 0 and v_item_total < coalesce(v_store.min_order_value, 0) then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'BELOW_MIN_ORDER',
      'min_order_value', v_store.min_order_value,
      'amount_needed', v_store.min_order_value - v_item_total);
  end if;

  -- Online payment exists only once Phase 10 adds stores.upi_enabled (read via to_jsonb so
  -- this function needs no change when that column arrives).
  v_upi_enabled := coalesce((to_jsonb(v_store) ->> 'upi_enabled')::boolean, false);
  if p_payment_method <> 'cod' and not v_upi_enabled then
    v_blockers := v_blockers || jsonb_build_object('code', 'PAYMENT_METHOD_UNAVAILABLE');
  end if;

  if p_user_id is null then
    v_blockers := v_blockers || jsonb_build_object('code', 'LOGIN_REQUIRED');
  else
    select * into v_profile from public.profiles pr where pr.id = p_user_id;

    if coalesce(v_profile.is_blocked, false) then
      v_blockers := v_blockers || jsonb_build_object('code', 'ACCOUNT_BLOCKED');
    end if;

    if not coalesce(v_profile.cod_allowed, true) then
      v_cod_reason := 'COD_NOT_ALLOWED';
    elsif v_store.max_cod_order_value is not null and v_grand > v_store.max_cod_order_value then
      v_cod_reason := 'COD_LIMIT_EXCEEDED';
    end if;
    if p_payment_method = 'cod' and v_cod_reason is not null then
      v_blockers := v_blockers || jsonb_build_object(
        'code', v_cod_reason, 'max_cod_order_value', v_store.max_cod_order_value);
    end if;

    select count(*) into v_open_orders
    from public.orders o
    where o.user_id = p_user_id and o.status not in ('delivered', 'cancelled');

    if v_store.max_open_orders_per_user is not null and v_open_orders >= v_store.max_open_orders_per_user then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'TOO_MANY_OPEN_ORDERS', 'max', v_store.max_open_orders_per_user);
    end if;
  end if;

  -- 5. Result ------------------------------------------------------------------
  return jsonb_build_object(
    'store_id',              v_store_id,
    'address_id',            case when v_addr.id is not null then v_addr.id end,
    'payment_method',        p_payment_method,
    'lines',                 v_lines,
    'item_count',            v_item_count,
    'item_total',            v_item_total,
    'mrp_total',             v_mrp_total,
    'savings',               v_mrp_total - v_item_total + (v_delivery_full - v_delivery),
    'delivery_fee',          v_delivery,
    'delivery_fee_waived',   v_delivery_full - v_delivery,
    'small_cart_fee',        v_small,
    'small_cart_threshold',  v_store.small_cart_threshold,
    'packaging_fee',         v_packaging,
    'grand_total',           v_grand,
    'free_delivery_above',   v_store.free_delivery_above,
    'add_for_free_delivery', case
        when v_store.free_delivery_above is not null and v_item_total > 0
         and v_item_total < v_store.free_delivery_above
        then v_store.free_delivery_above - v_item_total end,
    'min_order_value',       v_store.min_order_value,
    'eta_minutes',           coalesce((v_service ->> 'eta_minutes')::int, v_store.eta_minutes),
    'payment_methods',       jsonb_build_array(
        jsonb_build_object('method', 'cod', 'allowed', v_cod_reason is null,
                           'reason', v_cod_reason, 'limit', v_store.max_cod_order_value),
        jsonb_build_object('method', 'upi', 'allowed', v_upi_enabled,
                           'reason', case when not v_upi_enabled then 'PAYMENT_METHOD_UNAVAILABLE' end)),
    'can_checkout',          jsonb_array_length(v_blockers) = 0,
    'blockers',              v_blockers,
    'quoted_at',             now()
  );
end;
$$;


-- ---------- place_order (from 20261101040000) ----------
create or replace function public.place_order(
  p_address_id      uuid,
  p_payment_method  public.payment_method,
  p_customer_note   text,
  p_idempotency_key uuid,
  p_expected_total  numeric default null     -- the grand total the user saw; mismatch → PRICE_CHANGED
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_existing   uuid;
  v_addr       public.addresses%rowtype;
  v_service    jsonb;
  v_store_id   bigint;
  v_items      jsonb;
  v_quote      jsonb;
  v_order_id   uuid;
  v_status     public.order_status;
  v_line_count int;
  v_updated    int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  if p_customer_note is not null and char_length(p_customer_note) > 300 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  -- 1. One checkout at a time per user (covers double-taps and two devices).
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || v_uid::text, 0));

  -- 2. Idempotent replay: same key → same order, no new work.
  select o.id into v_existing
  from public.orders o
  where o.user_id = v_uid and o.idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return private.order_summary(v_existing) || jsonb_build_object('replayed', true);
  end if;

  -- 3. Maintenance switch (app_config, Phase 9.9) and rate limits:
  --    5 orders per 10 minutes and 20 per day per user. Replays above don't count.
  if coalesce((select (c.value ->> 'enabled')::boolean from public.app_config c where c.key = 'maintenance'), false) then
    raise exception 'MAINTENANCE' using errcode = 'P0001';
  end if;
  perform public.check_rate_limit('place_order:' || v_uid::text, 5, interval '10 minutes');
  perform public.check_rate_limit('place_order_day:' || v_uid::text, 20, interval '1 day');

  -- 4. Resolve the store from the address (the quote re-checks and reports errors).
  select * into v_addr
  from public.addresses a
  where a.id = p_address_id and a.user_id = v_uid and a.deleted_at is null;

  if found then
    v_service := private.serviceability_for_address(v_addr.location, v_addr.pincode);
    v_store_id := (v_service ->> 'store_id')::bigint;
  end if;

  -- 5. Lock the stock rows for everything in the cart, in a fixed order
  --    (variant_id) so two orders never deadlock on each other.
  if v_store_id is not null then
    perform 1
    from public.inventory i
    where i.store_id = v_store_id
      and i.variant_id in (select c.variant_id from public.cart_items c where c.user_id = v_uid)
    order by i.variant_id
    for update;
  end if;

  -- 6. Quote with the locks held: stock and prices can't change under us now.
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', c.variant_id, 'quantity', c.quantity, 'price_at_add', c.price_at_add)), '[]'::jsonb)
    into v_items
  from public.cart_items c
  where c.user_id = v_uid;

  v_quote := private._quote(v_items, v_uid, p_address_id, p_payment_method);

  if not (v_quote ->> 'can_checkout')::boolean then
    raise exception '%', v_quote -> 'blockers' -> 0 ->> 'code'
      using errcode = 'P0001', detail = v_quote::text;
  end if;

  if p_expected_total is not null and (v_quote ->> 'grand_total')::numeric <> p_expected_total then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001', detail = v_quote::text;
  end if;

  -- 7. Write the order.
  insert into public.orders (
    order_number, user_id, store_id, address_id, address_snapshot,
    status, payment_method, payment_status,
    item_total, mrp_total, delivery_fee, small_cart_fee, packaging_fee, grand_total,
    customer_note, idempotency_key, placed_at
  ) values (
    private.next_order_number(), v_uid, v_store_id, v_addr.id, private.address_snapshot(v_addr),
    'placed', p_payment_method, 'pending',
    (v_quote ->> 'item_total')::numeric,
    (v_quote ->> 'mrp_total')::numeric,
    (v_quote ->> 'delivery_fee')::numeric,
    (v_quote ->> 'small_cart_fee')::numeric,
    (v_quote ->> 'packaging_fee')::numeric,
    (v_quote ->> 'grand_total')::numeric,
    nullif(btrim(p_customer_note), ''), p_idempotency_key, now()
  )
  returning id, status into v_order_id, v_status;     -- Phase 10 makes UPI orders start as awaiting_payment

  insert into public.order_items (
    order_id, variant_id, product_id, name_snapshot, variant_label_snapshot, image_path,
    mrp, price, gst_rate, hsn_code, quantity, line_total
  )
  select v_order_id, v.id, p.id, p.name, v.label, l ->> 'image_path',
         v.mrp, v.price, coalesce(p.gst_rate, 0), p.hsn_code,
         (l ->> 'billable_quantity')::int,
         v.price * (l ->> 'billable_quantity')::int
  from jsonb_array_elements(v_quote -> 'lines') l
  join public.product_variants v on v.id = (l ->> 'variant_id')::bigint
  join public.products p on p.id = v.product_id
  where (l ->> 'billable_quantity')::int > 0;

  get diagnostics v_line_count = row_count;

  -- 8. Take the stock. The check constraint (stock >= 0) is the last line of defence.
  update public.inventory i
     set stock = i.stock - oi.quantity,
         updated_at = now()
    from public.order_items oi
   where oi.order_id = v_order_id
     and i.store_id = v_store_id
     and i.variant_id = oi.variant_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_line_count then
    raise exception 'STOCK_CHANGED' using errcode = 'P0001';     -- a variant had no inventory row
  end if;

  insert into public.inventory_movements (store_id, variant_id, delta, reason, order_id, actor_id)
  select v_store_id, oi.variant_id, -oi.quantity, 'order', v_order_id, v_uid
  from public.order_items oi
  where oi.order_id = v_order_id;

  insert into public.order_status_events (order_id, status, actor_id)
  values (v_order_id, v_status, v_uid);

  -- 9. Empty the cart.
  delete from public.cart_items c where c.user_id = v_uid;

  return private.order_summary(v_order_id) || jsonb_build_object('replayed', false);
end;
$$;


-- Recompute the flag for addresses already saved.
update public.addresses set updated_at = updated_at where deleted_at is null;
