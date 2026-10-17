begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create or replace function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'a4@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'b4@test.local');

-- Seed store: always open, 4 km radius, simple fees.
-- (opening_hours format from Phase 1: per weekday [{open, close}] in IST.)
update public.stores set
  location = extensions.st_setsrid(extensions.st_makepoint(77.75, 20.93), 4326)::extensions.geography,
  service_radius_km = 4, service_area = null,
  is_accepting_orders = true,
  opening_hours = '{"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],
                    "wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],
                    "fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}],
                    "sun":[{"open":"00:00","close":"23:59"}]}'::jsonb,
  min_order_value = 50, delivery_fee = 20, free_delivery_above = 199,
  small_cart_threshold = 99, small_cart_fee = 10, packaging_fee = 0,
  max_cod_order_value = 2000, max_open_orders_per_user = 3
where id = (select min(id) from public.stores);

-- A product with one variant (₹60, MRP ₹70), stock 1.
-- (Products must sit in a sub-category: Phase 1 rule.)
with c as (
  insert into public.categories (slug, name) values ('t-dairy', '{"en":"T Dairy"}') returning id
), sc as (
  insert into public.categories (parent_id, slug, name) select id, 't-milk-sub', '{"en":"T Milk"}' from c returning id
), p as (
  insert into public.products (category_id, slug, name, gst_rate, is_active)
  select id, 't-milk', '{"en":"T Milk"}', 5, true from sc returning id
), v as (
  insert into public.product_variants (product_id, sku, label, net_quantity, unit, mrp, price, max_per_order, is_active)
  select id, 'T-MILK-1', '{"en":"1 l"}', 1, 'l', 70, 60, 5, true from p returning id
)
insert into public.inventory (store_id, variant_id, stock, is_available)
select (select min(id) from public.stores), id, 1, true from v;

create temp table t_ids as
select (select id from public.product_variants where sku = 'T-MILK-1') as variant_id,
       (select min(id) from public.stores) as store_id;
grant select on t_ids to authenticated;

-- Addresses at the store location.
insert into public.addresses (user_id, receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
values ('00000000-0000-0000-0000-0000000000a4', 'Asha', '9876543210', '1', 'Area', 'City', '444601', 20.93, 77.75),
       ('00000000-0000-0000-0000-0000000000b4', 'Bala', '9876543211', '2', 'Area', 'City', '444601', 20.93, 77.75);

create temp table t_addr as
select user_id, id from public.addresses where user_id in
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b4');
grant select on t_addr to authenticated;

-- ---------------------------------------------------------------- as A
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');

-- 1. empty cart
select is(public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) -> 'blockers' -> 0 ->> 'code',
          'CART_EMPTY', 'empty cart is blocked');

-- 2. clamp to stock
select is((public.set_cart_quantity((select variant_id from t_ids), 4) ->> 'quantity')::int, 1, 'quantity clamped to stock');

-- 3–5. fees: ₹60 < 99 → small cart fee 10; < 199 → delivery 20; total 90
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'small_cart_fee')::numeric, 10::numeric, 'small cart fee');
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'grand_total')::numeric, 90::numeric, 'grand total = 60 + 20 + 10');
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'add_for_free_delivery')::numeric, 139::numeric, 'free delivery hint');

-- 6. min order: raise min to 100 → BELOW_MIN_ORDER
reset role; select pg_temp.as_postgres();
update public.stores set min_order_value = 100 where id = (select store_id from t_ids);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'BELOW_MIN_ORDER', 'below minimum order is rejected');
reset role; select pg_temp.as_postgres();
update public.stores set min_order_value = 50 where id = (select store_id from t_ids);

-- 7. closed store → STORE_CLOSED
update public.stores set is_accepting_orders = false where id = (select store_id from t_ids);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'STORE_CLOSED', 'closed store is rejected');
reset role; select pg_temp.as_postgres();
update public.stores set is_accepting_orders = true where id = (select store_id from t_ids);

-- 8. price changed → PRICE_CHANGED when expected total differs
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid(), 85) $$,
  'P0001', 'PRICE_CHANGED', 'expected total mismatch is rejected');

-- 9–12. success + idempotent replay
create temp table t_key as select gen_random_uuid() as k;
select is(
  (public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', 'Call first', (select k from t_key), 90) ->> 'replayed')::boolean,
  false, 'order placed');
select is(
  (public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', 'Call first', (select k from t_key), 90) ->> 'replayed')::boolean,
  true, 'same key replays');
select is((select count(*)::int from public.orders), 1, 'exactly one order for A');
select is((select count(*)::int from public.cart_items), 0, 'cart cleared');
select matches((select order_number from public.orders limit 1), '^NK-[0-9]{6}-[0-9]{4,}$', 'order number format');

-- 13. stock taken and logged
reset role; select pg_temp.as_postgres();
select is((select stock from public.inventory where variant_id = (select variant_id from t_ids)), 0, 'stock decremented to 0');
select is((select delta from public.inventory_movements where variant_id = (select variant_id from t_ids) and reason = 'order'), -1, 'movement logged');

-- 14–15. B wanted the same last unit: the cart now needs review
insert into public.cart_items (user_id, variant_id, quantity, price_at_add)
values ('00000000-0000-0000-0000-0000000000b4', (select variant_id from t_ids), 1, 60);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000b4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'CART_NEEDS_REVIEW', 'second buyer of the last unit is rejected');

-- 16. RLS: B can't see A's order
select is((select count(*)::int from public.orders), 0, 'B sees no orders of A');

-- 17. No direct writes
select throws_ok(
  $$ insert into public.orders (order_number, store_id, address_snapshot, item_total, mrp_total, grand_total, idempotency_key)
     values ('X', 1, '{}', 0, 0, 0, gen_random_uuid()) $$,
  '42501', null, 'customers cannot insert orders directly');

select * from finish();
rollback;
