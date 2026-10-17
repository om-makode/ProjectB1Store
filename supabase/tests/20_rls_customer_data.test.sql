-- supabase/tests/20_rls_customer_data.test.sql
begin;
-- helpers come from 000_setup_helpers.test.sql
select plan(9);

-- arrange (as postgres): two customers, one order for Asha
select tests.make_user('asha@test.in')  as asha \gset
select tests.make_user('ravi@test.in')  as ravi \gset
-- (insert an address + an order for :'asha' via place_order, as in 30_place_order)
select tests.as_user(:'asha');
select public.place_order(
  (select id from public.addresses where user_id = :'asha' limit 1), 'cod', null, gen_random_uuid()
) ;

-- Ravi can't see Asha's order, items, address or notifications
select tests.as_user(:'ravi');
select is((select count(*) from public.orders),        0::bigint, 'ravi sees no orders of asha');
select is((select count(*) from public.order_items),   0::bigint, 'ravi sees no order items of asha');
select is((select count(*) from public.addresses),     0::bigint, 'ravi sees no addresses of asha');
select is((select count(*) from public.notifications), 0::bigint, 'ravi sees no notifications of asha');

-- Asha can't write money/stock tables directly
select tests.as_user(:'asha');
select throws_ok($$ insert into public.orders (user_id, store_id, status) values (auth.uid(), 1, 'placed') $$,
  '42501', null, 'customer cannot insert an order directly');
select throws_ok($$ update public.product_variants set price = 1 where id = 1 $$,
  null, null, 'customer cannot change a price');   -- 0 rows or 42501, assert below
select is((select price from public.product_variants where id = 1) <> 1, true, 'price unchanged');
select throws_ok($$ update public.profiles set role = 'admin' where id = auth.uid() $$,
  null, null, 'customer cannot promote self');

-- Guest sees catalog but no customer data
select tests.as_anon();
select is((select count(*) from public.orders), 0::bigint, 'anon sees no orders');

select * from finish();
rollback;
