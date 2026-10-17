# Phase 1: Catalog & Home

> **Goal:** anyone (no login) can open the app, see a Blinkit-style Home, browse every category and sub-category, open a product, pick a variant and tap **ADD**, while stock and prices update **live**.
> **Duration:** about 1.5–2 weeks · **Depends on:** Phase 0 · **Next:** Phase 2 (Search & Discovery)

**Done when:**
- [ ] `0100_catalog.sql` and `0110_home.sql` apply cleanly with `supabase db reset`, and `seed.sql` loads 1 store, 8 categories with sub-categories and about 60 products
- [ ] Home renders entirely from `get_home()`: banner carousel, category grid, product rails, in EN/मराठी/हिंदी
- [ ] Category screen shows the **sub-category rail on the left** and a product grid on the right, with infinite scroll
- [ ] Product card shows price, struck-through MRP, "% OFF", veg mark, variant label, **ADD → − n +** stepper, "Only 3 left" and "Out of stock"
- [ ] Product detail shows gallery, variant picker, highlights (from the category's attribute schema) and mandatory info (MRP incl. taxes, net qty, manufacturer, origin, shelf life, FSSAI)
- [ ] Changing a stock number or price in **Supabase Studio** updates the open screen within about 1 second, without a pull-to-refresh
- [ ] The header shows "Delivery in 20 minutes" when open and "Store closed · Opens 7:00 AM" when closed, and it flips when `is_accepting_orders` is toggled in Studio
- [ ] Turning on airplane mode still shows the last Home and category data with an offline banner
- [ ] pgTAP tests for RLS, `list_products`, `store_status` and default-variant choice pass in CI

| # | Heading | Output |
|---|---|---|
| 1.1 | Catalog schema & seed | `supabase/migrations/0100_catalog.sql`, `supabase/seed.sql` |
| 1.2 | Storage bucket & image helpers | `catalog` bucket + policies, `src/lib/images.ts`, seed image script |
| 1.3 | Navigation shell + floating cart bar slot | `(shop)` tabs, `CartBar`, guest cart store |
| 1.4 | Home (dynamic sections, banners) | `0110_home.sql`, `get_home()`, section registry |
| 1.5 | Categories tab | All categories grouped by parent |
| 1.6 | Category screen (sub-category rail + grid) | `category/[slug].tsx` |
| 1.7 | Product card & ADD stepper | `ProductCard`, `AddButton`, `VariantSheet` |
| 1.8 | Product detail & variants | `product/[slug].tsx`, `get_product()` |
| 1.9 | Attribute display registry | `features/attributes/registry.tsx` (display half) |
| 1.10 | Live stock & price via Realtime | `src/lib/realtime.ts`, live overlay store |
| 1.11 | Store status header | `store_status()`, `StoreHeader` |
| 1.12 | Loading / empty / error / offline | Skeletons, states, offline banner |

> **Data entry in this phase:** there is no admin editor yet (Phase 7). Products come from `seed.sql`, and you change stock and prices in **Supabase Studio** (`http://localhost:54323` locally) to test live updates.

---

## 1.1 Catalog schema & seed

**Goal:** every table the shop needs to show products and stock, protected by RLS, plus helper functions that return **ready-to-render product cards** in one round-trip.

**Files**
```
supabase/migrations/0100_catalog.sql
supabase/seed.sql
supabase/seed/products.csv          # source for the ~60 demo products
scripts/csv-to-seed.ts              # turns the CSV into SQL appended to seed.sql
supabase/tests/0100_catalog.test.sql
```

### Design choices

- **Two category levels**: category → sub-category. Products always belong to a **sub-category** (enforced by a trigger). This is what makes the Blinkit left rail work.
- **One store row** in v1, but `inventory` is keyed by `(store_id, variant_id)`, so a second dark store needs no schema change.
- **`products.search_text`** is maintained here by a trigger (names in all 3 languages + brand + category names + tags, lower-cased, accents removed). Phase 2 only adds the search functions on top of it.
- **`v_variant_offers`** is a view that joins variant + stock and computes `available_qty` (capped at `max_per_order`) and `low_stock`. Every RPC uses it, so "what can be sold" is defined in exactly one place.
- **Customers never see a raw stock count larger than they can buy**: `available_qty = least(stock, max_per_order)`.
- **Inventory has no write policies at all.** In Phases 1–5 stock is changed in Studio (service role); from Phase 4 by `place_order()`; from Phase 6 by staff RPCs.

### SQL: `supabase/migrations/0100_catalog.sql`

```sql
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
  gst_rate          numeric(4,2) not null default 0 check (gst_rate between 0 and 28),
  country_of_origin text not null default 'India',
  manufacturer      jsonb,                         -- {"en":"Gujarat Co-op Milk Marketing Federation, Anand"}
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
```

> **Why `inventory` is publicly readable:** Supabase Realtime `postgres_changes` checks RLS for each subscriber, so guests need `select` on `inventory` to get stock events. The stock number is not secret for a grocery store. If you'd rather hide exact counts later, replace the Realtime subscription with a trigger that calls `realtime.send()` with only `{variant_id, available_qty, low_stock}` on a broadcast topic, and drop this policy.

### Seed: `supabase/seed.sql`

`supabase db reset` runs migrations and then `seed.sql`. Keep the hand-written part small and generate the bulk from a CSV.

```sql
-- ---------- store (Amravati) ----------
insert into public.stores (name, address, city, location, service_radius_km, phone, whatsapp,
                           gstin, fssai_license, opening_hours, eta_minutes)
values (
  '{"en":"NearKart Rajapeth","mr":"नियरकार्ट राजापेठ","hi":"नियरकार्ट राजापेठ"}',
  '{"en":"Shop 4, Rajapeth Square, Amravati 444601","mr":"दुकान ४, राजापेठ चौक, अमरावती ४४४६०१","hi":"दुकान 4, राजापेठ चौक, अमरावती 444601"}',
  'Amravati',
  extensions.st_point(77.7523, 20.9374, 4326)::extensions.geography,   -- lng, lat
  4, '+919800000000', '+919800000000',
  '27ABCDE1234F1Z5', '11524999000000',
  '{"mon":[{"open":"07:00","close":"22:30"}],"tue":[{"open":"07:00","close":"22:30"}],
    "wed":[{"open":"07:00","close":"22:30"}],"thu":[{"open":"07:00","close":"22:30"}],
    "fri":[{"open":"07:00","close":"22:30"}],"sat":[{"open":"07:00","close":"23:00"}],
    "sun":[{"open":"08:00","close":"14:00"},{"open":"16:00","close":"22:00"}]}',
  20);

-- ---------- categories (8 parents) ----------
insert into public.categories (slug, name, icon, color, sort_order, image_path) values
 ('fruits-vegetables', '{"en":"Fruits & Vegetables","mr":"फळे व भाज्या","hi":"फल और सब्ज़ियाँ"}',        'food-apple',     '#16A34A', 1, 'categories/fruits-vegetables.webp'),
 ('dairy-bread-eggs',  '{"en":"Dairy, Bread & Eggs","mr":"दूध, ब्रेड व अंडी","hi":"डेयरी, ब्रेड और अंडे"}', 'cup',            '#2563EB', 2, 'categories/dairy-bread-eggs.webp'),
 ('atta-rice-dal',     '{"en":"Atta, Rice & Dal","mr":"पीठ, तांदूळ व डाळ","hi":"आटा, चावल और दाल"}',      'rice',           '#CA8A04', 3, 'categories/atta-rice-dal.webp'),
 ('oil-masala',        '{"en":"Oil, Masala & Dry Fruits","mr":"तेल, मसाले व सुका मेवा","hi":"तेल, मसाले और मेवे"}', 'bottle-tonic', '#EA580C', 4, 'categories/oil-masala.webp'),
 ('snacks-biscuits',   '{"en":"Snacks & Biscuits","mr":"स्नॅक्स व बिस्किटे","hi":"स्नैक्स और बिस्किट"}',   'cookie',         '#DB2777', 5, 'categories/snacks-biscuits.webp'),
 ('cold-drinks',       '{"en":"Cold Drinks & Juices","mr":"शीतपेये व ज्यूस","hi":"कोल्ड ड्रिंक और जूस"}',  'cup-water',      '#0891B2', 6, 'categories/cold-drinks.webp'),
 ('personal-care',     '{"en":"Personal Care","mr":"वैयक्तिक काळजी","hi":"पर्सनल केयर"}',                  'lotion',         '#7C3AED', 7, 'categories/personal-care.webp'),
 ('household',         '{"en":"Cleaning & Household","mr":"स्वच्छता व घरगुती","hi":"सफाई और घरेलू"}',      'spray-bottle',   '#475569', 8, 'categories/household.webp');

-- Attribute schema + filters on a parent (sub-categories inherit)
update public.categories set
  attribute_schema = '{"fields":[
    {"key":"milk_type","type":"select","label":{"en":"Milk type","mr":"दुधाचा प्रकार","hi":"दूध का प्रकार"},"filterable":true,
     "options":[{"value":"cow","label":{"en":"Cow","mr":"गाय","hi":"गाय"}},{"value":"buffalo","label":{"en":"Buffalo","mr":"म्हैस","hi":"भैंस"}}]},
    {"key":"fat_percent","type":"number","unit":"%","label":{"en":"Fat","mr":"फॅट","hi":"वसा"}},
    {"key":"organic","type":"boolean","label":{"en":"Organic","mr":"सेंद्रिय","hi":"जैविक"},"filterable":true,"badge":true}
  ]}',
  filters = '[{"type":"brand"},{"type":"price","buckets":[0,30,60,100]},{"type":"attribute","key":"milk_type"},{"type":"attribute","key":"organic","quick":true},{"type":"veg"}]'
where slug = 'dairy-bread-eggs';

-- Sub-categories (2–4 per parent)
insert into public.categories (parent_id, slug, name, sort_order, image_path)
select p.id, s.slug, s.name::jsonb, s.ord, 'categories/' || s.slug || '.webp'
from (values
  ('fruits-vegetables','fresh-vegetables','{"en":"Fresh Vegetables","mr":"ताज्या भाज्या","hi":"ताज़ी सब्ज़ियाँ"}',1),
  ('fruits-vegetables','fresh-fruits',    '{"en":"Fresh Fruits","mr":"ताजी फळे","hi":"ताज़े फल"}',2),
  ('fruits-vegetables','leafy-herbs',     '{"en":"Leafy & Herbs","mr":"पालेभाज्या","hi":"पत्तेदार सब्ज़ियाँ"}',3),
  ('dairy-bread-eggs', 'milk',            '{"en":"Milk","mr":"दूध","hi":"दूध"}',1),
  ('dairy-bread-eggs', 'curd-paneer',     '{"en":"Curd & Paneer","mr":"दही व पनीर","hi":"दही और पनीर"}',2),
  ('dairy-bread-eggs', 'bread-pav',       '{"en":"Bread & Pav","mr":"ब्रेड व पाव","hi":"ब्रेड और पाव"}',3),
  ('dairy-bread-eggs', 'eggs',            '{"en":"Eggs","mr":"अंडी","hi":"अंडे"}',4),
  ('atta-rice-dal',    'atta-flours',     '{"en":"Atta & Flours","mr":"पीठ","hi":"आटा"}',1),
  ('atta-rice-dal',    'rice',            '{"en":"Rice","mr":"तांदूळ","hi":"चावल"}',2),
  ('atta-rice-dal',    'dal-pulses',      '{"en":"Dal & Pulses","mr":"डाळी व कडधान्ये","hi":"दाल और दलहन"}',3),
  ('oil-masala',       'edible-oil',      '{"en":"Edible Oil","mr":"खाद्य तेल","hi":"खाने का तेल"}',1),
  ('oil-masala',       'masala',          '{"en":"Masala & Spices","mr":"मसाले","hi":"मसाले"}',2),
  ('oil-masala',       'dry-fruits',      '{"en":"Dry Fruits","mr":"सुका मेवा","hi":"सूखे मेवे"}',3),
  ('snacks-biscuits',  'biscuits',        '{"en":"Biscuits","mr":"बिस्किटे","hi":"बिस्किट"}',1),
  ('snacks-biscuits',  'namkeen-chips',   '{"en":"Namkeen & Chips","mr":"नमकीन व चिप्स","hi":"नमकीन और चिप्स"}',2),
  ('cold-drinks',      'soft-drinks',     '{"en":"Soft Drinks","mr":"सॉफ्ट ड्रिंक्स","hi":"सॉफ्ट ड्रिंक"}',1),
  ('cold-drinks',      'juices',          '{"en":"Juices","mr":"ज्यूस","hi":"जूस"}',2),
  ('personal-care',    'bath-body',       '{"en":"Bath & Body","mr":"अंघोळ","hi":"स्नान"}',1),
  ('personal-care',    'oral-care',       '{"en":"Oral Care","mr":"दातांची काळजी","hi":"दाँतों की देखभाल"}',2),
  ('household',        'detergents',      '{"en":"Detergents","mr":"डिटर्जंट","hi":"डिटर्जेंट"}',1),
  ('household',        'cleaners',        '{"en":"Floor & Toilet Cleaners","mr":"फ्लोअर व टॉयलेट क्लीनर","hi":"फ़्लोर और टॉयलेट क्लीनर"}',2)
) as s(parent_slug, slug, name, ord)
join public.categories p on p.slug = s.parent_slug;

-- ---------- brands ----------
insert into public.brands (slug, name) values
 ('amul','{"en":"Amul","mr":"अमूल","hi":"अमूल"}'),
 ('aashirvaad','{"en":"Aashirvaad","mr":"आशीर्वाद","hi":"आशीर्वाद"}'),
 ('parle','{"en":"Parle","mr":"पार्ले","hi":"पारले"}'),
 ('fresh','{"en":"Fresh","mr":"ताजे","hi":"ताज़ा"}');

-- ---------- a few products in full ----------
with p as (
  insert into public.products (category_id, brand_id, slug, name, description, attributes, is_veg,
                               tags, hsn_code, gst_rate, country_of_origin, manufacturer, shelf_life, sort_order)
  values
  ((select id from public.categories where slug='milk'), (select id from public.brands where slug='amul'),
   'amul-taaza-toned-milk',
   '{"en":"Amul Taaza Toned Milk","mr":"अमूल ताजा टोन्ड दूध","hi":"अमूल ताज़ा टोंड दूध"}',
   '{"en":"Pasteurised toned milk. Keep refrigerated.","mr":"पाश्चराइज्ड टोन्ड दूध. फ्रिजमध्ये ठेवा.","hi":"पाश्चराइज़्ड टोंड दूध। फ्रिज में रखें।"}',
   '{"milk_type":"buffalo","fat_percent":3}', true, '{milk,doodh,dudh}', '0401', 0, 'India',
   '{"en":"Gujarat Co-operative Milk Marketing Federation Ltd, Anand, Gujarat 388001"}', '2 days', 1),
  ((select id from public.categories where slug='fresh-vegetables'), (select id from public.brands where slug='fresh'),
   'tomato-local',
   '{"en":"Tomato (Local)","mr":"टोमॅटो (गावरान)","hi":"टमाटर (देसी)"}',
   '{"en":"Fresh, firm local tomatoes.","mr":"ताजे, घट्ट गावरान टोमॅटो.","hi":"ताज़े, सख़्त देसी टमाटर।"}',
   '{}', true, '{tamatar,tameta}', '0702', 0, 'India', null, '3 days', 1),
  ((select id from public.categories where slug='atta-flours'), (select id from public.brands where slug='aashirvaad'),
   'aashirvaad-whole-wheat-atta',
   '{"en":"Aashirvaad Shudh Chakki Atta","mr":"आशीर्वाद शुद्ध चक्की आटा","hi":"आशीर्वाद शुद्ध चक्की आटा"}',
   '{"en":"100% whole wheat atta.","mr":"१००% गव्हाचे पीठ.","hi":"100% गेहूँ का आटा।"}',
   '{}', true, '{atta,aata,gehu,wheat}', '1101', 5, 'India',
   '{"en":"ITC Ltd, Virginia House, 37 J.L. Nehru Road, Kolkata 700071"}', '4 months', 1),
  ((select id from public.categories where slug='biscuits'), (select id from public.brands where slug='parle'),
   'parle-g-gold',
   '{"en":"Parle-G Gold Biscuits","mr":"पार्ले-जी गोल्ड बिस्किटे","hi":"पारले-जी गोल्ड बिस्किट"}',
   null, '{}', true, '{biscuit,parle}', '1905', 18, 'India',
   '{"en":"Parle Products Pvt Ltd, Vile Parle (E), Mumbai 400057"}', '9 months', 1)
  returning id, slug
)
insert into public.product_variants (product_id, sku, barcode, label, net_quantity, unit, mrp, price, max_per_order, is_default, sort_order)
select p.id, v.sku, v.barcode, v.label::jsonb, v.qty, v.unit, v.mrp, v.price, v.maxq, v.def, v.ord
from p join (values
  ('amul-taaza-toned-milk','AMUL-TAAZA-500','8901262010016','{"en":"500 ml","mr":"५०० मिली","hi":"500 मिली"}',500,'ml',28,28,6,true,1),
  ('amul-taaza-toned-milk','AMUL-TAAZA-1L', '8901262010023','{"en":"1 l","mr":"१ लि","hi":"1 ली"}',1,'l',56,54,6,false,2),
  ('tomato-local','TOM-500',null,'{"en":"500 g","mr":"५०० ग्रॅ","hi":"500 ग्राम"}',500,'g',30,22,5,true,1),
  ('tomato-local','TOM-1KG',null,'{"en":"1 kg","mr":"१ किलो","hi":"1 किलो"}',1,'kg',60,42,5,false,2),
  ('aashirvaad-whole-wheat-atta','AASH-ATTA-5','8901725181222','{"en":"5 kg","mr":"५ किलो","hi":"5 किलो"}',5,'kg',299,249,3,true,1),
  ('aashirvaad-whole-wheat-atta','AASH-ATTA-10','8901725181239','{"en":"10 kg","mr":"१० किलो","hi":"10 किलो"}',10,'kg',570,489,2,false,2),
  ('parle-g-gold','PARLEG-GOLD-100','8901719110016','{"en":"100 g","mr":"१०० ग्रॅ","hi":"100 ग्राम"}',100,'g',10,10,12,true,1)
) as v(slug, sku, barcode, label, qty, unit, mrp, price, maxq, def, ord) on v.slug = p.slug;

-- ---------- generated products (from supabase/seed/products.csv) ----------
-- \i is not available in seed.sql; scripts/csv-to-seed.ts appends INSERTs below this line.
-- >>> GENERATED START
-- >>> GENERATED END

-- ---------- stock for every variant ----------
insert into public.inventory (store_id, variant_id, stock, low_stock_threshold)
select public.default_store_id(), v.id,
       case when v.sku = 'AASH-ATTA-10' then 0            -- one out-of-stock item to test UI
            when v.sku = 'AMUL-TAAZA-1L' then 3            -- one low-stock item
            else 20 + (v.id * 7) % 60 end,
       5
from public.product_variants v
on conflict do nothing;
```

**Generating about 60 products.** Keep demo data in `supabase/seed/products.csv`, **one row per variant** (Phase 7's CSV import uses the same columns, so the file can be re-used to load the real catalog):

```csv
category_slug,brand_slug,product_slug,name_en,name_mr,name_hi,is_veg,tags,hsn_code,gst_rate,country_of_origin,manufacturer_en,shelf_life,sku,barcode,variant_label_en,variant_label_mr,variant_label_hi,net_quantity,unit,mrp,price,max_per_order,is_default,image_file
milk,amul,amul-gold-milk,Amul Gold Full Cream Milk,अमूल गोल्ड दूध,अमूल गोल्ड दूध,true,milk|doodh,0401,0,India,"GCMMF, Anand",2 days,AMUL-GOLD-500,8901262010030,500 ml,५०० मिली,500 मिली,500,ml,34,34,6,true,amul-gold.jpg
```

```ts
// scripts/csv-to-seed.ts  (run: npx tsx scripts/csv-to-seed.ts)
// Reads the CSV, groups rows by product_slug, writes INSERT … SELECT statements
// between the GENERATED markers in supabase/seed.sql. Escapes ' as ''.
import { parse } from 'csv-parse/sync';
import fs from 'node:fs';
const rows = parse(fs.readFileSync('supabase/seed/products.csv'), { columns: true });
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const loc = (en: string, mr: string, hi: string) => q(JSON.stringify({ en, mr: mr || undefined, hi: hi || undefined }));
// … build "insert into public.products … on conflict (slug) do nothing;" per product
// … and "insert into public.product_variants … select id from products where slug=…" per variant
// … replace text between '-- >>> GENERATED START' and '-- >>> GENERATED END'
```

**Steps**
1. Create the migration: `supabase migration new catalog` → rename to `0100_catalog.sql` (keep the numeric prefix order from the overview) and paste the SQL.
2. `supabase db reset` (applies 0000 + 0100 + seed).
3. `supabase gen types typescript --local > mobile/src/types/database.ts`.
4. Open Studio → Table editor → check `products.search_text` has Devanagari and English text.

**Checks**
- `select public.list_products((select id from categories where slug='dairy-bread-eggs'));` returns cards; the 1 l milk shows `low_stock: true`.
- `select public.get_product('aashirvaad-whole-wheat-atta');` shows the 10 kg variant with `available_qty: 0`.
- As `anon` (`set role anon;`): `insert into public.products …` fails; `update public.inventory …` affects 0 rows.
- Inserting a product into a parent category (e.g. `dairy-bread-eggs`) raises "must belong to a sub-category".

**Tests: `supabase/tests/0100_catalog.test.sql` (pgTAP)**
```sql
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
```
> The "out-of-stock is last" check only proves something when the sub-category has more than one product; add a second biscuit in `products.csv`.

---

## 1.2 Storage bucket & image helpers

**Goal:** product, category and banner images load fast from a public bucket, in two sizes, without paying for Supabase image transforms.

**Files**
```
supabase/migrations/0100_catalog.sql   (append the bucket section below)
mobile/src/lib/images.ts
mobile/src/ui/RemoteImage.tsx
scripts/upload-seed-images.ts
```

**SQL (append to `0100_catalog.sql`)**
```sql
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
```

**Image sizes (decided once, used everywhere)**

| File | Size | Used in |
|---|---|---|
| `<uuid>_thumb.webp` | 300 px wide, quality 0.7 (≈ 10–25 KB) | Cards, rails, cart, search |
| `<uuid>_full.webp` | 1080 px wide, quality 0.8 (≈ 60–150 KB) | Product detail gallery, banners |

> ⚠️ Supabase **image transformations** (`?width=`) are a paid feature. Both sizes are made on the uploader's device (Phase 7 uses `expo-image-manipulator`), or by the seed script below.

**`src/lib/images.ts`**
```ts
import { env } from '@/config/env';

const BASE = `${env.SUPABASE_URL}/storage/v1/object/public/catalog/`;

/** Storage path → public URL. Never call getPublicUrl() per item in a list. */
export function catalogUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith('http') ? path : BASE + path;
}
```

**`src/ui/RemoteImage.tsx`**
```tsx
import { Image, type ImageProps } from 'expo-image';
import { catalogUrl } from '@/lib/images';
import { useTheme } from '@/theme';

export function RemoteImage({ path, ...rest }: { path?: string | null } & Omit<ImageProps, 'source'>) {
  const { colors } = useTheme();
  return (
    <Image
      source={catalogUrl(path)}
      cachePolicy="memory-disk"
      recyclingKey={path ?? undefined}        // correct image when FlashList recycles cells
      transition={150}
      contentFit="contain"
      placeholder={require('@/assets/images/product-placeholder.png')}
      style={[{ backgroundColor: colors.surfaceMuted }, rest.style]}
      {...rest}
    />
  );
}
```

**Seed images: `scripts/upload-seed-images.ts`** (local only, uses the local service-role key from `supabase status`; never commit that key and never use it in the app)
```ts
// For each file in supabase/seed/images/: resize to 300 px and 1080 px WebP with sharp,
// upload to catalog/products/<product_id>/<uuid>_thumb.webp and _full.webp,
// then insert product_images (path, thumb_path, sort_order).
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
const admin = createClient('http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);
```

**Checks**
- `catalogUrl('categories/milk.webp')` opens in a browser.
- An anonymous upload to `catalog` from the app fails with 403.

---

## 1.3 Navigation shell + floating cart bar slot

**Goal:** the Blinkit layout: 4 tabs, and a floating cart bar that appears on every browsing screen once something is in the cart.

**Files**
```
mobile/app/(shop)/_layout.tsx
mobile/app/(shop)/index.tsx            # Home
mobile/app/(shop)/categories.tsx
mobile/app/(shop)/orders.tsx           # placeholder until Phase 5
mobile/app/(shop)/account.tsx          # placeholder until Phase 3
mobile/app/category/[slug].tsx
mobile/app/product/[slug].tsx
mobile/app/cart.tsx                    # placeholder until Phase 4
mobile/src/features/cart/store.ts      # guest cart (Zustand + MMKV)
mobile/src/features/cart/CartBar.tsx
```

Phase 0 created placeholder tabs. Rename the group to `(shop)` and set the tabs to **Home · Categories · Orders · Account**.

**Guest cart store (`src/features/cart/store.ts`)**

The real cart (server-synced, re-priced by `get_cart_quote`) arrives in Phase 4. Phase 1 needs something the ADD button can write to, so build the **guest cart** now. Phase 4 keeps it for logged-out users and merges it on login.

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from '@/lib/storage';       // the MMKV zustand adapter from 0.9

export type CartLine = {
  variantId: number;
  productId: number;
  qty: number;
  // Snapshot for the cart bar only. Phase 4 replaces totals with the server quote.
  price: number;
  mrp: number;
};

type CartState = {
  lines: Record<number, CartLine>;
  setQty: (line: Omit<CartLine, 'qty'>, qty: number) => void;
  clear: () => void;
};

export const useGuestCart = create<CartState>()(
  persist(
    (set) => ({
      lines: {},
      setQty: (line, qty) =>
        set((s) => {
          const lines = { ...s.lines };
          if (qty <= 0) delete lines[line.variantId];
          else lines[line.variantId] = { ...line, qty };
          return { lines };
        }),
      clear: () => set({ lines: {} }),
    }),
    { name: 'guest-cart-v1', storage: createJSONStorage(() => mmkvStorage) },
  ),
);

export const useCartQty = (variantId: number) => useGuestCart((s) => s.lines[variantId]?.qty ?? 0);

export function useCartSummary() {
  return useGuestCart((s) => {
    let count = 0, total = 0;
    for (const l of Object.values(s.lines)) { count += l.qty; total += l.qty * l.price; }
    return { count, total };
  }, shallow);  // import { shallow } from 'zustand/shallow' (or useShallow in zustand v5)
}
```

**`CartBar.tsx`** (Blinkit's green bar above the tab bar)
```tsx
export function CartBar() {
  const { count, total } = useCartSummary();
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Animated.View entering={SlideInDown.springify()} exiting={SlideOutDown}
      className="absolute left-3 right-3 bottom-2 rounded-2xl bg-brand px-4 py-3 flex-row items-center">
      <View className="flex-1">
        <Text className="text-white font-bold">{t('cart.items', { count })}</Text>
        <Text className="text-white">{formatINR(total)}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/cart')}
        className="flex-row items-center min-h-[48px]">
        <Text className="text-white font-bold">{t('cart.view')}</Text>
        <Icon name="chevron-right" color="white" />
      </Pressable>
    </Animated.View>
  );
}
```
Render `<CartBar />` in `(shop)/_layout.tsx` (above the tab bar) and inside `category/[slug].tsx` and `product/[slug].tsx` (which sit outside the tabs). Add bottom padding to lists equal to the bar's height when it's visible, so the last row isn't hidden.

**Checks**
- Add an item, kill the app, reopen: the cart bar still shows it (MMKV persistence).
- The cart bar never covers the last product row.

---

## 1.4 Home (dynamic sections, banners)

**Goal:** the admin decides what Home shows (and in what order) with rows in `home_sections`. The app renders it from **one RPC call**.

**Files**
```
supabase/migrations/0110_home.sql
mobile/src/features/catalog/api.ts         (fetchHome)
mobile/src/features/catalog/hooks.ts       (useHome)
mobile/src/features/home/sections.tsx      (section registry)
mobile/src/features/home/BannerCarousel.tsx
mobile/src/features/home/CategoryGrid.tsx
mobile/src/features/home/ProductRail.tsx
mobile/src/features/home/CollectionRail.tsx
mobile/app/(shop)/index.tsx
```

### SQL: `supabase/migrations/0110_home.sql`

```sql
-- =====================================================================
-- 0110_home.sql · Phase 1: banners, collections, home layout
-- =====================================================================

create table public.banners (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references public.stores(id) on delete cascade,
  image_path text not null,
  title      jsonb check (title is null or public.is_localized(title)),     -- for screen readers
  -- {"type":"category","value":"milk"} | {"type":"product","value":"amul-taaza-toned-milk"}
  -- {"type":"collection","value":"diwali-specials"} | {"type":"search","value":"atta"}
  link       jsonb check (link is null or (link ? 'type' and link ? 'value')),
  sort_order int not null default 0,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index banners_store_idx on public.banners (store_id, sort_order) where is_active;
create trigger banners_updated_at before update on public.banners
  for each row execute function public.set_updated_at();

create table public.collections (
  id         bigint generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title      jsonb not null check (public.is_localized(title)),
  image_path text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger collections_updated_at before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_products (
  collection_id bigint not null references public.collections(id) on delete cascade,
  product_id    bigint not null references public.products(id)    on delete cascade,
  sort_order    int not null default 0,
  primary key (collection_id, product_id)
);

create table public.home_sections (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references public.stores(id) on delete cascade,
  type       public.section_type not null,
  title      jsonb check (title is null or public.is_localized(title)),
  -- banner_carousel: {}                         category_grid: {"category_ids":[...], "columns":4}
  -- product_rail:    {"collection_id":3} or {"category_id":12, "sort":"discount", "limit":12}
  -- collection_rail: {"collection_ids":[...]}   buy_again: {}  (filled per user in Phase 8)
  config     jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  sort_order int not null default 0,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index home_sections_store_idx on public.home_sections (store_id, sort_order) where is_active;
create trigger home_sections_updated_at before update on public.home_sections
  for each row execute function public.set_updated_at();

alter table public.banners             enable row level security;
alter table public.collections         enable row level security;
alter table public.collection_products enable row level security;
alter table public.home_sections       enable row level security;

create policy "banners: read"             on public.banners             for select using (is_active or public.is_staff());
create policy "collections: read"         on public.collections         for select using (is_active or public.is_staff());
create policy "collection_products: read" on public.collection_products for select using (true);
create policy "home_sections: read"       on public.home_sections       for select using (is_active or public.is_staff());

create policy "banners: admin write"             on public.banners             for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "collections: admin write"         on public.collections         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "collection_products: admin write" on public.collection_products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "home_sections: admin write"       on public.home_sections       for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Home in one round-trip. Content is returned in all 3 languages so the cache
-- survives a language switch; p_lang is accepted for future per-language layouts.
create or replace function public.get_home(p_store_id bigint default null, p_lang text default 'en')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store    bigint := coalesce(p_store_id, public.default_store_id());
  v_sections jsonb  := '[]'::jsonb;
  sec        public.home_sections;
  v_payload  jsonb;
  v_ids      bigint[];
  v_limit    int;
begin
  for sec in
    select * from public.home_sections h
     where h.store_id = v_store and h.is_active
       and (h.starts_at is null or h.starts_at <= now())
       and (h.ends_at   is null or h.ends_at   >  now())
     order by h.sort_order, h.id
  loop
    v_payload := null;
    v_limit   := least(coalesce((sec.config->>'limit')::int, 12), 24);

    case sec.type
      when 'banner_carousel' then
        select jsonb_agg(jsonb_build_object('id', b.id, 'image_path', b.image_path,
                                            'title', b.title, 'link', b.link) order by b.sort_order, b.id)
          into v_payload
          from public.banners b
         where b.store_id = v_store and b.is_active
           and (b.starts_at is null or b.starts_at <= now())
           and (b.ends_at   is null or b.ends_at   >  now());

      when 'category_grid' then
        select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name,
                                            'image_path', c.image_path, 'icon', c.icon, 'color', c.color)
                         order by c.sort_order, c.id)
          into v_payload
          from public.categories c
         where c.is_active
           and case when sec.config ? 'category_ids'
                    then c.id in (select (x)::bigint from jsonb_array_elements_text(sec.config->'category_ids') x)
                    else c.parent_id is null end;

      when 'product_rail' then
        if sec.config ? 'collection_id' then
          select array_agg(x.product_id order by x.in_stock desc, x.sort_order)
            into v_ids
            from (select cp.product_id, cp.sort_order,
                         exists (select 1 from public.v_variant_offers o
                                  where o.product_id = cp.product_id and o.store_id = v_store
                                    and o.available_qty > 0) as in_stock
                    from public.collection_products cp
                    join public.products p on p.id = cp.product_id and p.is_active
                   where cp.collection_id = (sec.config->>'collection_id')::bigint
                   order by cp.sort_order
                   limit v_limit) x;
          v_payload := public.catalog_product_cards(v_store, coalesce(v_ids, '{}'::bigint[]));
        elsif sec.config ? 'category_id' then
          v_payload := public.list_products((sec.config->>'category_id')::bigint, '{"in_stock":true}'::jsonb,
                                            coalesce(sec.config->>'sort', 'relevance'), 0, v_limit, v_store)->'items';
        end if;
        if v_payload is not null and jsonb_array_length(v_payload) = 0 then v_payload := null; end if;

      when 'collection_rail' then
        select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title,
                                            'image_path', c.image_path) order by c.id)
          into v_payload
          from public.collections c
         where c.is_active
           and (not (sec.config ? 'collection_ids')
                or c.id in (select (x)::bigint from jsonb_array_elements_text(sec.config->'collection_ids') x));

      when 'buy_again' then
        v_payload := '[]'::jsonb;        -- personalised; the app fetches it separately (Phase 8)

      else
        v_payload := null;
    end case;

    if v_payload is not null then
      v_sections := v_sections || jsonb_build_array(jsonb_build_object(
        'id', sec.id, 'type', sec.type, 'title', sec.title, 'config', sec.config, 'items', v_payload));
    end if;
  end loop;

  return jsonb_build_object('store', public.store_status(v_store), 'sections', v_sections);
end $$;

do $$
begin
  alter publication supabase_realtime add table public.home_sections, public.banners;
exception when duplicate_object then null;
end $$;
```

**Seed (append to `seed.sql`)**
```sql
insert into public.collections (slug, title) values
  ('bestsellers', '{"en":"Bestsellers","mr":"सर्वाधिक विक्री","hi":"बेस्टसेलर"}'),
  ('diwali-specials', '{"en":"Diwali Specials","mr":"दिवाळी स्पेशल","hi":"दिवाली स्पेशल"}');
insert into public.collection_products (collection_id, product_id, sort_order)
select (select id from public.collections where slug='bestsellers'), id, row_number() over ()
from public.products order by id limit 10;

insert into public.banners (store_id, image_path, title, link, sort_order) values
 (public.default_store_id(), 'banners/fresh-veggies.webp', '{"en":"Fresh vegetables every morning"}', '{"type":"category","value":"fresh-vegetables"}', 1),
 (public.default_store_id(), 'banners/diwali.webp',        '{"en":"Diwali specials"}',                 '{"type":"collection","value":"diwali-specials"}', 2);

insert into public.home_sections (store_id, type, title, config, sort_order) values
 (public.default_store_id(), 'banner_carousel', null, '{}', 1),
 (public.default_store_id(), 'buy_again', '{"en":"Buy again","mr":"पुन्हा खरेदी करा","hi":"फिर से खरीदें"}', '{}', 2),
 (public.default_store_id(), 'category_grid', '{"en":"Shop by category","mr":"श्रेणीनुसार खरेदी","hi":"श्रेणी के अनुसार"}', '{"columns":4}', 3),
 (public.default_store_id(), 'product_rail', '{"en":"Bestsellers","mr":"सर्वाधिक विक्री","hi":"बेस्टसेलर"}',
   jsonb_build_object('collection_id', (select id from public.collections where slug='bestsellers')), 4),
 (public.default_store_id(), 'product_rail', '{"en":"Fresh vegetables","mr":"ताज्या भाज्या","hi":"ताज़ी सब्ज़ियाँ"}',
   jsonb_build_object('category_id', (select id from public.categories where slug='fruits-vegetables'), 'sort', 'discount'), 5);
```

### App

**Types (`src/features/catalog/types.ts`)**: RPCs return `Json` in the generated types, so describe the shapes once:
```ts
export type Localized = { en: string; mr?: string; hi?: string };
export type Offer = {
  id: number; label: Localized; mrp: number; price: number; discount_pct: number;
  available_qty: number; low_stock: boolean; max_per_order: number;
};
export type ProductCardData = {
  id: number; slug: string; name: Localized; brand: Localized | null; is_veg: boolean | null;
  category_id: number; attributes: Record<string, unknown>; thumb_path: string | null;
  variant_count: number; variant: Offer;
};
export type SectionType = 'banner_carousel' | 'category_grid' | 'product_rail' | 'collection_rail' | 'buy_again';
export type HomeSection = { id: number; type: SectionType; title: Localized | null; config: any; items: any[] };
export type StoreStatus = {
  store_id: number; name: Localized; city: string; phone: string;
  accepting: boolean; open_now: boolean; is_open: boolean;
  opens_at: string | null; closes_at: string | null; eta_minutes: number;
  message: Localized | null; fees: Record<string, number>; server_time: string;
};
export type HomeData = { store: StoreStatus; sections: HomeSection[] };
```

**API + hook**
```ts
// api.ts
export async function fetchHome(): Promise<HomeData> {
  const { data, error } = await supabase.rpc('get_home', {});
  if (error) throw error;
  return data as unknown as HomeData;
}

// hooks.ts
export const catalogKeys = {
  all: ['catalog'] as const,
  home: () => ['catalog', 'home'] as const,
  categories: () => ['catalog', 'categories'] as const,
  list: (categoryId: number, filters: object, sort: string) => ['catalog', 'list', categoryId, filters, sort] as const,
  product: (slug: string) => ['catalog', 'product', slug] as const,
};
export const useHome = () =>
  useQuery({ queryKey: catalogKeys.home(), queryFn: fetchHome, staleTime: 60_000 });
```

**Section registry (`src/features/home/sections.tsx`)**: the same "registry instead of if/else" idea as the attribute engine.
```tsx
const renderers: Record<SectionType, React.ComponentType<{ section: HomeSection }>> = {
  banner_carousel: BannerCarousel,
  category_grid:   CategoryGrid,
  product_rail:    ProductRail,
  collection_rail: CollectionRail,
  buy_again:       () => null,      // Phase 8 swaps in <BuyAgainRail /> (needs login + orders)
};
export function HomeSectionView({ section }: { section: HomeSection }) {
  const R = renderers[section.type];
  return R ? <R section={section} /> : null;   // unknown future types are skipped, not crashes
}
```

**Home screen (`app/(shop)/index.tsx`)**
```tsx
export default function Home() {
  const { data, isPending, isError, refetch, isRefetching } = useHome();
  if (isPending) return <HomeSkeleton />;
  if (isError && !data) return <ErrorState onRetry={refetch} />;
  return (
    <FlashList
      data={data.sections}
      keyExtractor={(s) => String(s.id)}
      getItemType={(s) => s.type}
      estimatedItemSize={260}
      ListHeaderComponent={<><StoreHeader status={data.store} /><SearchBarButton /></>}
      stickyHeaderIndices={[0]}
      renderItem={({ item }) => <HomeSectionView section={item} />}
      refreshing={isRefetching}
      onRefresh={refetch}
      contentContainerStyle={{ paddingBottom: CART_BAR_SPACE }}
    />
  );
}
```

**Section components (key details)**
- **BannerCarousel:** full-width, 16:7 aspect ratio, horizontal paging list with dots, auto-advance every 4 s **unless** "Reduce motion" is on (`AccessibilityInfo.isReduceMotionEnabled`). Tap → `openLink(banner.link)`, which routes `category → /category/<slug>`, `product → /product/<slug>`, `collection → /collection/<slug>` (Phase 2 adds this list screen), `search → /search?q=`. `accessibilityLabel = localize(banner.title)`.
- **CategoryGrid:** 4 columns on phones (`config.columns`), tile = tinted square (`color` at 12% opacity) with image + 2-line name. Large touch target (whole tile).
- **ProductRail:** title row with "See all ›" (to the collection or category), then a horizontal FlashList of `ProductCard variant="compact"` (width 140).
- **CollectionRail:** round images with titles.

**`SearchBarButton`** is a pressable that looks like an input ("Search \"milk\"") and navigates to `/search` (Phase 2). Until Phase 2 it can be hidden behind a feature flag.

**Checks**
- Reorder `home_sections.sort_order` in Studio, pull to refresh: Home order changes.
- Set a banner's `ends_at` in the past: it disappears.
- A `product_rail` whose products are all out of stock is hidden, not shown empty.

---

## 1.5 Categories tab

**Goal:** a full list of categories grouped by parent, so nothing is more than 2 taps away.

**Files**
```
mobile/src/features/catalog/useCategories.ts
mobile/app/(shop)/categories.tsx
```

Categories are a small table (tens to a few hundred rows), so fetch them **all at once** with a plain select and build the tree on the phone. The result is cached and persisted, and works offline.

```ts
export type Category = Tables<'categories'>;
export type CategoryNode = Category & { children: Category[] };

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id,parent_id,slug,name,icon,image_path,color,sort_order,attribute_schema,filters')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return buildTree(data);
    },
  });
}

function buildTree(rows: Category[]) {
  const parents = rows.filter((r) => r.parent_id == null).map((p) => ({ ...p, children: [] as Category[] }));
  const byId = new Map(parents.map((p) => [p.id, p]));
  for (const r of rows) if (r.parent_id != null) byId.get(r.parent_id)?.children.push(r);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return { parents, bySlug, byId: new Map(rows.map((r) => [r.id, r])) };
}
```

**Screen:** a `SectionList` where each parent is a section header and its sub-categories are a 4-column grid of tiles (image + name). Tapping a sub-category opens `/category/<parent-slug>?sub=<sub-slug>`, which opens the category screen with that sub-category already selected.

**Checks**
- Deactivate a sub-category in Studio and pull to refresh: it disappears from both tabs and the rail.

---

## 1.6 Category screen (sub-category rail + grid)

**Goal:** the signature Blinkit screen: a narrow vertical rail of sub-categories on the left and products on the right.

**Files**
```
mobile/app/category/[slug].tsx
mobile/src/features/catalog/SubcategoryRail.tsx
mobile/src/features/catalog/useProductList.ts
mobile/src/features/catalog/ProductGrid.tsx
```

**Layout**
```
┌───────────────────────────────────────────┐
│ ←  Dairy, Bread & Eggs              🔍    │  header tinted with category.color
├───────┬───────────────────────────────────┤
│ [img] │ [Sort ▾] [Filters] [Organic] [Veg]│  chips (Phase 2 wires the sheet)
│ Milk ▌│ ┌─────────┐ ┌─────────┐           │
│ [img] │ │  image  │ │  image  │           │
│ Curd  │ │  [ADD]  │ │ [−1+]   │           │
│ [img] │ │ 500 ml  │ │ 1 l     │           │
│ Bread │ │ Amul…   │ │ Gokul…  │           │
│ [img] │ │ ₹28     │ │ ₹54 ₹56 │           │
│ Eggs  │ └─────────┘ └─────────┘           │
├───────┴───────────────────────────────────┤
│ 3 items · ₹136                View cart › │
└───────────────────────────────────────────┘
```

**Route logic**
- `slug` can be a **parent** or a **sub-category**. If it's a sub-category, use its parent for the rail and select it.
- `?sub=<slug>` selects a sub-category (from the Categories tab or a deep link). Default = first child.
- The rail is 80–88 dp wide: round image, 2-line name (12–13 sp), selected item has a coloured bar on the right and a bold label. With font scaling above 1.3 the rail widens to 104 dp.

```tsx
export default function CategoryScreen() {
  const { slug, sub } = useLocalSearchParams<{ slug: string; sub?: string }>();
  const { data: cats } = useCategories();
  const cat = cats?.bySlug.get(slug);
  const parent = cat?.parent_id ? cats!.byId.get(cat.parent_id)! : cat;
  const children = useMemo(() => cats?.parents.find((p) => p.id === parent?.id)?.children ?? [], [cats, parent]);
  const [selected, setSelected] = useState<number | undefined>();
  const activeId = selected ?? (cat?.parent_id ? cat.id : children.find((c) => c.slug === sub)?.id ?? children[0]?.id);
  const [filters, setFilters] = useState<ProductFilters>({});
  const [sort, setSort] = useState<SortKey>('relevance');

  if (!cats) return <CategorySkeleton />;
  if (!parent) return <EmptyState title={t('category.notFound')} />;

  return (
    <Screen header={<CategoryHeader category={parent} />}>
      <View className="flex-1 flex-row">
        <SubcategoryRail items={children} activeId={activeId}
          onSelect={(id) => { setSelected(id); setFilters({}); }} color={parent.color} />
        <View className="flex-1">
          <FilterChips category={cats.byId.get(activeId!)} parent={parent}
            filters={filters} onChange={setFilters} sort={sort} onSort={setSort} />
          {activeId && <ProductGrid categoryId={activeId} filters={filters} sort={sort} />}
        </View>
      </View>
      <CartBar />
    </Screen>
  );
}
```

**Infinite list hook**
```ts
export function useProductList(categoryId: number, filters: ProductFilters, sort: SortKey) {
  return useInfiniteQuery({
    queryKey: catalogKeys.list(categoryId, filters, sort),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await supabase
        .rpc('list_products', { p_category_id: categoryId, p_filters: toRpcFilters(filters),
                                p_sort: sort, p_page: pageParam, p_size: 20 })
        .abortSignal(signal);
      if (error) throw error;
      return data as unknown as { items: ProductCardData[]; has_more: boolean; page: number };
    },
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,     // switching sub-category doesn't flash empty
    staleTime: 30_000,
  });
}
```

**`ProductGrid`**: FlashList, `numColumns={2}` (3 when the right pane is wider than 480 dp, e.g. tablets), `onEndReached` → `fetchNextPage`, footer spinner, `estimatedItemSize={250}`. Memoise `renderItem` and `ProductCard`.

**Checks**
- Open `/category/milk`: rail shows Dairy's children with Milk selected.
- Scroll 3 pages: no duplicates, no jumps; switching sub-category resets scroll to top.

**Tests**
- `buildTree` unit test (orphans ignored, order kept).
- RNTL: tapping a rail item calls `list_products` with that `categoryId`.

---

## 1.7 Product card & ADD stepper

**Goal:** the most-used component in the app. It must be fast, clear in 3 languages, and correct about stock.

**Files**
```
mobile/src/features/catalog/components/ProductCard.tsx
mobile/src/features/catalog/components/AddButton.tsx
mobile/src/features/catalog/components/VariantSheet.tsx
mobile/src/ui/PriceTag.tsx
mobile/src/ui/VegMark.tsx
```

**Card anatomy (2-column grid)**
```
┌──────────────────┐
│ [-12%]       [♥] │  discount ribbon (if > 0); wishlist heart arrives in Phase 8
│      image       │
│              ADD │  ADD sits on the image's bottom-right corner (thumb reach)
├──────────────────┤
│ ⏱ 20 MINS        │  from store_status.eta_minutes
│ ● Amul Taaza     │  VegMark + 2-line name (localized)
│   Toned Milk     │
│ 500 ml ▾         │  ▾ only when variant_count > 1
│ ₹28  ~~₹32~~     │
│ Only 3 left      │  low_stock
└──────────────────┘
```

**States**

| State | What shows |
|---|---|
| In stock, not in cart | Green-outlined **ADD** |
| In cart | Solid green `− 2 +` stepper |
| Low stock | "Only {n} left" in amber under the price |
| At limit | `+` disabled; tap shows toast "Only {n} available" or "Max {n} per order" |
| Out of stock | Image greyed, ADD replaced by "Notify me" (Phase 2.6); stepper shown if it's already in the cart, so the user can reduce it |
| Several variants | ADD opens `VariantSheet` (list of variants each with its own stepper); label shows "2 options" |

**`AddButton.tsx`**
```tsx
type Props = { productId: number; offer: Offer; variantCount: number; onPickVariant?: () => void; size?: 'sm' | 'lg' };

export const AddButton = memo(function AddButton({ productId, offer, variantCount, onPickVariant, size = 'sm' }: Props) {
  const live = useLiveOffer(offer);                    // 1.10: realtime overlay
  const qty = useCartQty(live.id);
  const setQty = useGuestCart((s) => s.setQty);
  const { t } = useTranslation();

  const change = (next: number) => {
    if (next > qty && next > live.available_qty) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast(live.available_qty < live.max_per_order
        ? t('stock.onlyAvailable', { count: live.available_qty })
        : t('stock.maxPerOrder', { count: live.max_per_order }));
      return;
    }
    Haptics.selectionAsync();
    setQty({ variantId: live.id, productId, price: live.price, mrp: live.mrp }, next);
  };

  if (qty === 0) {
    if (live.available_qty === 0) return <NotifyMeButton variantId={live.id} size={size} />;   // Phase 2.6
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('cart.add')}
        onPress={() => (variantCount > 1 && onPickVariant ? onPickVariant() : change(1))}
        hitSlop={8}
        className="min-w-[64px] min-h-[36px] rounded-lg border border-brand bg-surface items-center justify-center">
        <Text className="text-brand font-bold">{t('cart.addCaps')}</Text>
        {variantCount > 1 && <Text className="text-[10px] text-muted">{t('product.options', { count: variantCount })}</Text>}
      </Pressable>
    );
  }
  return (
    <Stepper
      value={qty}
      onDecrement={() => change(qty - 1)}
      onIncrement={() => change(qty + 1)}
      incrementDisabled={qty >= live.available_qty}
      accessibilityLabel={t('cart.qtyLabel', { count: qty })}
    />
  );
});
```

`Stepper` (in `src/ui/`) exposes `accessibilityRole="adjustable"` with `accessibilityActions` increment/decrement, so TalkBack users can swipe up/down to change the quantity.

**`PriceTag`**: `₹28` bold, MRP struck through only when `mrp > price`, discount computed by the server (`discount_pct`). Use the Phase 0 `formatINR()` (Indian grouping, no decimals when whole).

**Performance rules**
- `ProductCard` is `memo`'d and receives a stable `item` object. No inline closures created per render in the list.
- Each card subscribes to **its own** cart qty (`useCartQty(variantId)`), so adding one item re-renders one card, not the grid.

**Checks**
- ADD → 1 → + to `max_per_order` → + shows the limit toast.
- The out-of-stock 10 kg atta can't be added; the 5 kg can.

**Tests (RNTL)**
- Card renders all states from fixtures (in stock, low, out, multi-variant).
- `+` beyond `available_qty` doesn't change the cart and shows the toast.

---

## 1.8 Product detail & variants

**Goal:** everything a buyer needs to decide, plus everything the law requires to be shown (Plan §11).

**Files**
```
mobile/app/product/[slug].tsx
mobile/src/features/catalog/useProduct.ts
mobile/src/features/catalog/components/Gallery.tsx
mobile/src/features/catalog/components/VariantPicker.tsx
mobile/src/features/catalog/components/MandatoryInfo.tsx
mobile/src/features/catalog/components/ProductBottomBar.tsx
```

**Data:** `get_product(p_slug)` (SQL in 1.1) returns product, brand, category (+ parent), `attribute_fields`, variants with live offers, images and seller details in **one call**.

```ts
export function useProduct(slug: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: catalogKeys.product(slug),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('get_product', { p_slug: slug }).abortSignal(signal);
      if (error) throw error;
      if (!data) throw new NotFoundError();
      return data as unknown as ProductDetail;
    },
    // Show the card data instantly while the detail loads (came from a list)
    placeholderData: () => findCardInCache(qc, slug),
  });
}
```

**Screen sections (top to bottom)**
1. **Gallery**: horizontal paging list of `full` images with dots. When the selected variant has its own images, those come first. Double-tap/pinch zoom is optional (`react-native-gesture-handler` + Reanimated).
2. **Title block**: brand (tap → search by brand in Phase 2), name, `VegMark`, ETA chip.
3. **VariantPicker**: horizontal chips "500 ml · ₹28", selected chip outlined; out-of-stock chips are greyed with "Out of stock" text, still selectable (so the user can tap "Notify me"). The selected variant id lives in the URL (`?v=`), so share links and back navigation keep it.
4. **Price block**: `₹54  MRP ₹56  (4% OFF)` and the line **"(Inclusive of all taxes)"**.
5. **Highlights**: attribute fields with values, rendered by the registry (1.9).
6. **Description** (localized, "Read more" after 4 lines).
7. **Product details (mandatory info)**: `MandatoryInfo` lists **net quantity** (from the variant), **MRP**, **manufacturer** (`manufacturer`), **country of origin**, **shelf life**, **seller name & address**, **FSSAI licence** (from `seller`). Admin-side these fields become required in Phase 7.
8. **Similar products** rail (Phase 2.7).
9. Sticky **`ProductBottomBar`**: selected variant's price + large `AddButton size="lg"`; when the cart has items, a second "View cart ›" button appears.

**Not found:** if the product was deactivated (old share link), show "This product is no longer available" with a "See similar in {category}" button.

**Checks**
- Switch variants: price, stock, images and the ADD button follow the selection.
- Deep link `nearkart://product/amul-taaza-toned-milk?v=<id>` opens with that variant selected.

---

## 1.9 Attribute display registry

**Goal:** show admin-defined attributes (from `attribute_schema`) on product detail and as badges on cards, without any category-specific code. Phase 7 adds the **input** half of the same registry.

**Files**
```
mobile/src/features/attributes/types.ts
mobile/src/features/attributes/registry.tsx
mobile/src/features/attributes/mergeFields.ts
mobile/src/features/attributes/Highlights.tsx
```

**Types**
```ts
export type FieldType = 'text' | 'localizedText' | 'number' | 'boolean' | 'select' | 'multiSelect' | 'localizedList' | 'date';
export type AttributeField = {
  key: string; type: FieldType; label: Localized; unit?: string;
  options?: { value: string; label: Localized }[];
  filterable?: boolean; badge?: boolean; required?: boolean; hidden?: boolean;
};
```

**Merging parent + child schema** (child overrides a parent field with the same key; `hidden: true` removes it):
```ts
export function mergeFields(fields: AttributeField[]): AttributeField[] {
  const map = new Map<string, AttributeField>();
  for (const f of fields) map.set(f.key, f);         // get_product sends parent first, then child
  return [...map.values()].filter((f) => !f.hidden);
}
```

**Registry**
```tsx
type DisplayProps = { field: AttributeField; value: unknown };
const optionLabel = (f: AttributeField, v: string) => localize(f.options?.find((o) => o.value === v)?.label) || v;

export const displayRegistry: Record<FieldType, React.ComponentType<DisplayProps>> = {
  text:          ({ field, value }) => <Row label={field.label} value={String(value)} />,
  localizedText: ({ field, value }) => <Row label={field.label} value={localize(value as Localized)} />,
  number:        ({ field, value }) => <Row label={field.label} value={`${formatNumber(Number(value))}${field.unit ? ' ' + field.unit : ''}`} />,
  boolean:       ({ field, value }) => (value === true ? <CheckChip label={field.label} /> : null),
  select:        ({ field, value }) => <Row label={field.label} value={optionLabel(field, String(value))} />,
  multiSelect:   ({ field, value }) => <ChipsRow label={field.label} items={(value as string[]).map((v) => optionLabel(field, v))} />,
  localizedList: ({ field, value }) => <ChipsRow label={field.label} items={(value as Localized[]).map(localize)} />,
  date:          ({ field, value }) => <Row label={field.label} value={formatDate(String(value))} />,
};

const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

export function Highlights({ fields, attributes }: { fields: AttributeField[]; attributes: Record<string, unknown> }) {
  const visible = mergeFields(fields).filter((f) => !isEmpty(attributes[f.key]) && displayRegistry[f.type]);
  if (!visible.length) return null;
  const booleans = visible.filter((f) => f.type === 'boolean');
  const rows = visible.filter((f) => f.type !== 'boolean');
  return (
    <Section title={t('product.highlights')}>
      {rows.map((f) => { const D = displayRegistry[f.type]; return <D key={f.key} field={f} value={attributes[f.key]} />; })}
      {booleans.length > 0 && <View className="flex-row flex-wrap gap-2">
        {booleans.map((f) => { const D = displayRegistry.boolean; return <D key={f.key} field={f} value={attributes[f.key]} />; })}
      </View>}
    </Section>
  );
}
```

**Card badges:** fields with `badge: true` and a truthy value show as a small chip on the card image (e.g. "Organic"). The card has `category_id` and `attributes`, and `useCategories()` provides the schema, so this costs no extra request.

**Tests**
- Each field type renders a sample value in EN and MR; unknown types render nothing; empty values are skipped.
- `mergeFields` child overrides parent; `hidden` removes.

---

## 1.10 Live stock & price via Realtime

**Goal:** when stock or price changes on the server (Studio now, orders in Phase 4, staff in Phase 6), every open screen reflects it within about a second.

**Files**
```
mobile/src/lib/realtime.ts
mobile/src/features/catalog/liveOffers.ts
mobile/src/features/catalog/useCatalogRealtime.ts
mobile/app/(shop)/_layout.tsx               (mount useCatalogRealtime)
```

### Approach

1. **One channel per topic for the whole app**, not one per product card. For a single store this is 2 channels: `inventory:store=<id>` and `variants:prices`. A ref-counted manager opens a channel when the first screen needs it and closes it when the last one leaves.
2. **Events patch a small "live overlay" store** keyed by `variant_id`. Cards read `useLiveOffer(offer)`, which returns the server offer merged with the latest live values. No list refetch is needed, so a busy evening with hundreds of stock changes doesn't hammer the database.
3. **Realtime is a hint, not the source of truth.** When a channel reconnects after an error, or the app returns to the foreground, the overlay is cleared and catalog queries are invalidated, so any missed event is corrected by a normal fetch.

**`src/lib/realtime.ts`**
```ts
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Entry = { channel: RealtimeChannel; refs: number; resync: Set<() => void> };
const entries = new Map<string, Entry>();

/**
 * Get (or create) a channel by name. `setup` attaches listeners before subscribe().
 * `onResync` runs when the channel comes back after an error/timeout.
 * Returns a release function. Call it on unmount/blur.
 */
export function acquireChannel(
  name: string,
  setup: (ch: RealtimeChannel) => RealtimeChannel,
  onResync?: () => void,
) {
  let entry = entries.get(name);
  if (!entry) {
    const resync = new Set<() => void>();
    let wasDown = false;
    const channel = setup(supabase.channel(name)).subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (wasDown) resync.forEach((fn) => fn());
        wasDown = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        wasDown = true;                       // supabase-js retries automatically
      }
    });
    entry = { channel, refs: 0, resync };
    entries.set(name, entry);
  }
  entry.refs += 1;
  if (onResync) entry.resync.add(onResync);

  return () => {
    const e = entries.get(name);
    if (!e) return;
    if (onResync) e.resync.delete(onResync);
    e.refs -= 1;
    if (e.refs <= 0) {
      supabase.removeChannel(e.channel);
      entries.delete(name);
    }
  };
}

/** Run `fn` whenever the app comes back to the foreground. */
export function onForeground(fn: () => void) {
  let last = AppState.currentState;
  const sub = AppState.addEventListener('change', (next) => {
    if (last.match(/inactive|background/) && next === 'active') fn();
    last = next;
  });
  return () => sub.remove();
}
```

**`src/features/catalog/liveOffers.ts`**
```ts
type LiveInventory = { stock: number; is_available: boolean; low_stock_threshold: number };
type LiveVariant = { price: number; mrp: number; is_active: boolean; max_per_order: number };

export const useLiveOffers = create<{
  inv: Record<number, LiveInventory>;
  vars: Record<number, LiveVariant>;
  patchInv: (variantId: number, v: LiveInventory) => void;
  patchVar: (variantId: number, v: LiveVariant) => void;
  reset: () => void;
}>((set) => ({
  inv: {}, vars: {},
  patchInv: (id, v) => set((s) => ({ inv: { ...s.inv, [id]: v } })),
  patchVar: (id, v) => set((s) => ({ vars: { ...s.vars, [id]: v } })),
  reset: () => set({ inv: {}, vars: {} }),
}));

/** Server offer + latest live values. Overlay values are always newer than any fetch made before them. */
export function useLiveOffer(offer: Offer): Offer {
  const inv = useLiveOffers((s) => s.inv[offer.id]);
  const vr  = useLiveOffers((s) => s.vars[offer.id]);
  return useMemo(() => {
    if (!inv && !vr) return offer;
    const price = vr?.price ?? offer.price;
    const mrp = vr?.mrp ?? offer.mrp;
    const max = vr?.max_per_order ?? offer.max_per_order;
    const sellable = (vr?.is_active ?? true) && (inv?.is_available ?? true);
    const available_qty = !sellable ? 0
      : inv ? Math.min(Math.max(inv.stock, 0), max)
      : Math.min(offer.available_qty, max);
    return {
      ...offer, price, mrp, max_per_order: max, available_qty,
      discount_pct: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
      low_stock: inv ? available_qty > 0 && inv.stock <= inv.low_stock_threshold : offer.low_stock,
    };
  }, [offer, inv, vr]);
}
```

**`src/features/catalog/useCatalogRealtime.ts`** (mounted once in `(shop)/_layout.tsx`, and in the product/category stacks)
```ts
export function useCatalogRealtime(storeId: number | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!storeId) return;
    const { patchInv, patchVar, reset } = useLiveOffers.getState();
    const resync = () => { reset(); qc.invalidateQueries({ queryKey: catalogKeys.all }); };

    const releaseInv = acquireChannel(`inventory:store=${storeId}`, (ch) =>
      ch.on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'inventory', filter: `store_id=eq.${storeId}` },
        ({ new: row }: any) => patchInv(row.variant_id, {
          stock: Number(row.stock), is_available: row.is_available,
          low_stock_threshold: Number(row.low_stock_threshold),
        })), resync);

    const releaseVar = acquireChannel('variants:prices', (ch) =>
      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'product_variants' },
        ({ new: row }: any) => patchVar(row.id, {
          price: Number(row.price), mrp: Number(row.mrp),
          is_active: row.is_active, max_per_order: Number(row.max_per_order),
        })), resync);

    const offFg = onForeground(resync);
    return () => { releaseInv(); releaseVar(); offFg(); };
  }, [storeId, qc]);
}
```

**Free-tier notes ⚠️**
- Each open app = 1 Realtime connection (channels are multiplexed over one socket). The free tier allows roughly 200 concurrent connections, which is plenty for one town at first. Watch **Realtime → Reports** in the dashboard.
- Close catalog channels when the app is backgrounded for more than 30 s (supabase-js keeps the socket otherwise). Add this to `onForeground`'s counterpart if connection counts get high.
- New products (INSERTs) don't need Realtime: they appear on the next refetch (`staleTime` 30–60 s, pull to refresh).

**Checks**
- With the category screen open, set the 500 ml milk's stock to 0 in Studio: the card greys out and shows "Notify me" in about 1 s.
- Change its price to ₹30: price and discount update; the cart bar total updates on the next quantity change (Phase 4 re-quotes properly).
- Turn Wi-Fi off for 1 minute, change stock in Studio, turn Wi-Fi on: the screen corrects itself (resync).

**Tests**
- Unit: `useLiveOffer` math (stock above max → max; unavailable → 0; price change → new discount).
- Unit: `acquireChannel` ref counting (two acquires + one release keeps the channel; second release removes it) with a mocked client.

---

## 1.11 Store status header

**Goal:** the customer always knows whether the store can take an order right now, and how fast it delivers.

**Files**
```
mobile/src/features/store/useStoreStatus.ts
mobile/src/features/store/StoreHeader.tsx
mobile/src/features/store/ClosedBanner.tsx
```

`store_status()` (SQL in 1.1) works out open/closed from `opening_hours` in the store's time zone plus the `is_accepting_orders` switch, and returns the next opening time.

```ts
export function useStoreStatus() {
  const qc = useQueryClient();
  const home = qc.getQueryData<HomeData>(catalogKeys.home());
  const query = useQuery({
    queryKey: ['store', 'status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('store_status', {});
      if (error) throw error;
      return data as unknown as StoreStatus;
    },
    initialData: home?.store,                // Home already returned it
    refetchInterval: 60_000,                 // crosses opening/closing time without an event
  });

  const storeId = query.data?.store_id;
  useEffect(() => {
    if (!storeId) return;
    return acquireChannel(`store:${storeId}`, (ch) =>
      ch.on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` },
        () => qc.invalidateQueries({ queryKey: ['store', 'status'] })));
  }, [storeId, qc]);

  return query;
}
```

**Header (Blinkit style)**
```
Delivery in 20 minutes                (bold, large)
📍 Amravati ▾                          (Phase 3: "Home · Rajapeth, Amravati")      [👤]
```

| Status | Header | Extra |
|---|---|---|
| `is_open` | "Delivery in {eta} minutes" | — |
| `open_now` but `!accepting`, with `message` | "{message}" (e.g. "Very busy, back in 30 min") | Amber `ClosedBanner` |
| closed, `opens_at` today | "Store closed · Opens at 4:00 PM" | Grey banner; ADD still works (you can fill the cart), checkout is blocked (Phase 4) |
| closed, `opens_at` tomorrow | "Opens tomorrow at 7:00 AM" | Same |

Format times with the phone's 12-hour preference in the selected language (Phase 0 `formatTime`). The ETA chip on cards (`⏱ 20 MINS`) reads the same query.

**Checks**
- In Studio, set `is_accepting_orders = false`: the header changes in about 1 s.
- Set Sunday's hours to a slot that ended 1 minute ago: within 60 s the header shows the next opening.

**Tests (pgTAP)**
```sql
-- open_now is false outside hours, and opens_at points to the next slot
update public.stores set opening_hours = jsonb_build_object(
  lower(to_char(now() at time zone 'Asia/Kolkata', 'dy')),
  jsonb_build_array(jsonb_build_object('open', '00:00', 'close', '00:01')));
select ok(not (public.store_status()->>'open_now')::boolean, 'closed outside hours');
```

---

## 1.12 Loading / empty / error / offline

**Goal:** the app never shows a blank screen or a raw error, even on 2G or with no network.

**Files**
```
mobile/src/ui/Skeleton.tsx                 (from Phase 0)
mobile/src/features/catalog/components/ProductCardSkeleton.tsx
mobile/src/features/home/HomeSkeleton.tsx
mobile/src/ui/OfflineBanner.tsx
mobile/src/lib/network.ts
```

| Situation | Behaviour |
|---|---|
| First load | Skeletons shaped like the real layout (header, banner block, 4×2 category tiles, card grid). No spinners on full screens. |
| Refetching with cached data | Show cached data; small spinner only on pull-to-refresh. |
| Empty category / filters match nothing | `EmptyState` with an illustration: "No products here yet" / "Nothing matches these filters" + **Clear filters** button. |
| Error with no cache | `ErrorState`: "Couldn't load. Check your internet." + **Retry**. Log the error (Sentry in Phase 9). |
| Offline | `OfflineBanner` at the top: "You're offline. Showing saved data." ADD still works (guest cart is local). |
| Image fails | Placeholder stays; no broken-image icon. |

**`src/lib/network.ts`** (if Phase 0 didn't already wire this)
```ts
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)));

export const useIsOnline = () => useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
```

**Persisted cache whitelist** (Phase 0's MMKV persister): persist `['catalog','home']`, `['catalog','categories']`, the first page of each `['catalog','list',…]` visited, and the last 30 `['catalog','product',…]`. Don't persist search results or the store status (time-sensitive).

**Checks**
- Fresh install with airplane mode: Language → Home shows a friendly offline error with Retry, not a crash.
- Browse, then airplane mode, kill and reopen: Home and visited categories show with the offline banner.

---

## Testing for Phase 1

| Layer | What |
|---|---|
| pgTAP (`supabase test db`) | RLS (anon read-only, inactive rows hidden, inventory unwritable); `list_products` sorting, OOS-last, filters, pagination `has_more`; `catalog_product_cards` default-variant choice; `store_status` open/closed/next opening; `get_home` skips empty rails and expired banners; 2-level category trigger; product-in-parent rejected |
| Jest | `localize`, `buildTree`, `mergeFields`, `useLiveOffer` math, guest cart `setQty` (0 removes), `acquireChannel` ref counting, `openLink` routing |
| RNTL | `ProductCard` states, `AddButton` limits, `Highlights` per field type, `SubcategoryRail` selection, `StoreHeader` variants |
| Maestro | `browse.yaml`: language → Home → tap category tile → tap sub-category → ADD twice → cart bar shows "2 items" → open product → switch variant |
| Manual | 2 GB Android: scroll a 60-product category with no dropped frames; all 3 languages with font scale 1.3; TalkBack reads card as "Amul Taaza Toned Milk, 500 ml, ₹28, MRP ₹32, 12% off, Add" |

## Phase 1 wrap-up

- **Migrations:** `0100_catalog.sql`, `0110_home.sql` (+ `seed.sql`, `seed/products.csv`)
- **New SQL objects:** `stores`, `categories`, `brands`, `products`, `product_variants`, `product_images`, `inventory`, `banners`, `collections`, `collection_products`, `home_sections`, view `v_variant_offers`; functions `is_localized`, `normalize_search`, `default_store_id`, `product_matches_filters`, `catalog_product_cards`, `list_products`, `get_product`, `store_status`, `get_home`; `catalog` bucket.
- **Re-run** `supabase gen types typescript --local > mobile/src/types/database.ts` and commit it.
- **Hand-off to Phase 2:** `search_text` is already maintained; Phase 2 only adds the search functions, the filter sheet behind `FilterChips`, `NotifyMeButton`, and the Similar rail.
- **Hand-off to Phase 4:** the guest cart (`useGuestCart`) and `useLiveOffer` are reused; Phase 4 swaps the cart bar total for the server quote.
