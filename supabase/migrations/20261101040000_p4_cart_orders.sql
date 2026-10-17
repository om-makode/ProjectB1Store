-- ============================================================================
-- 0400_cart_orders.sql
-- Cart, orders, order items, status events, inventory movements,
-- quote + place_order RPCs.
-- ============================================================================

-- Uses: the `private` schema and check_rate_limit() (Phase 0),
-- public.default_store_id() (Phase 1), serviceability helpers (Phase 3).

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

create table public.cart_items (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  variant_id    bigint not null references public.product_variants(id) on delete cascade,
  quantity      int not null check (quantity between 1 and 50),
  price_at_add  numeric(10,2) not null,     -- price the customer last saw; drives "price changed"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, variant_id)
);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

alter table public.cart_items enable row level security;

create policy "cart: read own"   on public.cart_items for select to authenticated using (user_id = (select auth.uid()));
create policy "cart: delete own" on public.cart_items for delete to authenticated using (user_id = (select auth.uid()));
-- Inserts/updates go through set_cart_quantity() / merge_guest_cart() so that
-- quantities are clamped and price_at_add is set by the server.
revoke insert, update on public.cart_items from anon, authenticated;
revoke all on public.cart_items from anon;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table private.order_counters (
  day   date primary key,
  last  int not null
);

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_number         text not null unique,                       -- NK-261016-0042
  user_id              uuid references public.profiles(id) on delete set null,   -- null after account deletion
  store_id             bigint not null references public.stores(id),
  address_id           uuid references public.addresses(id) on delete set null,
  address_snapshot     jsonb not null,                              -- address exactly as it was at checkout
  status               public.order_status not null default 'placed',
  payment_method       public.payment_method not null default 'cod',
  payment_status       public.payment_status not null default 'pending',
  item_total           numeric(10,2) not null check (item_total >= 0),
  mrp_total            numeric(10,2) not null check (mrp_total >= item_total),
  delivery_fee         numeric(10,2) not null default 0 check (delivery_fee >= 0),
  small_cart_fee       numeric(10,2) not null default 0 check (small_cart_fee >= 0),
  packaging_fee        numeric(10,2) not null default 0 check (packaging_fee >= 0),
  grand_total          numeric(10,2) not null,
  customer_note        text check (customer_note is null or char_length(customer_note) <= 300),
  staff_note           text,
  cancel_reason        text,
  cancelled_by         public.cancel_actor,
  idempotency_key      uuid not null,
  placed_at            timestamptz not null default now(),
  confirmed_at         timestamptz,
  packed_at            timestamptz,
  out_for_delivery_at  timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint orders_idempotency_unique unique (user_id, idempotency_key),
  constraint orders_grand_total_matches
    check (grand_total = item_total + delivery_fee + small_cart_fee + packaging_fee)
);

comment on column public.orders.grand_total is
  'Always item_total + fees. Any function that changes item_total (e.g. Phase 6 item unavailable) must recompute fees and grand_total in the same UPDATE.';

create index orders_user_placed_idx   on public.orders (user_id, placed_at desc);
create index orders_store_status_idx  on public.orders (store_id, status, placed_at desc);
create index orders_open_by_user_idx  on public.orders (user_id) where status not in ('delivered', 'cancelled');

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id                      bigint generated always as identity primary key,
  order_id                uuid not null references public.orders(id) on delete cascade,
  variant_id              bigint references public.product_variants(id) on delete set null,
  product_id              bigint references public.products(id) on delete set null,
  name_snapshot           jsonb not null,           -- {en,mr,hi} product name at purchase
  variant_label_snapshot  jsonb not null,           -- {en,mr,hi} "500 g"
  image_path              text,                     -- catalog thumb path at purchase
  mrp                     numeric(10,2) not null check (mrp >= 0),
  price                   numeric(10,2) not null check (price >= 0 and price <= mrp),
  gst_rate                numeric(4,2) not null default 0,
  hsn_code                text,
  quantity                int not null check (quantity > 0),
  line_total              numeric(10,2) not null check (line_total = price * quantity),
  status                  public.order_item_status not null default 'active',
  picked                  boolean not null default false,
  created_at              timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id);

create table public.order_status_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      public.order_status not null,
  note        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index order_status_events_order_idx on public.order_status_events (order_id, created_at);

create table public.inventory_movements (
  id          bigint generated always as identity primary key,
  store_id    bigint not null references public.stores(id),
  variant_id  bigint not null references public.product_variants(id) on delete cascade,
  delta       int not null check (delta <> 0),
  reason      public.stock_reason not null,
  order_id    uuid references public.orders(id) on delete set null,
  note        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index inventory_movements_variant_idx on public.inventory_movements (store_id, variant_id, created_at desc);
create index inventory_movements_order_idx   on public.inventory_movements (order_id);

-- ---------------------------------------------------------------------------
-- RLS: customers read their own; nobody writes directly.
-- (Phase 6 adds staff read/update policies and RPCs.)
-- ---------------------------------------------------------------------------

alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.order_status_events enable row level security;
alter table public.inventory_movements enable row level security;
alter table private.order_counters     enable row level security;

create policy "orders: read own" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "order_items: read own" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

create policy "order_status_events: read own" on public.order_status_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- inventory_movements: no customer policy at all (staff policy in Phase 6).

revoke insert, update, delete on public.orders, public.order_items,
  public.order_status_events, public.inventory_movements from anon, authenticated;
revoke all on public.orders, public.order_items, public.order_status_events,
  public.inventory_movements from anon;

-- ---------------------------------------------------------------------------
-- Order number: NK-YYMMDD-#### (counter resets daily, IST)
-- ---------------------------------------------------------------------------

create or replace function private.next_order_number()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_n   int;
begin
  insert into private.order_counters as c (day, last)
  values (v_day, 1)
  on conflict (day) do update set last = c.last + 1
  returning c.last into v_n;

  return 'NK-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
end;
$$;

-- Address as it was at checkout (orders never change when the address is edited later)
create or replace function private.address_snapshot(a public.addresses)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'label', a.label, 'receiver_name', a.receiver_name, 'receiver_phone', a.receiver_phone,
    'house', a.house, 'area', a.area, 'landmark', a.landmark, 'city', a.city,
    'pincode', a.pincode, 'latitude', a.latitude, 'longitude', a.longitude
  );
$$;

-- ---------------------------------------------------------------------------
-- set_cart_quantity: the ONLY way a logged-in app changes a cart line.
-- quantity <= 0 removes the line. Clamps to max_per_order, 50 and live stock.
-- ---------------------------------------------------------------------------

create or replace function public.set_cart_quantity(p_variant_id bigint, p_quantity int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_price    numeric(10,2);
  v_max      int;
  v_stock    int;
  v_qty      int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    delete from public.cart_items c where c.user_id = v_uid and c.variant_id = p_variant_id;
    return jsonb_build_object('variant_id', p_variant_id, 'quantity', 0);
  end if;

  select v.price, v.max_per_order,
         case when v.is_active and p.is_active and coalesce(i.is_available, false)
              then coalesce(i.stock, 0) else 0 end
    into v_price, v_max, v_stock
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.inventory i on i.variant_id = v.id and i.store_id = public.default_store_id()
  where v.id = p_variant_id;

  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_stock <= 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001';
  end if;

  v_qty := least(p_quantity, coalesce(v_max, 10), 50, v_stock);

  insert into public.cart_items as c (user_id, variant_id, quantity, price_at_add)
  values (v_uid, p_variant_id, v_qty, v_price)
  on conflict (user_id, variant_id)
  do update set quantity = excluded.quantity;        -- keep the old price_at_add on purpose

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'quantity', v_qty,
    'requested', p_quantity,
    'clamped', v_qty < p_quantity,
    'clamp_reason', case
      when v_qty < p_quantity and v_qty = v_stock then 'stock'
      when v_qty < p_quantity then 'max_per_order'
    end,
    'stock_left', v_stock,
    'max_per_order', v_max
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_guest_cart: items = [{variant_id, quantity}], called once after login.
-- Takes the larger quantity per variant (never doubles), ignores unknown or
-- inactive variants, clamps to limits. Stock is NOT checked here; the quote
-- flags it.
-- ---------------------------------------------------------------------------

create or replace function public.merge_guest_cart(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;

  insert into public.cart_items as c (user_id, variant_id, quantity, price_at_add)
  select v_uid, v.id, least(r.qty, coalesce(v.max_per_order, 10), 50), v.price
  from (
    select (e ->> 'variant_id')::bigint as variant_id, max((e ->> 'quantity')::int) as qty
    from jsonb_array_elements(p_items) e
    where (e ->> 'variant_id') ~ '^[0-9]+$' and (e ->> 'quantity') ~ '^[0-9]+$'
    group by 1
  ) r
  join public.product_variants v on v.id = r.variant_id and v.is_active
  join public.products p on p.id = v.product_id and p.is_active
  where r.qty > 0
  on conflict (user_id, variant_id)
  do update set quantity = greatest(c.quantity, excluded.quantity);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- fix_cart: one tap "Update cart" after a quote flagged problems.
-- Removes unavailable lines, lowers quantities to what can be sold, and
-- accepts current prices.
-- ---------------------------------------------------------------------------

create or replace function public.fix_cart()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  for r in
    select c.variant_id, v.price,
           least(c.quantity, coalesce(v.max_per_order, 10), 50,
                 case when v.is_active and p.is_active and coalesce(i.is_available, false)
                      then coalesce(i.stock, 0) else 0 end) as allowed
    from public.cart_items c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    left join public.inventory i on i.variant_id = c.variant_id and i.store_id = public.default_store_id()
    where c.user_id = v_uid
  loop
    if r.allowed <= 0 then
      delete from public.cart_items where user_id = v_uid and variant_id = r.variant_id;
    else
      update public.cart_items
         set quantity = r.allowed, price_at_add = r.price
       where user_id = v_uid and variant_id = r.variant_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.set_cart_quantity(bigint, int), public.merge_guest_cart(jsonb), public.fix_cart() from public, anon;
grant execute on function public.set_cart_quantity(bigint, int), public.merge_guest_cart(jsonb), public.fix_cart() to authenticated;

-- ---------------------------------------------------------------------------
-- Live cart across devices: private Realtime Broadcast on topic cart:<uid>.
-- (Broadcast instead of postgres_changes because DELETE events from
-- postgres_changes are not filtered by RLS and would reach every subscriber.)
-- ---------------------------------------------------------------------------

create or replace function private.broadcast_cart_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_variant bigint;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id; v_variant := old.variant_id;
  else
    v_user := new.user_id; v_variant := new.variant_id;
  end if;

  perform realtime.send(
    jsonb_build_object('op', tg_op, 'variant_id', v_variant),
    'changed',
    'cart:' || v_user::text,
    true                                   -- private channel: needs the policy below
  );
  return null;
end;
$$;

create trigger cart_items_broadcast
  after insert or update or delete on public.cart_items
  for each row execute function private.broadcast_cart_change();

create policy "realtime: own cart topic"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'cart:' || (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- private._quote: pure pricing + validation. No writes.
--   p_items: [{variant_id, quantity, price_at_add?}]
--   p_user_id: null for guests
-- Returns jsonb (shape documented below).
-- ---------------------------------------------------------------------------

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
      v_service := private.serviceability_for_point(v_addr.location);
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

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create or replace function public.get_cart_quote(
  p_address_id     uuid default null,
  p_payment_method public.payment_method default 'cod'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', c.variant_id, 'quantity', c.quantity, 'price_at_add', c.price_at_add)), '[]'::jsonb)
    into v_items
  from public.cart_items c
  where c.user_id = v_uid;

  return private._quote(v_items, v_uid, p_address_id, p_payment_method);
end;
$$;

-- Guests: prices the phone's cart. Same rules, no user checks.
create or replace function public.quote_guest_cart(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;
  return private._quote(coalesce(p_items, '[]'::jsonb), null, null, 'cod');
end;
$$;

revoke all on function public.get_cart_quote(uuid, public.payment_method) from public, anon;
grant execute on function public.get_cart_quote(uuid, public.payment_method) to authenticated;
revoke all on function public.quote_guest_cart(jsonb) from public;
grant execute on function public.quote_guest_cart(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small summary returned to the app (and on idempotent replays)
-- ---------------------------------------------------------------------------

create or replace function private.order_summary(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id',       o.id,
    'order_number',   o.order_number,
    'status',         o.status,
    'payment_method', o.payment_method,
    'grand_total',    o.grand_total,
    'item_count',     (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = o.id),
    'eta_minutes',    s.eta_minutes,
    'placed_at',      o.placed_at
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- place_order
-- Errors are raised with message = a code from section 4.8 and, where useful,
-- detail = the fresh quote as JSON text (the app shows it without a refetch).
-- ---------------------------------------------------------------------------

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
    v_service := private.serviceability_for_point(v_addr.location);
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

revoke all on function public.place_order(uuid, public.payment_method, text, uuid, numeric) from public, anon;
grant execute on function public.place_order(uuid, public.payment_method, text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Replaces the Phase 3 version: keep orders (tax records), remove the person.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.orders o
    where o.user_id = v_uid and o.status not in ('delivered', 'cancelled')
  ) then
    raise exception 'ACTIVE_ORDERS_EXIST' using errcode = 'P0001';
  end if;

  update public.orders o
     set address_snapshot = (o.address_snapshot - 'receiver_name' - 'receiver_phone' - 'house'
                             - 'landmark' - 'latitude' - 'longitude')
                            || jsonb_build_object('receiver_name', 'Deleted user'),
         customer_note = null
   where o.user_id = v_uid;

  delete from public.cart_items where user_id = v_uid;
  delete from public.addresses  where user_id = v_uid;   -- orders.address_id → null

  delete from auth.users where id = v_uid;                -- profiles cascade; orders.user_id → null
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
