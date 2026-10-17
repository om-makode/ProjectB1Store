begin;
select plan(8);
select has_table('public', 'inventory', 'inventory exists');
select is((select count(*)::int from public.categories where parent_id is null), 8, '8 parent categories');
-- default variant prefers in-stock: atta 5 kg (in stock) over 10 kg (0)
select is((public.catalog_product_cards(public.default_store_id(),
          array[(select id from public.products where slug='aashirvaad-whole-wheat-atta')])->0->'variant'->>'label')::jsonb->>'en',
          '5 kg', 'default variant is the in-stock one');
-- out of stock sorts last
update public.inventory set stock = 0 where variant_id in
  (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'parle-g-gold');
select is((select t.x->>'slug'
             from jsonb_array_elements(public.list_products(
                    (select id from public.categories where slug='snacks-biscuits'))->'items')
                  with ordinality as t(x, n)
            order by t.n desc limit 1), 'parle-g-gold', 'out-of-stock is last');
-- filters
select ok(public.product_matches_filters('{"organic":true}', null, true, 50, 3, '{"attrs":{"organic":true}}'), 'bool attr filter');
select ok(not public.product_matches_filters('{}', null, true, 50, 3, '{"attrs":{"organic":true}}'), 'missing attr fails');
select ok(not public.product_matches_filters('{}', null, true, 100, 3, '{"price_max":100}'), 'price_max exclusive');
-- RLS
set local role anon;
select throws_ok($$ insert into public.brands (slug, name) values ('x', '{"en":"x"}') $$, '42501', null, 'anon cannot write');
select * from finish();
rollback;
