-- NearKart smoke scenario. Each "-- @step" runs separately (own transaction).
-- Roles: customer A = 3333…, staff = 2222…, admin = 1111…, customer B = 4444… (created below).
-- Values shared between steps live in public._smoke (test-only table).

-- @step setup: store always open, helper table, customer B
update public.stores set opening_hours = '{}'::jsonb;
create table public._smoke (k text primary key, v text);
grant all on public._smoke to anon, authenticated, service_role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', 'b@nearkart.test', '{"full_name":"Customer B"}');
select count(*) = 39 as ok from public.products;

-- @step customer A: add a serviceable address (RLS insert)
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
values ('Test Customer', '9876543210', 'Flat 2, Sai Apartment', 'Rajapeth', 'Amravati', '444601', 20.9400, 77.7550)
returning is_serviceable and is_default as ok;
insert into public._smoke select 'addr_a', id::text from public.addresses limit 1;

-- @step serviceability: far point is not serviceable
select set_config('request.jwt.claims', '', false);
set role anon;
select (public.check_serviceability(19.0760, 72.8777) ->> 'serviceable')::boolean = false as ok;

-- @step guest: quote a phone cart (anon)
set role anon;
select (q ->> 'item_total')::numeric = 56 and (q -> 'blockers') @> '[{"code":"LOGIN_REQUIRED"}]' as ok
from (select public.quote_guest_cart(jsonb_build_array(jsonb_build_object(
        'variant_id', (select id from public.product_variants where sku = 'AMUL-TAAZA-500'), 'quantity', 2))) q) x;

-- @step customer A: fill cart via RPCs, quote = 2×28 + 249 + 22 = 327, free delivery
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'AMUL-TAAZA-500'), 2);
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-5'), 1);
select public.set_cart_quantity((select id from public.product_variants where sku = 'TOM-500'), 1);
select (q ->> 'can_checkout')::boolean and (q ->> 'grand_total')::numeric = 327
       and (q ->> 'delivery_fee')::numeric = 0
       and q -> 'payment_methods' @> '[{"method":"cod","allowed":true},{"method":"upi","allowed":false}]' as ok
from (select public.get_cart_quote((select v::uuid from public._smoke where k = 'addr_a'), 'cod') q) x;

-- @step customer A: out-of-stock item cannot be added
-- @expect-error OUT_OF_STOCK
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-10'), 1);

-- @step customer A: wrong expected total → PRICE_CHANGED
-- @expect-error PRICE_CHANGED
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                          'aaaaaaaa-0000-0000-0000-000000000001', 300);

-- @step customer A: place COD order
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
insert into public._smoke
select 'order1', (public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', 'Ring the bell',
                                     'aaaaaaaa-0000-0000-0000-000000000001', 327) ->> 'order_id');
select (select count(*) from public.cart_items) = 0 as ok;

-- @step customer A: idempotent replay returns the same order, no new order
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select (r ->> 'replayed')::boolean and r ->> 'order_id' = (select v from public._smoke where k = 'order1')
       and (select count(*) from public.orders) = 1 as ok
from (select public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                                'aaaaaaaa-0000-0000-0000-000000000001', 327) r) x;

-- @step db: stock decremented, movements, status event, notifications (customer + staff)
select (select stock from public.inventory i join public.product_variants v on v.id = i.variant_id
         where v.sku = 'AASH-ATTA-5') =
       (select sum(delta) from public.inventory_movements m join public.product_variants v on v.id = m.variant_id
         where v.sku = 'AASH-ATTA-5')
   and (select count(*) from public.inventory_movements where reason = 'order') = 3
   and (select count(*) from public.order_status_events) = 1
   and (select count(*) from public.notifications where type = 'order_status'
          and user_id = '33333333-3333-3333-3333-333333333333') = 1
   and (select count(*) from public.notifications where type = 'new_order') = 2   -- admin + staff
   and (select order_number ~ '^NK-\d{6}-\d{4}$' from public.orders limit 1) as ok;

-- @step customer B cannot see A's order or address (RLS)
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
set role authenticated;
select (select count(*) from public.orders) = 0 and (select count(*) from public.addresses) = 0
   and (select count(*) from public.order_items) = 0 as ok;

-- @step customer B cannot cancel A's order
-- @expect-error ORDER_NOT_FOUND
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
set role authenticated;
select public.cancel_order((select v::uuid from public._smoke where k = 'order1'), 'test');

-- @step anon cannot write orders or read profiles
set role anon;
select (select count(*) from public.profiles) = 0 as ok;

-- @step anon insert into orders is denied
-- @expect-error permission denied
set role anon;
insert into public.orders (order_number, store_id, address_snapshot, item_total, mrp_total, grand_total, idempotency_key)
values ('X', 1, '{}', 0, 0, 0, gen_random_uuid());

-- @step customer cannot promote themselves to admin
-- @expect-error protected profile fields
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';

-- @step staff: board shows the order; accept it
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select (select count(*) from public.staff_list_board(public.default_store_id())) = 1
   and (public.staff_set_order_status((select v::uuid from public._smoke where k = 'order1'), 'confirmed')).status = 'confirmed' as ok;

-- @step staff: first pick moves to packing; tomato unavailable (customer request) keeps totals valid
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select (public.staff_toggle_picked((select oi.id from public.order_items oi join public.product_variants v on v.id = oi.variant_id
          where v.sku = 'AASH-ATTA-5'), true)).status = 'packing' as ok;
select o.item_total = 305 and o.grand_total = 305
       and o.grand_total = o.item_total + o.delivery_fee + o.small_cart_fee + o.packaging_fee as ok
from public.staff_mark_item_unavailable((select oi.id from public.order_items oi join public.product_variants v on v.id = oi.variant_id
          where v.sku = 'TOM-500'), 'customer_request') o;

-- @step staff: cannot pack until all picked
-- @expect-error ITEMS_NOT_PICKED
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.staff_set_order_status((select v::uuid from public._smoke where k = 'order1'), 'packed');

-- @step staff: pick the rest → packed → out_for_delivery → delivered (COD marked paid)
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.staff_toggle_picked(oi.id, true) from public.order_items oi
 where oi.order_id = (select v::uuid from public._smoke where k = 'order1') and oi.status = 'active' and not oi.picked;
select public.staff_set_order_status((select v::uuid from public._smoke where k = 'order1'), 'packed');
select public.staff_set_order_status((select v::uuid from public._smoke where k = 'order1'), 'out_for_delivery');
select o.status = 'delivered' and o.payment_status = 'paid' and o.delivered_at is not null as ok
from public.staff_set_order_status((select v::uuid from public._smoke where k = 'order1'), 'delivered') o;

-- @step db: tomato restocked by customer_request, customer saw items_changed + 6 status messages
select (select count(*) from public.inventory_movements where reason = 'item_unavailable') = 1
   and (select count(*) from public.notifications where type = 'order_items_changed') = 1
   and (select count(*) from public.notifications where type = 'order_status') = 6
   and (select count(*) from public.order_status_events) >= 6 as ok;

-- @step customer A: review a delivered product; rating aggregate updates
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select (public.submit_review((select id from public.products where slug = 'aashirvaad-whole-wheat-atta'), 5, 'Fresh atta')).rating = 5 as ok;
select (select rating_avg = 5 and rating_count = 1 from public.products where slug = 'aashirvaad-whole-wheat-atta') as ok;

-- @step customer A: cannot review a product never received
-- @expect-error only customers who received
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.submit_review((select id from public.products where slug = 'tomato-local'), 4);

-- @step customer A: buy again + reorder into cart (price_at_add set)
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select (select count(*) from public.buy_again(10)) = 2 as ok;
select jsonb_array_length(public.reorder_to_cart((select v::uuid from public._smoke where k = 'order1')) -> 'added') = 3 as ok;
select (select count(*) = 3 and bool_and(price_at_add > 0) from public.cart_items) as ok;

-- @step customer A: second order, then cancel → stock restored
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
insert into public._smoke select 'stock_before',
  (select stock from public.inventory i join public.product_variants v on v.id = i.variant_id where v.sku = 'AMUL-TAAZA-500')::text;
insert into public._smoke
select 'order2', public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                                    'aaaaaaaa-0000-0000-0000-000000000002') ->> 'order_id';
select (public.cancel_order((select v::uuid from public._smoke where k = 'order2'), 'Ordered by mistake')).status = 'cancelled' as ok;

-- @step db: cancellation restocked everything
select (select stock from public.inventory i join public.product_variants v on v.id = i.variant_id where v.sku = 'AMUL-TAAZA-500')
       = (select v::int from public._smoke where k = 'stock_before')
   and (select count(*) from public.inventory_movements where reason = 'order_cancel') = 3 as ok;

-- @step customer A: "Notify me" on out-of-stock 10 kg atta
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.toggle_stock_alert((select id from public.product_variants where sku = 'AASH-ATTA-10'), true) as ok;

-- @step staff: restock fires back-in-stock notification
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select (public.staff_adjust_stock(public.default_store_id(), (select id from public.product_variants where sku = 'AASH-ATTA-10'),
                                  10, 'restock', 'supplier')).stock = 10 as ok;

-- @step db: alert stamped and inbox row written
select (select triggered_at is not null and notified_at is not null from public.stock_alerts)
   and (select count(*) from public.notifications where type = 'back_in_stock'
          and user_id = '33333333-3333-3333-3333-333333333333') = 1 as ok;

-- @step anon: search (synonym, Devanagari, typo, brand), home, category list, product detail
set role anon;
select public.search_products('doodh') -> 'items' @> '[{"slug":"amul-taaza-toned-milk"}]'
   and public.search_products('दूध')  -> 'items' @> '[{"slug":"amul-taaza-toned-milk"}]'
   and public.search_products('tamatr') -> 'items' @> '[{"slug":"tomato-local"}]'
   and public.search_products('amul') -> 'items' @> '[{"slug":"amul-taaza-toned-milk"}]'
   and jsonb_array_length(public.search_suggestions('ami')) >= 0 as ok;

-- @step anon: home + list + product + store status
set role anon;
select jsonb_typeof(public.get_home(public.default_store_id(), 'mr')) is not null
   and jsonb_array_length(public.list_products((select id from public.categories where slug = 'dairy-bread-eggs')) -> 'items') > 0
   and public.get_product('aashirvaad-whole-wheat-atta') -> 'variants' @> '[{"label":{"en":"10 kg"}}]'
   and (public.store_status() ->> 'is_open')::boolean
   and jsonb_array_length(public.related_products((select id from public.products where slug = 'amul-taaza-toned-milk'))) >= 1 as ok;

-- @step anon: log a zero-result search (only staff can read the log)
set role anon;
select public.log_search('organic jaggery', 'en', 0);
select (select count(*) from public.search_queries) = 0 as ok;

-- @step admin: upsert a product with valid attributes
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
insert into public._smoke select 'new_prod', (public.admin_upsert_product(jsonb_build_object(
  'category_id', (select id from public.categories where slug = 'milk'),
  'name', jsonb_build_object('en', 'Organic Cow Milk', 'mr', 'सेंद्रिय गाईचे दूध', 'hi', 'जैविक गाय का दूध'),
  'attributes', jsonb_build_object('milk_type', 'cow', 'organic', true),
  'manufacturer', jsonb_build_object('name', 'Shivneri Dairy', 'address', 'Amravati 444601'),
  'country_of_origin', 'India', 'hsn_code', '0401', 'gst_rate', 0, 'is_veg', true,
  'variants', jsonb_build_array(jsonb_build_object('sku', 'ORG-COW-500', 'label', jsonb_build_object('en', '500 ml'),
     'net_quantity', 500, 'unit', 'ml', 'mrp', 45, 'price', 42, 'initial_stock', 12))
)) ->> 'product_id');
select (select count(*) from public.inventory i join public.product_variants v on v.id = i.variant_id
         where v.sku = 'ORG-COW-500' and i.stock = 12) = 1 as ok;

-- @step admin: invalid attribute value is rejected by the trigger
-- @expect-error not one of the options
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
update public.products set attributes = '{"milk_type":"camel"}' where slug = 'gokul-cow-milk';

-- @step admin: dashboard + reports readable
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
select (public.admin_dashboard_today() ->> 'orders')::int >= 1
   and (select count(*) from public.v_sales_daily) >= 1
   and (select count(*) from public.v_zero_result_searches) = 1
   and (select count(*) from public.v_ops_health) = 1 as ok;

-- @step customer: report views return no rows
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select (select count(*) from public.v_sales_daily) = 0 and (select count(*) from public.v_ops_health) = 0 as ok;

-- @step admin: promote customer B to staff (audit + notification)
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.admin_set_role('44444444-4444-4444-4444-444444444444', 'staff');
select (select role = 'staff' from public.profiles where id = '44444444-4444-4444-4444-444444444444') as ok;

-- @step auto-cancel: order not accepted in time is cancelled by the system
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'AMUL-TAAZA-500'), 2);
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-5'), 1);
insert into public._smoke
select 'order3', public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                                    'aaaaaaaa-0000-0000-0000-000000000003') ->> 'order_id';
reset role;
update public.orders set placed_at = now() - interval '30 minutes' where id = (select v::uuid from public._smoke where k = 'order3');
select public.auto_cancel_stale_orders() = 1 as ok;
select (select status = 'cancelled' and cancelled_by = 'system' from public.orders
         where id = (select v::uuid from public._smoke where k = 'order3')) as ok;

-- @step delete account blocked while an order is open
-- @expect-error ACTIVE_ORDERS_EXIST
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'PARLEG-GOLD-100'), 5);
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-5'), 1);
insert into public._smoke
select 'order4', public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                                    'aaaaaaaa-0000-0000-0000-000000000004') ->> 'order_id';
select public.delete_my_account();

-- @step UPI: enable online payments; UPI order starts awaiting_payment, hidden from board
update public.stores set upi_enabled = true;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'SAFFOLA-GOLD-1L'), 2);
insert into public._smoke
select 'order5', public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'upi', null,
                                    'aaaaaaaa-0000-0000-0000-000000000005') ->> 'order_id';
select (select status = 'awaiting_payment' and payment_expires_at > now() and grand_total = 378
          from public.orders where id = (select v::uuid from public._smoke where k = 'order5'))
   and (select status = 'awaiting_payment' from public.order_status_events
         where order_id = (select v::uuid from public._smoke where k = 'order5')) as ok;

-- @step UPI: service role records the Razorpay order and confirms the capture
set role service_role;
insert into public.payments (order_id, user_id, provider_order_id, amount)
values ((select v::uuid from public._smoke where k = 'order5'), '33333333-3333-3333-3333-333333333333', 'order_TEST5', 378);
select public.confirm_payment('order_TEST5', 'pay_TEST5', 37800, 'upi', '{}') = 'confirmed'
   and public.confirm_payment('order_TEST5', 'pay_TEST5', 37800, 'upi', '{}') = 'already_confirmed' as ok;

-- @step UPI: order placed + paid, staff alerted once, no refund queued
select (select status = 'placed' and payment_status = 'paid' and amount_paid = 378
          from public.orders where id = (select v::uuid from public._smoke where k = 'order5'))
   and (select count(*) from public.refunds) = 0
   and (select count(*) from public.notifications where type = 'new_order'
          and data ->> 'order_id' = (select v from public._smoke where k = 'order5')) = 3 as ok;   -- admin + 2 staff

-- @step UPI: customer cannot call confirm_payment
-- @expect-error permission denied
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.confirm_payment('order_TEST5', 'pay_X', 37800, 'upi', '{}');

-- @step UPI: item unavailable on paid order → partial refund; then cancel → rest refunded, never double
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.staff_set_order_status((select v::uuid from public._smoke where k = 'order5'), 'confirmed');
reset role;
-- give the order a second line so one can go unavailable
insert into public.order_items (order_id, variant_id, product_id, name_snapshot, variant_label_snapshot, mrp, price, quantity, line_total)
select (select v::uuid from public._smoke where k = 'order5'), v.id, v.product_id, p.name, v.label, v.mrp, v.price, 1, v.price
from public.product_variants v join public.products p on p.id = v.product_id where v.sku = 'TATA-SALT-1KG';
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.staff_mark_item_unavailable((select oi.id from public.order_items oi join public.product_variants v on v.id = oi.variant_id
        where oi.order_id = (select v::uuid from public._smoke where k = 'order5') and v.sku = 'SAFFOLA-GOLD-1L'), 'damaged');
reset role;
select (select count(*) = 1 and sum(amount) = 350 and min(reason) = 'item_unavailable' from public.refunds) as ok;

-- @step UPI: cancelling the shrunken paid order refunds the remaining ₹28 (total 378, never double)
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.staff_set_order_status((select v::uuid from public._smoke where k = 'order5'), 'cancelled', 'customer asked');
reset role;
select (select sum(amount) from public.refunds) = 378 and (select count(*) from public.refunds) = 2 as ok;

-- @step UPI: refund processed → payment_status refunded, customer notified
set role service_role;
update public.refunds set provider_refund_id = 'rfnd_' || reason, status = 'processing';
select public.mark_refund_result('rfnd_item_unavailable', 'processed', null);
select public.mark_refund_result('rfnd_order_cancelled', 'processed', null);
reset role;
select (select payment_status = 'refunded' and amount_refunded = 378 from public.orders
         where id = (select v::uuid from public._smoke where k = 'order5'))
   and (select count(*) from public.notifications where type = 'refund_update') >= 2 as ok;

-- @step UPI: unpaid order past its hold is cancelled and restocked; late payment refunded once
update public.stores set max_open_orders_per_user = 10;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'GOODDAY-200'), 3);
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-5'), 1);
insert into public._smoke
select 'order6', public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'upi', null,
                                    'aaaaaaaa-0000-0000-0000-000000000006') ->> 'order_id';
reset role;
update public.orders set payment_expires_at = now() - interval '10 minutes' where id = (select v::uuid from public._smoke where k = 'order6');
insert into public.payments (order_id, user_id, provider_order_id, amount)
select id, user_id, 'order_TEST6', grand_total from public.orders where id = (select v::uuid from public._smoke where k = 'order6');
select public.release_expired_payment_holds() = 1 as ok;
select (select status = 'cancelled' from public.orders where id = (select v::uuid from public._smoke where k = 'order6')) as ok;
select public.confirm_payment('order_TEST6', 'pay_TEST6',
         (select (grand_total * 100)::bigint from public.orders where id = (select v::uuid from public._smoke where k = 'order6')),
         'upi', '{}') = 'refund_late' as ok;
select (select count(*) from public.refunds where order_id = (select v::uuid from public._smoke where k = 'order6')) = 1
   and (select reason = 'late_payment' from public.refunds where order_id = (select v::uuid from public._smoke where k = 'order6')) as ok;

-- @step rate limit: 6th order attempt in the window is refused
-- @expect-error RATE_LIMITED
update public.rate_limits set hits = 5 where key like 'place_order:%';
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'LAYS-CLASSIC-52'), 9);
select public.set_cart_quantity((select id from public.product_variants where sku = 'AASH-ATTA-5'), 1);
select public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                          'aaaaaaaa-0000-0000-0000-000000000007');

-- @step store closed blocks checkout
-- @expect-error STORE_CLOSED
update public.stores set is_accepting_orders = false;
delete from public.rate_limits;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select public.set_cart_quantity((select id from public.product_variants where sku = 'TATA-SALT-1KG'), 1);
select public.place_order((select v::uuid from public._smoke where k = 'addr_a'), 'cod', null,
                          'aaaaaaaa-0000-0000-0000-000000000008');

-- @step address without GPS: saves anywhere; serviceable by pincode list
update public.stores set is_accepting_orders = true;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode)
values ('Test Customer', '9876543210', '12 MG Road', 'Camp', 'Amravati', '444602')
returning is_serviceable and location is null as ok;
insert into public._smoke select 'addr_pin', id::text from public.addresses where pincode = '444602' limit 1;

-- @step address without GPS outside the pincode list: saved, but checkout is blocked
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode)
values ('Test Customer', '9876543210', '5 Marine Drive', 'Churchgate', 'Mumbai', '400020')
returning not is_serviceable as ok;
insert into public._smoke select 'addr_far', id::text from public.addresses where pincode = '400020' limit 1;
select public.set_cart_quantity((select id from public.product_variants where sku = 'TATA-SALT-1KG'), 1);
select (q -> 'blockers') @> '[{"code":"NOT_SERVICEABLE"}]' as ok
from (select public.get_cart_quote((select v::uuid from public._smoke where k = 'addr_far')) q) x;

-- @step quote for the pincode-only address has no NOT_SERVICEABLE blocker
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false);
set role authenticated;
select not ((q -> 'blockers') @> '[{"code":"NOT_SERVICEABLE"}]') as ok
from (select public.get_cart_quote((select v::uuid from public._smoke where k = 'addr_pin')) q) x;

-- @step card ratings: reviewed atta card carries rating_avg / rating_count
set role anon;
select select_card ->> 'rating_count' = '1' and (select_card ->> 'rating_avg')::numeric = 5 as ok
from (select public.catalog_product_cards(1, array[(select id from public.products where slug = 'aashirvaad-whole-wheat-atta')]) -> 0 as select_card) x;

-- @step admin: store settings update pincodes (trim, dedupe, sort), UPI switch, payment hold
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
select (r -> 'serviceable_pincodes') = '["444601", "444602"]'::jsonb
       and (r ->> 'upi_enabled')::boolean and (r ->> 'payment_hold_minutes')::int = 20 as ok
from (select public.admin_update_store_settings(1, '{"serviceable_pincodes":[" 444602","444601","444602",""],"upi_enabled":true,"payment_hold_minutes":20}') r) x;

-- @step admin: invalid pincode is rejected
-- @expect-error pincodes must be 6 digits
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.admin_update_store_settings(1, '{"serviceable_pincodes":["044601"]}');

-- @step staff cannot change store settings
-- @expect-error forbidden
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.admin_update_store_settings(1, '{"upi_enabled":false}');
