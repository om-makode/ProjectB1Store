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
