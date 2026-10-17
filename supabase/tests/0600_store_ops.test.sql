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
