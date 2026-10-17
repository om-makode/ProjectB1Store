-- =====================================================================
-- 0100_catalog.sql  ·  Phase 1: stores, catalog, stock
-- Requires 0000_foundation.sql (enums, set_updated_at(), is_staff(), is_admin())
-- =====================================================================

create extension if not exists postgis  with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------- helpers --------------------------------------------------

-- A localized jsonb value must be an object with a non-empty "en".
create or replace function public.is_localized(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select v is not null and jsonb_typeof(v) = 'object' and coalesce(v->>'en', '') <> ''
$$;

-- Lower-case + strip accents. The 2-argument unaccent form is needed
-- because search_path is empty inside our functions.
create or replace function public.normalize_search(v text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(v, '')))
$$;

-- ---------- stores ---------------------------------------------------

create table public.stores (
  id                       bigint generated always as identity primary key,
  name                     jsonb not null check (public.is_localized(name)),
  address                  jsonb not null check (public.is_localized(address)),
  city                     text  not null,
  location                 extensions.geography(point, 4326) not null,
  service_radius_km        numeric(5,2) not null default 3 check (service_radius_km > 0),
  service_area             extensions.geography(polygon, 4326),       -- optional; overrides radius (Phase 3)
  phone                    text not null,
  whatsapp                 text,
  gstin                    text,
  fssai_license            text,
  -- {"mon":[{"open":"07:00","close":"22:00"}], "tue":[...], ...}; '{}' = always open
  opening_hours            jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_hours) = 'object'),
  is_accepting_orders      boolean not null default true,
  busy_message             jsonb check (busy_message is null or public.is_localized(busy_message)),
  eta_minutes              int not null default 20 check (eta_minutes between 5 and 240),
  min_order_value          numeric(10,2) not null default 0    check (min_order_value >= 0),
  delivery_fee             numeric(10,2) not null default 25   check (delivery_fee >= 0),
  free_delivery_above      numeric(10,2) not null default 299  check (free_delivery_above >= 0),
  small_cart_threshold     numeric(10,2) not null default 99   check (small_cart_threshold >= 0),
  small_cart_fee           numeric(10,2) not null default 15   check (small_cart_fee >= 0),
  packaging_fee            numeric(10,2) not null default 0    check (packaging_fee >= 0),
  max_cod_order_value      numeric(10,2) not null default 3000 check (max_cod_order_value > 0),
  max_open_orders_per_user int not null default 3  check (max_open_orders_per_user > 0),
  auto_cancel_minutes      int not null default 10 check (auto_cancel_minutes between 2 and 120),
  timezone                 text not null default 'Asia/Kolkata',
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();

-- The store used when the client doesn't pass one (single-store v1).
create or replace function public.default_store_id()
returns bigint language sql stable set search_path = '' as $$
  select id from public.stores where is_active order by id limit 1
$$;

-- ---------- categories -----------------------------------------------

create table public.categories (
  id               bigint generated always as identity primary key,
  parent_id        bigint references public.categories(id) on delete restrict,
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             jsonb not null check (public.is_localized(name)),
  icon             text,
  image_path       text,
  color            text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  attribute_schema jsonb not null default '{"fields": []}'::jsonb
                   check (jsonb_typeof(attribute_schema->'fields') = 'array'),
  filters          jsonb not null default '[]'::jsonb check (jsonb_typeof(filters) = 'array'),
  schema_version   int not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create index categories_parent_idx on public.categories (parent_id, sort_order) where is_active;
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- Max 2 levels: a parent can't itself have a parent, and a category with
-- children can't be moved under another one.
create or replace function public.categories_enforce_depth()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.categories where id = new.parent_id and parent_id is not null) then
      raise exception 'Sub-categories cannot have sub-categories (max 2 levels)';
    end if;
    if exists (select 1 from public.categories where parent_id = new.id) then
      raise exception 'A category with sub-categories cannot become a sub-category';
    end if;
  end if;
  return new;
end $$;
create trigger categories_depth before insert or update of parent_id on public.categories
  for each row execute function public.categories_enforce_depth();

-- ---------- brands ---------------------------------------------------

create table public.brands (
  id         bigint generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       jsonb not null check (public.is_localized(name)),
  logo_path  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger brands_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

-- ---------- products -------------------------------------------------

create table public.products (
  id                bigint generated always as identity primary key,
  category_id       bigint not null references public.categories(id) on delete restrict,
  brand_id          bigint references public.brands(id) on delete set null,
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              jsonb not null check (public.is_localized(name)),
  description       jsonb check (description is null or jsonb_typeof(description) = 'object'),
  attributes        jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  is_veg            boolean,                       -- null = not a food item
  tags              text[] not null default '{}',
  hsn_code          text,
  gst_rate          numeric(4,2) not null default 0 check (gst_rate between 0 and 40),   -- 0/5/18/40 slabs
  country_of_origin text not null default 'India',
  -- Legal Metrology: manufacturer/packer as printed on the pack (English legal text, not translated).
  -- {"name":"Gujarat Co-op Milk Marketing Federation Ltd","address":"Anand, Gujarat 388001"}
  manufacturer      jsonb check (manufacturer is null
                                 or (jsonb_typeof(manufacturer) = 'object' and manufacturer ? 'name')),
  shelf_life        text,                          -- "2 days", "6 months"
  is_active         boolean not null default true,
  sort_order        int not null default 0,
  search_text       text not null default '',      -- maintained by trigger below
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index products_category_idx on public.products (category_id, sort_order) where is_active;
create index products_brand_idx    on public.products (brand_id);
create index products_attrs_idx    on public.products using gin (attributes jsonb_path_ops);
create index products_tags_idx     on public.products using gin (tags);
create index products_search_trgm  on public.products using gin (search_text extensions.gin_trgm_ops);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Products must sit in a sub-category (a category that has a parent).
create or replace function public.products_check_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.categories where id = new.category_id and parent_id is not null) then
    raise exception 'Product % must belong to a sub-category', new.slug;
  end if;
  return new;
end $$;
create trigger products_category_check before insert or update of category_id on public.products
  for each row execute function public.products_check_category();

-- search_text = all names (en/mr/hi) + brand + sub-category + parent category + tags
create or replace function public.products_build_search_text()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_brand jsonb;
  v_cat   jsonb;
  v_par   jsonb;
begin
  select b.name into v_brand from public.brands b where b.id = new.brand_id;
  select c.name, p.name into v_cat, v_par
    from public.categories c left join public.categories p on p.id = c.parent_id
   where c.id = new.category_id;
  new.search_text := public.normalize_search(concat_ws(' ',
    new.name->>'en', new.name->>'mr', new.name->>'hi',
    v_brand->>'en', v_brand->>'mr', v_brand->>'hi',
    v_cat->>'en', v_cat->>'mr', v_cat->>'hi',
    v_par->>'en', v_par->>'mr', v_par->>'hi',
    array_to_string(new.tags, ' ')));
  return new;
end $$;
create trigger products_search_text before insert or update of name, brand_id, category_id, tags
  on public.products for each row execute function public.products_build_search_text();

-- Renaming a brand or category refreshes its products' search_text
-- ("update of brand_id" fires even when the value is unchanged).
create or replace function public.refresh_product_search_text()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'brands' then
    update public.products set brand_id = brand_id where brand_id = new.id;
  else
    update public.products set category_id = category_id
     where category_id = new.id
        or category_id in (select id from public.categories where parent_id = new.id);
  end if;
  return null;
end $$;
create trigger brands_refresh_search after update of name on public.brands
  for each row execute function public.refresh_product_search_text();
create trigger categories_refresh_search after update of name on public.categories
  for each row execute function public.refresh_product_search_text();

-- ---------- variants, images, inventory ------------------------------

create table public.product_variants (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references public.products(id) on delete cascade,
  sku           text not null unique,
  barcode       text,
  label         jsonb not null check (public.is_localized(label)),   -- {"en":"500 g","mr":"५०० ग्रॅ","hi":"500 ग्राम"}
  net_quantity  numeric(10,3) not null check (net_quantity > 0),
  unit          text not null check (unit in ('g','kg','ml','l','pc','pack')),
  mrp           numeric(10,2) not null check (mrp > 0),
  price         numeric(10,2) not null check (price > 0),
  max_per_order int not null default 10 check (max_per_order between 1 and 50),
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (price <= mrp)
);
create index product_variants_product_idx on public.product_variants (product_id, sort_order);
create index product_variants_barcode_idx on public.product_variants (barcode) where barcode is not null;
create unique index product_variants_one_default on public.product_variants (product_id) where is_default;
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

create table public.product_images (
  id         bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  variant_id bigint references public.product_variants(id) on delete cascade,
  path       text not null,           -- catalog bucket: products/<product_id>/<uuid>_full.webp
  thumb_path text,                    -- products/<product_id>/<uuid>_thumb.webp
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.inventory (
  store_id            bigint not null references public.stores(id) on delete cascade,
  variant_id          bigint not null references public.product_variants(id) on delete cascade,
  stock               int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  is_available        boolean not null default true,     -- manual "hide from sale" switch
  updated_at          timestamptz not null default now(),
  primary key (store_id, variant_id)
);
create index inventory_variant_idx on public.inventory (variant_id);
create trigger inventory_updated_at before update on public.inventory
  for each row execute function public.set_updated_at();

-- ---------- the one definition of "what can be sold" -----------------

create or replace view public.v_variant_offers with (security_invoker = on) as
select
  v.id            as variant_id,
  v.product_id,
  s.id            as store_id,
  v.label, v.net_quantity, v.unit, v.mrp, v.price,
  case when v.mrp > 0 then round((v.mrp - v.price) / v.mrp * 100)::int else 0 end as discount_pct,
  v.max_per_order, v.is_default, v.sort_order, v.is_active,
  case when v.is_active and coalesce(i.is_available, false)
       then least(greatest(coalesce(i.stock, 0), 0), v.max_per_order) else 0 end as available_qty,
  (v.is_active and coalesce(i.is_available, false)
     and coalesce(i.stock, 0) > 0 and i.stock <= i.low_stock_threshold) as low_stock
from public.product_variants v
cross join public.stores s
left join public.inventory i on i.variant_id = v.id and i.store_id = s.id;

-- ---------- RLS -------------------------------------------------------

alter table public.stores           enable row level security;
alter table public.categories       enable row level security;
alter table public.brands           enable row level security;
alter table public.products         enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images   enable row level security;
alter table public.inventory        enable row level security;

create policy "stores: read active"       on public.stores           for select using (is_active or public.is_staff());
create policy "categories: read active"   on public.categories       for select using (is_active or public.is_staff());
create policy "brands: read"              on public.brands           for select using (true);
create policy "products: read active"     on public.products         for select using (is_active or public.is_staff());
create policy "variants: read active"     on public.product_variants for select using (is_active or public.is_staff());
create policy "images: read"              on public.product_images   for select using (true);
create policy "inventory: read"           on public.inventory        for select using (true);   -- needed for Realtime

create policy "stores: admin write"     on public.stores           for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "categories: admin write" on public.categories       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "brands: admin write"     on public.brands           for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products: admin write"   on public.products         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "variants: admin write"   on public.product_variants for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "images: admin write"     on public.product_images   for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- inventory: intentionally NO write policy. Only RPCs (Phase 4, 6) change stock.

-- ---------- filter matching (shared by list_products and search) -----
-- p_filters shape:
-- { "brand_ids":[3,7], "price_min":50, "price_max":100,   -- max is exclusive (buckets)
--   "veg":true, "in_stock":true,
--   "attrs": { "milk_type":["cow"], "organic":true, "fat_percent":{"min":3,"max":6} } }
create or replace function public.product_matches_filters(
  p_attributes jsonb, p_brand_id bigint, p_is_veg boolean,
  p_price numeric, p_available int, p_filters jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_filters is null or p_filters = '{}'::jsonb or (
          (not (p_filters ? 'brand_ids')
             or p_brand_id in (select (x)::bigint from jsonb_array_elements_text(p_filters->'brand_ids') x))
      and (not (p_filters ? 'price_min') or p_price >= (p_filters->>'price_min')::numeric)
      and (not (p_filters ? 'price_max') or p_price <  (p_filters->>'price_max')::numeric)
      and (not coalesce((p_filters->>'veg')::boolean, false)      or p_is_veg is true)
      and (not coalesce((p_filters->>'in_stock')::boolean, false) or p_available > 0)
      and not exists (
        select 1 from jsonb_each(coalesce(p_filters->'attrs', '{}'::jsonb)) as f(k, v)
        where not coalesce(
          case
            when jsonb_typeof(f.v) = 'array' and jsonb_typeof(p_attributes->f.k) = 'array'
              then (p_attributes->f.k) ?| array(select jsonb_array_elements_text(f.v))
            when jsonb_typeof(f.v) = 'array'
              then (p_attributes->>f.k) in (select jsonb_array_elements_text(f.v))
            when jsonb_typeof(f.v) = 'boolean'
              then coalesce((p_attributes->>f.k)::boolean, false) = (f.v #>> '{}')::boolean
            when jsonb_typeof(f.v) = 'object'
              then (p_attributes->>f.k)::numeric
                     between coalesce((f.v->>'min')::numeric, '-infinity'::numeric)
                         and coalesce((f.v->>'max')::numeric,  'infinity'::numeric)
            else (p_attributes->>f.k) = (f.v #>> '{}')
          end, false)
      )
    ), false)
$$;

-- ---------- product cards (one shape for every list in the app) ------
-- Returns a jsonb array of cards in the same order as p_product_ids.
-- Default variant = in-stock first, then is_default, then sort_order.
create or replace function public.catalog_product_cards(p_store_id bigint, p_product_ids bigint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(c.card order by u.ord), '[]'::jsonb)
  from unnest(p_product_ids) with ordinality as u(product_id, ord)
  join lateral (
    select jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'brand', b.name,
      'is_veg', p.is_veg, 'category_id', p.category_id, 'attributes', p.attributes,
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

-- ---------- list_products: category grid -----------------------------
-- p_category_id may be a parent (all its sub-categories) or a sub-category.
-- p_sort: 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'newest'
-- Out-of-stock products always go last (like Blinkit).
create or replace function public.list_products(
  p_category_id bigint,
  p_filters     jsonb  default '{}'::jsonb,
  p_sort        text   default 'relevance',
  p_page        int    default 0,
  p_size        int    default 20,
  p_store_id    bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store  bigint := coalesce(p_store_id, public.default_store_id());
  v_size   int    := least(greatest(coalesce(p_size, 20), 1), 50);
  v_offset int    := greatest(coalesce(p_page, 0), 0) * v_size;
  v_ids    bigint[];
begin
  select array_agg(x.id order by x.rn) into v_ids
  from (
    select p.id,
           row_number() over (order by
             (o.available_qty > 0) desc,
             case when p_sort = 'price_asc'  then o.price        end asc  nulls last,
             case when p_sort = 'price_desc' then o.price        end desc nulls last,
             case when p_sort = 'discount'   then o.discount_pct end desc nulls last,
             case when p_sort = 'newest'     then p.created_at   end desc nulls last,
             p.sort_order, p.id) as rn
      from public.products p
      join public.categories c on c.id = p.category_id and c.is_active
      join lateral (
        select vo.price, vo.discount_pct, vo.available_qty from public.v_variant_offers vo
         where vo.product_id = p.id and vo.store_id = v_store and vo.is_active
         order by (vo.available_qty > 0) desc, vo.is_default desc, vo.sort_order, vo.variant_id
         limit 1
      ) o on true
     where p.is_active
       and (p.category_id = p_category_id or c.parent_id = p_category_id)
       and public.product_matches_filters(p.attributes, p.brand_id, p.is_veg,
                                          o.price, o.available_qty, p_filters)
     order by rn
     offset v_offset limit v_size + 1
  ) x;

  return jsonb_build_object(
    'items',    public.catalog_product_cards(v_store, coalesce(v_ids[1:v_size], '{}'::bigint[])),
    'has_more', coalesce(array_length(v_ids, 1), 0) > v_size,
    'page',     coalesce(p_page, 0));
end $$;

-- ---------- get_product: everything the detail screen needs ----------
create or replace function public.get_product(p_slug text, p_store_id bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(p_store_id, public.default_store_id()) as id),
  p as (select * from public.products where slug = p_slug and is_active),
  c as (
    select c.id, c.slug, c.name, par.slug as parent_slug, par.name as parent_name,
           coalesce(par.attribute_schema->'fields', '[]'::jsonb)
             || coalesce(c.attribute_schema->'fields', '[]'::jsonb) as fields
      from public.categories c
      left join public.categories par on par.id = c.parent_id
     where c.id = (select category_id from p)
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'product',  (select to_jsonb(p) - 'search_text' from p),
    'brand',    (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'logo_path', b.logo_path)
                   from public.brands b where b.id = (select brand_id from p)),
    'category', (select jsonb_build_object('id', id, 'slug', slug, 'name', name,
                        'parent_slug', parent_slug, 'parent_name', parent_name) from c),
    -- parent fields first, then sub-category fields; the app de-duplicates by key (child wins)
    'attribute_fields', (select fields from c),
    'variants', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', o.variant_id, 'label', o.label, 'net_quantity', o.net_quantity, 'unit', o.unit,
                    'mrp', o.mrp, 'price', o.price, 'discount_pct', o.discount_pct,
                    'available_qty', o.available_qty, 'low_stock', o.low_stock,
                    'max_per_order', o.max_per_order, 'is_default', o.is_default)
                    order by o.sort_order, o.variant_id), '[]'::jsonb)
                   from public.v_variant_offers o
                  where o.product_id = (select id from p) and o.store_id = (select id from s) and o.is_active),
    'images',   (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', i.id, 'variant_id', i.variant_id, 'path', i.path, 'thumb_path', i.thumb_path)
                    order by i.sort_order, i.id), '[]'::jsonb)
                   from public.product_images i where i.product_id = (select id from p)),
    'seller',   (select jsonb_build_object('name', st.name, 'address', st.address,
                        'fssai_license', st.fssai_license, 'gstin', st.gstin)
                   from public.stores st where st.id = (select id from s))
  ) end
$$;

-- ---------- store_status: open/closed, ETA, fees (see 1.11) ----------
create or replace function public.store_status(p_store_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s           public.stores;
  v_local     timestamp;
  v_day       date;
  v_key       text;
  v_slot      jsonb;
  v_open_now  boolean := false;
  v_opens_at  timestamptz;
  v_closes_at timestamptz;
begin
  select * into s from public.stores
   where id = coalesce(p_store_id, public.default_store_id()) and is_active;
  if not found then return null; end if;

  v_local := now() at time zone s.timezone;

  if s.opening_hours = '{}'::jsonb then
    v_open_now := true;                                  -- no hours set = always open
  else
    for d in 0..7 loop
      v_day := v_local::date + d;
      v_key := lower(to_char(v_day, 'dy'));              -- 'mon' … 'sun'
      for v_slot in
        select e.value from jsonb_array_elements(coalesce(s.opening_hours->v_key, '[]'::jsonb)) e
         order by e.value->>'open'
      loop
        if d = 0 and v_local::time >= (v_slot->>'open')::time
                 and v_local::time <  (v_slot->>'close')::time then
          v_open_now  := true;
          v_closes_at := (v_day + (v_slot->>'close')::time) at time zone s.timezone;
        elsif v_opens_at is null and (v_day + (v_slot->>'open')::time) > v_local then
          v_opens_at := (v_day + (v_slot->>'open')::time) at time zone s.timezone;
        end if;
      end loop;
      exit when v_opens_at is not null;
    end loop;
  end if;

  return jsonb_build_object(
    'store_id',    s.id,
    'name',        s.name,
    'city',        s.city,
    'phone',       s.phone,
    'accepting',   s.is_accepting_orders,
    'open_now',    v_open_now,
    'is_open',     v_open_now and s.is_accepting_orders,
    'opens_at',    v_opens_at,
    'closes_at',   v_closes_at,
    'eta_minutes', s.eta_minutes,
    'message',     s.busy_message,
    'fees', jsonb_build_object(
      'min_order_value', s.min_order_value, 'delivery_fee', s.delivery_fee,
      'free_delivery_above', s.free_delivery_above, 'small_cart_threshold', s.small_cart_threshold,
      'small_cart_fee', s.small_cart_fee, 'packaging_fee', s.packaging_fee),
    'server_time', now());
end $$;

-- ---------- Realtime -------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.inventory, public.product_variants, public.stores;
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog', 'catalog', true, 2 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Public bucket: anyone can GET files by URL. Only admins can write.
create policy "catalog: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog' and public.is_admin());
create policy "catalog: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'catalog' and public.is_admin());
create policy "catalog: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'catalog' and public.is_admin());
