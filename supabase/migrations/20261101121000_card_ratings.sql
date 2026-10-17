-- =====================================================================
-- Product cards carry the rating (stars on cards).
--
-- catalog_product_cards() is copied from 20261101010000_p1_catalog.sql (the only
-- definition) with 'rating_avg' and 'rating_count' added (columns from p8).
-- Every list built on it gets them: list_products, get_home rails, search_products,
-- related_products, list_collection_products, wishlist cards.
-- buy_again() returns its own table shape and is unchanged.
-- =====================================================================

create or replace function public.catalog_product_cards(p_store_id bigint, p_product_ids bigint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(c.card order by u.ord), '[]'::jsonb)
  from unnest(p_product_ids) with ordinality as u(product_id, ord)
  join lateral (
    select jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'brand', b.name,
      'is_veg', p.is_veg, 'category_id', p.category_id, 'attributes', p.attributes,
      'rating_avg', p.rating_avg, 'rating_count', p.rating_count,
      'thumb_path', (
        select coalesce(pi.thumb_path, pi.path) from public.product_images pi
         where pi.product_id = p.id and (pi.variant_id is null or pi.variant_id = o.variant_id)
         order by (pi.variant_id = o.variant_id) desc nulls last, pi.sort_order, pi.id
         limit 1),
      'variant_count', (select count(*) from public.product_variants v2
                         where v2.product_id = p.id and v2.is_active),
      'variant', jsonb_build_object(
        'id', o.variant_id, 'label', o.label, 'mrp', o.mrp, 'price', o.price,
        'discount_pct', o.discount_pct, 'available_qty', o.available_qty,
        'low_stock', o.low_stock, 'max_per_order', o.max_per_order)
    ) as card
    from public.products p
    left join public.brands b on b.id = p.brand_id
    join lateral (
      select * from public.v_variant_offers vo
       where vo.product_id = p.id and vo.store_id = p_store_id and vo.is_active
       order by (vo.available_qty > 0) desc, vo.is_default desc, vo.sort_order, vo.variant_id
       limit 1
    ) o on true
    where p.id = u.product_id and p.is_active
  ) c on true
$$;
