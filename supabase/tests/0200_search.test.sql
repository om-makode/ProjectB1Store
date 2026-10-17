begin;
select plan(9);
select ok(public.search_products('doodh')->'items' @> '[{"slug":"amul-taaza-toned-milk"}]', 'Latin synonym');
select ok(public.search_products('दूध')->'items'   @> '[{"slug":"amul-taaza-toned-milk"}]', 'Devanagari');
select ok(public.search_products('tamatr')->'items' @> '[{"slug":"tomato-local"}]',        'typo');
select ok(public.search_products('amul')->'items'   @> '[{"slug":"amul-taaza-toned-milk"}]', 'brand');
select is(jsonb_array_length(public.search_products('x')->'items'), 0, 'too short → empty');
select ok(public.search_products('milk')->'categories' @> '[{"slug":"milk"}]', 'category chip');

-- logging + RLS
select lives_ok($$ select public.log_search('zzqqxx', 'en', 0) $$, 'log works');
set local role anon;
select is((select count(*)::int from public.search_queries), 0, 'anon cannot read search log');
reset role;

-- restock trigger marks alerts
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 't@example.com');
insert into public.stock_alerts (user_id, variant_id)
  values ('00000000-0000-0000-0000-000000000001', (select id from public.product_variants where sku = 'AASH-ATTA-10'));
update public.inventory set stock = 10 where variant_id = (select id from public.product_variants where sku = 'AASH-ATTA-10');
select isnt((select triggered_at from public.stock_alerts limit 1), null, 'restock sets triggered_at');
select * from finish();
rollback;
