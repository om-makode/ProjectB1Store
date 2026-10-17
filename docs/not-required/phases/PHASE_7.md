# Phase 7: Admin: Catalog, Merchandising & Reports

> **Goal:** the owner runs the whole catalog **without a developer and without Supabase Studio**: new categories with their own attributes, products and variants with legal info and photos, bulk CSV import, banners and home layout, fees and store settings, staff roles, and a dashboard that says what to stock next.
> **Duration:** about 1.5–2 weeks · **Depends on:** Phase 6 (Store Operations) · **Next:** Phase 8 (Engagement & Growth)

**Done when:**
- [ ] An admin creates a **new category + sub-category with custom attributes** from a tablet or the web admin, adds a product with 2 variants and photos, and a guest sees it on Home / in the category / in search **with no app release**
- [ ] The attribute builder's **live preview** uses the real `ProductCard`, product detail "Highlights" and `FilterSheet` components, in all 3 languages
- [ ] Saving a product with a missing legal field (manufacturer, country of origin, net quantity, MRP) is blocked **in the form and in Postgres**
- [ ] A 300-row CSV imports with a **dry run** first; bad rows are listed with row numbers and reasons; Marathi/Hindi text survives Excel round-trips
- [ ] Banners and home sections can be scheduled ("Diwali 1–5 Nov") and reordered; customers see the change on their next Home refresh
- [ ] Fees, minimum order, COD limit, service radius and opening hours are editable with validation and an audit trail
- [ ] Staff/admin roles are granted from the app; the last admin can't be removed
- [ ] Dashboard shows today's numbers, a 14-day sales chart, top products, low stock, zero-result searches (with "add synonym") and cancellation reasons
- [ ] Every admin RPC returns `42501` for customers and staff (pgTAP)

| # | Heading | Output |
|---|---|---|
| 7.0 | Migration `0700_admin.sql` | Validation, admin RPCs, policies, audit, report views |
| 7.1 | Admin shell & web build | `app/admin/*`, role guard, responsive layout, Cloudflare Pages deploy |
| 7.2 | Category & sub-category editor | Category list, editor, reorder, activate |
| 7.3 | Attribute schema builder + live preview | Field builder, filters editor, preview pane, safe evolution |
| 7.4 | Product & variant editor (runtime zod) | Product form, attribute inputs, variants, legal & tax |
| 7.5 | Image upload (2 sizes) | Picker → WebP full + thumb (+ share JPEG) → Storage; bulk matcher by SKU |
| 7.6 | CSV import/export | Template, dry run, error table, export with BOM |
| 7.7 | Banners, home sections, collections | Scheduling, link picker, ordering, collection products |
| 7.8 | Store settings & fees | Fees, hours, service area, legal IDs, app config |
| 7.9 | Users & roles | Search users, grant staff/admin, block, COD switch |
| 7.10 | Dashboard & reports | Tiles, charts, top products, low stock, zero-result → synonyms, cancellations |

> **Rule from the plan, kept here:** simple merchandising tables (categories, banners, home sections, collections, synonyms) are written **directly** through PostgREST, protected by admin-only RLS. Anything with **money, stock or roles** (products/variants, imports, store fees, roles) goes through an **RPC** that validates and writes an audit row.

---

## 7.0 Migration `0700_admin.sql`

**Goal:** one migration that adds everything the admin screens need. Each part is referenced by the headings below.

**Assumptions from earlier phases** (check them against your migrations before running):
- `public.is_admin()` / `public.is_staff()` exist (Phase 0) and `is_staff()` is true for admins too.
- The Phase 0 role-protection trigger lets a role/`is_blocked`/`cod_allowed` change through **when `public.is_admin()` is true** for the calling user. The RPCs below also set `app.role_change = on` for the transaction, in case your trigger checks that flag instead.
- PostGIS, `unaccent` and `pg_trgm` live in the `extensions` schema (Supabase default).
- `products.search_text` is maintained by the Phase 1/2 trigger, and `notify_back_in_stock` fires on `inventory` updates (Phase 2).

**File:** `supabase/migrations/0700_admin.sql`

```sql
-- =====================================================================
-- 0700_admin.sql  ·  Phase 7: admin catalog, merchandising & reports
-- =====================================================================

-- ---------------------------------------------------------------------
-- Part A. Audit log (who changed prices, fees, roles)
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,          -- 'product_upsert' | 'price_change' | 'store_settings' | 'role_change' | 'user_block' | 'import'
  entity      text not null,          -- 'product' | 'product_variant' | 'store' | 'profile'
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_log_entity_idx on public.admin_audit_log (entity, entity_id, created_at desc);
alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_admin_select on public.admin_audit_log;
create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated using (public.is_admin());
-- no insert/update/delete policies: only security definer functions write here

-- ---------------------------------------------------------------------
-- Part B. Helpers: slugify, CSV parsing
-- ---------------------------------------------------------------------
create or replace function public.slugify(p_text text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g')), '');
$$;

create or replace function public.csv_bool(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or trim(p_value) = '' then return null; end if;
  if lower(trim(p_value)) in ('true','yes','y','1','veg','हो','होय','हाँ','हां') then return true; end if;
  if lower(trim(p_value)) in ('false','no','n','0','non-veg','nonveg','नाही','नहीं') then return false; end if;
  raise exception '"%" is not yes/no', p_value using errcode = '22023';
end $$;

create or replace function public.csv_localized(p_row jsonb, p_prefix text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'en', nullif(trim(p_row->>(p_prefix || '_en')), ''),
    'mr', nullif(trim(p_row->>(p_prefix || '_mr')), ''),
    'hi', nullif(trim(p_row->>(p_prefix || '_hi')), '')));
$$;

-- ---------------------------------------------------------------------
-- Part C. Attribute schema: effective schema (parent + child) & validation
-- ---------------------------------------------------------------------
-- Sub-categories inherit the parent's fields; a child field with the same key overrides it.
create or replace function public.effective_attribute_schema(p_category_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  with c as (
    select id, parent_id, attribute_schema from public.categories where id = p_category_id
  ),
  all_fields as (
    select f.value as field, 0 as lvl, f.ordinality as ord
    from public.categories p
    join c on c.parent_id = p.id
    cross join lateral jsonb_array_elements(coalesce(p.attribute_schema->'fields', '[]'::jsonb)) with ordinality f
    union all
    select f.value, 1, f.ordinality
    from c
    cross join lateral jsonb_array_elements(coalesce(c.attribute_schema->'fields', '[]'::jsonb)) with ordinality f
  ),
  winners as (
    select distinct on (field->>'key') field, lvl, ord
    from all_fields
    order by field->>'key', lvl desc
  )
  select jsonb_build_object('fields', coalesce(jsonb_agg(field order by lvl, ord), '[]'::jsonb))
  from winners;
$$;

-- Returns a list of human-readable errors (empty array = valid).
create or replace function public.validate_attributes(p_schema jsonb, p_attrs jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  f      jsonb;
  k      text;
  t      text;
  v      jsonb;
  el     jsonb;
  errs   text[] := '{}';
  known  text[] := '{}';
begin
  p_attrs := coalesce(p_attrs, '{}'::jsonb);
  if jsonb_typeof(p_attrs) <> 'object' then
    return array['attributes must be an object'];
  end if;

  for f in select value from jsonb_array_elements(coalesce(p_schema->'fields', '[]'::jsonb)) loop
    k := f->>'key';
    t := f->>'type';
    known := known || k;
    v := p_attrs->k;

    if v is null or v = 'null'::jsonb then
      if coalesce((f->>'required')::boolean, false) and not coalesce((f->>'deprecated')::boolean, false) then
        errs := errs || format('%s: required', k);
      end if;
      continue;
    end if;

    case t
      when 'text' then
        if jsonb_typeof(v) <> 'string' then errs := errs || format('%s: must be text', k); end if;
      when 'localizedText' then
        if jsonb_typeof(v) <> 'object' or coalesce(v->>'en', '') = '' then
          errs := errs || format('%s: needs English text', k);
        end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then
          errs := errs || format('%s: must be a number', k);
        elsif f ? 'min' and (v #>> '{}')::numeric < (f->>'min')::numeric then
          errs := errs || format('%s: must be at least %s', k, f->>'min');
        elsif f ? 'max' and (v #>> '{}')::numeric > (f->>'max')::numeric then
          errs := errs || format('%s: must be at most %s', k, f->>'max');
        end if;
      when 'boolean' then
        if jsonb_typeof(v) <> 'boolean' then errs := errs || format('%s: must be yes/no', k); end if;
      when 'select' then
        if jsonb_typeof(v) <> 'string' or not exists (
             select 1 from jsonb_array_elements(coalesce(f->'options', '[]'::jsonb)) o
             where o->>'value' = v #>> '{}') then
          errs := errs || format('%s: "%s" is not one of the options', k, v #>> '{}');
        end if;
      when 'multiSelect' then
        if jsonb_typeof(v) <> 'array' then
          errs := errs || format('%s: must be a list', k);
        else
          for el in select value from jsonb_array_elements(v) loop
            if not exists (select 1 from jsonb_array_elements(coalesce(f->'options', '[]'::jsonb)) o
                           where o->>'value' = el #>> '{}') then
              errs := errs || format('%s: "%s" is not one of the options', k, el #>> '{}');
            end if;
          end loop;
        end if;
      when 'localizedList' then
        if jsonb_typeof(v) <> 'array' then
          errs := errs || format('%s: must be a list', k);
        elsif exists (select 1 from jsonb_array_elements(v) e
                      where jsonb_typeof(e.value) <> 'object' or coalesce(e.value->>'en', '') = '') then
          errs := errs || format('%s: every item needs English text', k);
        end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          errs := errs || format('%s: must be a date (YYYY-MM-DD)', k);
        end if;
      else
        errs := errs || format('%s: unknown field type %s', k, coalesce(t, 'null'));
    end case;
  end loop;

  for k in select jsonb_object_keys(p_attrs) loop
    if not (k = any(known)) then
      errs := errs || format('%s: not a field of this category', k);
    end if;
  end loop;

  return errs;
end $$;

-- Trigger on products: every write path (RPC, CSV, Studio) is validated.
create or replace function public.validate_product_attributes()
returns trigger language plpgsql set search_path = '' as $$
declare
  errs text[];
begin
  errs := public.validate_attributes(public.effective_attribute_schema(new.category_id), new.attributes);
  if cardinality(errs) > 0 then
    raise exception 'invalid attributes: %', array_to_string(errs, '; ')
      using errcode = '22023', hint = 'attributes';
  end if;
  return new;
end $$;

drop trigger if exists products_validate_attributes on public.products;
create trigger products_validate_attributes
  before insert or update of attributes, category_id on public.products
  for each row execute function public.validate_product_attributes();

-- Guard rails on the schema itself (7.3): valid field definitions, no deleted keys,
-- 2-level tree only, schema_version bumped on structural change.
create or replace function public.validate_category_schema()
returns trigger language plpgsql set search_path = '' as $$
declare
  f        jsonb;
  k        text;
  keys     text[] := '{}';
  old_keys text[];
begin
  if new.parent_id is not null and exists (
       select 1 from public.categories p where p.id = new.parent_id and p.parent_id is not null) then
    raise exception 'categories can only be 2 levels deep' using errcode = '22023';
  end if;
  if new.parent_id = new.id then
    raise exception 'a category cannot be its own parent' using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(new.attribute_schema->'fields'), 'array') <> 'array' then
    raise exception 'attribute_schema.fields must be an array' using errcode = '22023';
  end if;

  for f in select value from jsonb_array_elements(coalesce(new.attribute_schema->'fields', '[]'::jsonb)) loop
    k := f->>'key';
    if k is null or k !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'field key "%" must be lower_snake_case', k using errcode = '22023';
    end if;
    if k = any(keys) then
      raise exception 'duplicate field key "%"', k using errcode = '22023';
    end if;
    keys := keys || k;
    if coalesce(f->>'type', '') not in ('text','localizedText','number','boolean','select','multiSelect','localizedList','date') then
      raise exception 'field "%": unknown type %', k, f->>'type' using errcode = '22023';
    end if;
    if coalesce(f#>>'{label,en}', '') = '' then
      raise exception 'field "%": English label required', k using errcode = '22023';
    end if;
    if f->>'type' in ('select','multiSelect')
       and coalesce(jsonb_array_length(f->'options'), 0) = 0 then
      raise exception 'field "%": add at least one option', k using errcode = '22023';
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(value->>'key'), '{}') into old_keys
    from jsonb_array_elements(coalesce(old.attribute_schema->'fields', '[]'::jsonb));
    if exists (select 1 from unnest(old_keys) ok where not (ok = any(keys))) then
      raise exception 'fields cannot be deleted once saved; mark them deprecated instead'
        using errcode = '22023';
    end if;
    -- type changes are not allowed either
    if exists (
      select 1
      from jsonb_array_elements(coalesce(old.attribute_schema->'fields', '[]'::jsonb)) o
      join jsonb_array_elements(coalesce(new.attribute_schema->'fields', '[]'::jsonb)) n
        on n.value->>'key' = o.value->>'key'
      where n.value->>'type' <> o.value->>'type') then
      raise exception 'a field''s type cannot change; add a new field and deprecate the old one'
        using errcode = '22023';
    end if;
    if new.slug <> old.slug and exists (select 1 from public.products p where p.category_id = new.id) then
      raise exception 'slug cannot change once products exist (it is part of shared links)' using errcode = '22023';
    end if;
    if new.attribute_schema is distinct from old.attribute_schema then
      new.schema_version := coalesce(old.schema_version, 1) + 1;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists categories_validate_schema on public.categories;
create trigger categories_validate_schema
  before insert or update on public.categories
  for each row execute function public.validate_category_schema();

-- "23 products don't have this field yet" (7.3)
create or replace function public.admin_products_missing_attribute(p_category_id bigint, p_key text)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    select count(*)::int from public.products p
    join public.categories c on c.id = p.category_id
    where (c.id = p_category_id or c.parent_id = p_category_id)
      and not (coalesce(p.attributes, '{}'::jsonb) ? p_key));
end $$;

-- ---------------------------------------------------------------------
-- Part D. Admin write policies (merchandising tables) + profiles read
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories','brands','products','product_variants','product_images',
    'banners','collections','collection_products','home_sections',
    'search_synonyms','app_config'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists stores_admin_select on public.stores;
create policy stores_admin_select on public.stores
  for select to authenticated using (public.is_admin());
-- stores are UPDATED only through admin_update_store_settings() (validation + audit)

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin());

drop policy if exists search_queries_admin_select on public.search_queries;
create policy search_queries_admin_select on public.search_queries
  for select to authenticated using (public.is_admin());

-- Sort order for drag/arrow reordering (7.2, 7.7)
create or replace function public.admin_reorder(p_table text, p_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_table not in ('categories','banners','home_sections','collections','brands') then
    raise exception 'cannot reorder %', p_table using errcode = '22023';
  end if;
  execute format(
    'update public.%I t set sort_order = x.ord from unnest($1) with ordinality as x(id, ord) where t.id = x.id',
    p_table) using p_ids;
end $$;

create or replace function public.admin_set_collection_products(p_collection_id bigint, p_product_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.collection_products where collection_id = p_collection_id;
  insert into public.collection_products (collection_id, product_id, sort_order)
  select p_collection_id, x.id, x.ord
  from unnest(p_product_ids) with ordinality as x(id, ord);
end $$;

-- ---------------------------------------------------------------------
-- Part E. Product upsert: product + variants + images + inventory, one transaction
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_product(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_product_id   bigint := nullif(payload->>'id', '')::bigint;
  v_store_id     bigint := coalesce(nullif(payload->>'store_id', '')::bigint,
                                    (select s.id from public.stores s order by s.id limit 1));
  v_slug         text;
  v_before       jsonb;
  v_errors       text[] := '{}';
  v_var          jsonb;
  v_var_id       bigint;
  v_owner        bigint;
  v_keep_vars    bigint[] := '{}';
  v_default_sku  text;
  v_initial      int;
  r              record;
  v_keep_paths   text[] := '{}';
  v_removed      text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  -- 1. Validate (collect all errors so the form can show them at once)
  if coalesce(payload#>>'{name,en}', '') = '' then v_errors := v_errors || 'name.en: required'; end if;
  if nullif(payload->>'category_id', '') is null then
    v_errors := v_errors || 'category_id: required';
  elsif not exists (select 1 from public.categories c
                    where c.id = (payload->>'category_id')::bigint and c.parent_id is not null) then
    v_errors := v_errors || 'category_id: pick a sub-category';
  end if;
  if coalesce(payload#>>'{manufacturer,name}', '') = '' then
    v_errors := v_errors || 'manufacturer.name: required (Legal Metrology)';
  end if;
  if coalesce(payload#>>'{manufacturer,address}', '') = '' then
    v_errors := v_errors || 'manufacturer.address: required (Legal Metrology)';
  end if;
  if coalesce(payload->>'country_of_origin', '') = '' then
    v_errors := v_errors || 'country_of_origin: required';
  end if;
  if coalesce(payload->>'hsn_code', '') <> '' and payload->>'hsn_code' !~ '^\d{4}(\d{2}){0,2}$' then
    v_errors := v_errors || 'hsn_code: 4, 6 or 8 digits';
  end if;
  if coalesce(nullif(payload->>'gst_rate', '')::numeric, -1) not between 0 and 40 then
    v_errors := v_errors || 'gst_rate: required (0–40%)';
  end if;
  if coalesce(jsonb_typeof(payload->'variants'), '') <> 'array'
     or jsonb_array_length(payload->'variants') = 0 then
    v_errors := v_errors || 'variants: add at least one';
  else
    for r in select e.value as v, e.ordinality as n from jsonb_array_elements(payload->'variants') with ordinality e loop
      if coalesce(r.v->>'sku', '') = '' then v_errors := v_errors || format('variants[%s].sku: required', r.n); end if;
      if coalesce(r.v#>>'{label,en}', '') = '' then v_errors := v_errors || format('variants[%s].label.en: required', r.n); end if;
      if coalesce(nullif(r.v->>'net_quantity', '')::numeric, 0) <= 0 then
        v_errors := v_errors || format('variants[%s].net_quantity: required', r.n);
      end if;
      if coalesce(r.v->>'unit', '') not in ('g','kg','ml','l','pc','pack') then
        v_errors := v_errors || format('variants[%s].unit: g, kg, ml, l, pc or pack', r.n);
      end if;
      if coalesce(nullif(r.v->>'mrp', '')::numeric, 0) <= 0 then
        v_errors := v_errors || format('variants[%s].mrp: required', r.n);
      end if;
      if coalesce(nullif(r.v->>'price', '')::numeric, 0) <= 0 then
        v_errors := v_errors || format('variants[%s].price: required', r.n);
      elsif (r.v->>'price')::numeric > coalesce(nullif(r.v->>'mrp', '')::numeric, 0) then
        v_errors := v_errors || format('variants[%s].price: cannot be more than MRP', r.n);
      end if;
    end loop;
  end if;
  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, E'\n') using errcode = '22023', hint = 'validation';
  end if;

  -- 2. Product row
  v_slug := coalesce(nullif(payload->>'slug', ''), public.slugify(payload#>>'{name,en}'),
                     'p-' || substr(md5(random()::text), 1, 6));
  if exists (select 1 from public.products p where p.slug = v_slug and p.id is distinct from v_product_id) then
    if v_product_id is null and nullif(payload->>'slug', '') is null then
      v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);   -- auto slug: just make it unique
    else
      raise exception 'slug: "%" is already used by another product', v_slug using errcode = '23505';
    end if;
  end if;

  if v_product_id is null then
    insert into public.products (
      category_id, brand_id, slug, name, description, attributes, is_veg, tags,
      hsn_code, gst_rate, country_of_origin, manufacturer, shelf_life, is_active, sort_order)
    values (
      (payload->>'category_id')::bigint,
      nullif(payload->>'brand_id', '')::bigint,
      v_slug,
      payload->'name',
      coalesce(payload->'description', '{}'::jsonb),
      coalesce(payload->'attributes', '{}'::jsonb),
      nullif(payload->>'is_veg', '')::boolean,
      coalesce(array(select jsonb_array_elements_text(coalesce(payload->'tags', '[]'::jsonb))), '{}'),
      nullif(payload->>'hsn_code', ''),
      (payload->>'gst_rate')::numeric,
      payload->>'country_of_origin',
      payload->'manufacturer',
      nullif(payload->>'shelf_life', ''),
      coalesce((payload->>'is_active')::boolean, true),
      coalesce(nullif(payload->>'sort_order', '')::int, 0))
    returning id into v_product_id;
  else
    select to_jsonb(p) into v_before from public.products p where p.id = v_product_id for update;
    if v_before is null then raise exception 'product % not found', v_product_id using errcode = 'P0002'; end if;
    update public.products set
      category_id       = (payload->>'category_id')::bigint,
      brand_id          = nullif(payload->>'brand_id', '')::bigint,
      slug              = v_slug,
      name              = payload->'name',
      description       = coalesce(payload->'description', '{}'::jsonb),
      attributes        = coalesce(payload->'attributes', '{}'::jsonb),
      is_veg            = nullif(payload->>'is_veg', '')::boolean,
      tags              = coalesce(array(select jsonb_array_elements_text(coalesce(payload->'tags', '[]'::jsonb))), '{}'),
      hsn_code          = nullif(payload->>'hsn_code', ''),
      gst_rate          = (payload->>'gst_rate')::numeric,
      country_of_origin = payload->>'country_of_origin',
      manufacturer      = payload->'manufacturer',
      shelf_life        = nullif(payload->>'shelf_life', ''),
      is_active         = coalesce((payload->>'is_active')::boolean, true),
      sort_order        = coalesce(nullif(payload->>'sort_order', '')::int, 0)
    where id = v_product_id;
  end if;

  -- 3. Variants (exactly one default; missing ones are deactivated, never deleted: orders reference them)
  select coalesce(
           (select e->>'sku' from jsonb_array_elements(payload->'variants') e
            where coalesce((e->>'is_default')::boolean, false) limit 1),
           payload->'variants'->0->>'sku')
  into v_default_sku;

  update public.product_variants set is_default = false where product_id = v_product_id;

  for r in select e.value as v, e.ordinality as n from jsonb_array_elements(payload->'variants') with ordinality e loop
    v_var := r.v;
    v_var_id := nullif(v_var->>'id', '')::bigint;
    if v_var_id is null then
      select pv.id, pv.product_id into v_var_id, v_owner from public.product_variants pv where pv.sku = v_var->>'sku';
      if v_var_id is not null and v_owner <> v_product_id then
        raise exception 'sku %: already used by another product', v_var->>'sku' using errcode = '23505';
      end if;
    end if;

    if v_var_id is null then
      insert into public.product_variants (
        product_id, sku, barcode, label, net_quantity, unit, mrp, price,
        max_per_order, is_default, is_active, sort_order)
      values (
        v_product_id, v_var->>'sku', nullif(v_var->>'barcode', ''), v_var->'label',
        (v_var->>'net_quantity')::numeric, v_var->>'unit',
        (v_var->>'mrp')::numeric, (v_var->>'price')::numeric,
        coalesce(nullif(v_var->>'max_per_order', '')::int, 10),
        (v_var->>'sku') = v_default_sku,
        coalesce((v_var->>'is_active')::boolean, true),
        coalesce(nullif(v_var->>'sort_order', '')::int, r.n::int))
      returning id into v_var_id;

      v_initial := greatest(coalesce(nullif(v_var->>'initial_stock', '')::int, 0), 0);
      insert into public.inventory (store_id, variant_id, stock, low_stock_threshold)
      values (v_store_id, v_var_id, v_initial, coalesce(nullif(v_var->>'low_stock_threshold', '')::int, 5))
      on conflict (store_id, variant_id) do nothing;
      if v_initial > 0 then
        insert into public.inventory_movements (store_id, variant_id, delta, reason, note, actor_id)
        values (v_store_id, v_var_id, v_initial, 'initial', 'created in admin', auth.uid());
      end if;
    else
      update public.product_variants set
        sku           = v_var->>'sku',
        barcode       = nullif(v_var->>'barcode', ''),
        label         = v_var->'label',
        net_quantity  = (v_var->>'net_quantity')::numeric,
        unit          = v_var->>'unit',
        mrp           = (v_var->>'mrp')::numeric,
        price         = (v_var->>'price')::numeric,
        max_per_order = coalesce(nullif(v_var->>'max_per_order', '')::int, 10),
        is_default    = (v_var->>'sku') = v_default_sku,
        is_active     = coalesce((v_var->>'is_active')::boolean, true),
        sort_order    = coalesce(nullif(v_var->>'sort_order', '')::int, r.n::int)
      where id = v_var_id and product_id = v_product_id;
      if not found then
        raise exception 'variant % does not belong to product %', v_var_id, v_product_id using errcode = '22023';
      end if;
      insert into public.inventory (store_id, variant_id, stock)
      values (v_store_id, v_var_id, 0)
      on conflict (store_id, variant_id) do nothing;
      if nullif(v_var->>'low_stock_threshold', '') is not null then
        update public.inventory set low_stock_threshold = (v_var->>'low_stock_threshold')::int
        where store_id = v_store_id and variant_id = v_var_id;
      end if;
    end if;
    v_keep_vars := v_keep_vars || v_var_id;
  end loop;

  update public.product_variants
     set is_active = false, is_default = false
   where product_id = v_product_id and not (id = any(v_keep_vars));

  -- 4. Images (only when the payload carries the list; CSV imports leave images alone)
  if payload ? 'images' then
    for r in select e.value as img, e.ordinality as n from jsonb_array_elements(payload->'images') with ordinality e loop
      if coalesce(r.img->>'path', '') !~ '^products/' or coalesce(r.img->>'thumb_path', '') !~ '^products/' then
        raise exception 'images[%]: path must be inside catalog/products/', r.n using errcode = '22023';
      end if;
      v_keep_paths := v_keep_paths || (r.img->>'path');
      update public.product_images set
        thumb_path = r.img->>'thumb_path',
        sort_order = r.n::int,
        variant_id = (select pv.id from public.product_variants pv
                      where pv.product_id = v_product_id and pv.sku = r.img->>'variant_sku')
      where product_id = v_product_id and path = r.img->>'path';
      if not found then
        insert into public.product_images (product_id, variant_id, path, thumb_path, sort_order)
        values (v_product_id,
                (select pv.id from public.product_variants pv
                 where pv.product_id = v_product_id and pv.sku = r.img->>'variant_sku'),
                r.img->>'path', r.img->>'thumb_path', r.n::int);
      end if;
    end loop;

    with del as (
      delete from public.product_images
      where product_id = v_product_id and not (path = any(v_keep_paths))
      returning path, thumb_path
    )
    select coalesce(array_agg(x), '{}') into v_removed
    from del cross join lateral unnest(array[del.path, del.thumb_path]) as x
    where x is not null;
  end if;

  -- 5. Audit
  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'product_upsert', 'product', v_product_id::text, v_before,
          (select to_jsonb(p) from public.products p where p.id = v_product_id));

  return jsonb_build_object(
    'product_id', v_product_id,
    'slug', v_slug,
    'removed_image_paths', to_jsonb(v_removed));
end $$;

-- Attach images to an existing product by SKU (bulk image matcher, 7.5)
create or replace function public.admin_add_product_images(p_sku text, p_images jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_variant_id bigint;
  v_product_id bigint;
  v_next       int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select pv.id, pv.product_id into v_variant_id, v_product_id
  from public.product_variants pv where pv.sku = p_sku;
  if v_product_id is null then raise exception 'sku % not found', p_sku using errcode = 'P0002'; end if;

  select coalesce(max(sort_order), 0) into v_next from public.product_images where product_id = v_product_id;
  insert into public.product_images (product_id, variant_id, path, thumb_path, sort_order)
  select v_product_id, v_variant_id, e.value->>'path', e.value->>'thumb_path', v_next + e.ordinality::int
  from jsonb_array_elements(p_images) with ordinality e
  where e.value->>'path' ~ '^products/' and e.value->>'thumb_path' ~ '^products/';
  return v_product_id;
end $$;

-- Price history: every price/MRP change is logged, whoever made it (RPC, import, Studio)
create or replace function public.log_variant_price_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.price is distinct from old.price or new.mrp is distinct from old.mrp then
    insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), 'price_change', 'product_variant', new.id::text,
            jsonb_build_object('price', old.price, 'mrp', old.mrp),
            jsonb_build_object('price', new.price, 'mrp', new.mrp));
  end if;
  return new;
end $$;

drop trigger if exists product_variants_price_log on public.product_variants;
create trigger product_variants_price_log
  after update of price, mrp on public.product_variants
  for each row execute function public.log_variant_price_change();

-- ---------------------------------------------------------------------
-- Part F. CSV import (one row per variant), with dry run and per-product errors
-- ---------------------------------------------------------------------
create or replace function public.csv_attributes(p_category_id bigint, p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  f    jsonb;
  k    text;
  t    text;
  raw  text;
  val  jsonb;
  out  jsonb := '{}'::jsonb;
begin
  for f in select value from jsonb_array_elements(public.effective_attribute_schema(p_category_id)->'fields') loop
    k := f->>'key';
    t := f->>'type';
    raw := nullif(trim(p_row->>('attr.' || k)), '');
    if t = 'localizedText' then
      val := public.csv_localized(p_row, 'attr.' || k);          -- columns attr.<key>_en / _mr / _hi
      if val = '{}'::jsonb then continue; end if;
    elsif raw is null then
      continue;
    elsif t = 'number' then
      if raw !~ '^-?\d+(\.\d+)?$' then
        raise exception 'attr.%: "%" is not a number', k, raw using errcode = '22023';
      end if;
      val := to_jsonb(raw::numeric);
    elsif t = 'boolean' then
      val := to_jsonb(public.csv_bool(raw));
    elsif t = 'multiSelect' then
      val := (select jsonb_agg(trim(x)) from unnest(string_to_array(raw, '|')) x where trim(x) <> '');
    elsif t = 'localizedList' then
      val := (select jsonb_agg(jsonb_build_object('en', trim(x))) from unnest(string_to_array(raw, '|')) x where trim(x) <> '');
    else
      val := to_jsonb(raw);                                         -- text, select, date
    end if;
    out := out || jsonb_build_object(k, val);
  end loop;
  return out;
end $$;

create or replace function public.admin_import_products(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g          record;
  x          jsonb;
  v_first    jsonb;
  v_cat_id   bigint;
  v_brand_id bigint;
  v_existing bigint;
  v_variants jsonb;
  v_payload  jsonb;
  v_store_id bigint := (select s.id from public.stores s order by s.id limit 1);
  v_var_id   bigint;
  v_old      int;
  v_new      int;
  v_created  int := 0;
  v_updated  int := 0;
  v_errors   jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 300 then
    raise exception 'max 300 rows per call (the app sends chunks)' using errcode = '22023';
  end if;

  begin  -- outer block: lets a dry run roll everything back but keep the counters
    for g in
      select nullif(trim(r.value->>'product_slug'), '') as slug,
             jsonb_agg(r.value || jsonb_build_object('_row', coalesce((r.value->>'_row')::int, r.ordinality::int))
                       order by r.ordinality) as rows
      from jsonb_array_elements(p_rows) with ordinality r
      group by 1
    loop
      begin  -- per-product sub-transaction
        if g.slug is null then raise exception 'product_slug: required'; end if;
        v_first := g.rows->0;

        select c.id into v_cat_id from public.categories c
        where c.slug = trim(v_first->>'category_slug') and c.parent_id is not null;
        if v_cat_id is null then
          raise exception 'category_slug "%": no such sub-category', v_first->>'category_slug';
        end if;

        v_brand_id := null;
        if coalesce(trim(v_first->>'brand_slug'), '') <> '' then
          select b.id into v_brand_id from public.brands b where b.slug = trim(v_first->>'brand_slug');
          if v_brand_id is null then
            insert into public.brands (slug, name)
            values (trim(v_first->>'brand_slug'),
                    jsonb_build_object('en', coalesce(nullif(trim(v_first->>'brand_name'), ''), trim(v_first->>'brand_slug'))))
            returning id into v_brand_id;
          end if;
        end if;

        select p.id into v_existing from public.products p where p.slug = g.slug;

        select jsonb_agg(jsonb_build_object(
                 'id',            (select pv.id from public.product_variants pv where pv.sku = trim(e->>'sku')),
                 'sku',           trim(e->>'sku'),
                 'barcode',       nullif(trim(e->>'barcode'), ''),
                 'label',         public.csv_localized(e, 'variant_label'),
                 'net_quantity',  nullif(trim(e->>'net_quantity'), ''),
                 'unit',          lower(trim(e->>'unit')),
                 'mrp',           nullif(trim(e->>'mrp'), ''),
                 'price',         nullif(trim(e->>'price'), ''),
                 'max_per_order', nullif(trim(e->>'max_per_order'), ''),
                 'is_default',    coalesce(public.csv_bool(e->>'is_default'), false),
                 'initial_stock', nullif(trim(e->>'stock'), ''),
                 'low_stock_threshold', nullif(trim(e->>'low_stock_threshold'), ''),
                 'sort_order',    e->>'_row'))
        into v_variants
        from jsonb_array_elements(g.rows) e;

        v_payload := jsonb_build_object(
          'id',                v_existing,
          'store_id',          v_store_id,
          'category_id',       v_cat_id,
          'brand_id',          v_brand_id,
          'slug',              g.slug,
          'name',              public.csv_localized(v_first, 'name'),
          'description',       public.csv_localized(v_first, 'description'),
          'attributes',        public.csv_attributes(v_cat_id, v_first),
          'is_veg',            public.csv_bool(v_first->>'is_veg'),
          'tags',              coalesce(to_jsonb(string_to_array(nullif(trim(v_first->>'tags'), ''), '|')), '[]'::jsonb),
          'hsn_code',          nullif(trim(v_first->>'hsn_code'), ''),
          'gst_rate',          nullif(trim(v_first->>'gst_rate'), ''),
          'country_of_origin', nullif(trim(v_first->>'country_of_origin'), ''),
          'manufacturer',      jsonb_build_object('name', trim(v_first->>'manufacturer_name'),
                                                  'address', trim(v_first->>'manufacturer_address')),
          'shelf_life',        nullif(trim(v_first->>'shelf_life'), ''),
          'is_active',         coalesce(public.csv_bool(v_first->>'is_active'), true),
          'variants',          v_variants);

        perform public.admin_upsert_product(v_payload);

        -- stock column on EXISTING SKUs = "set stock to", logged as an adjustment
        for x in select value from jsonb_array_elements(g.rows) loop
          continue when nullif(trim(x->>'stock'), '') is null;
          select pv.id into v_var_id from public.product_variants pv where pv.sku = trim(x->>'sku');
          v_new := (x->>'stock')::int;
          select i.stock into v_old from public.inventory i
          where i.store_id = v_store_id and i.variant_id = v_var_id for update;
          if v_old is not null and v_old <> v_new and v_existing is not null then
            update public.inventory set stock = v_new, updated_at = now()
            where store_id = v_store_id and variant_id = v_var_id;
            insert into public.inventory_movements (store_id, variant_id, delta, reason, note, actor_id)
            values (v_store_id, v_var_id, v_new - v_old, 'adjustment', 'CSV import', auth.uid());
          end if;
        end loop;

        if v_existing is null then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object(
          'product_slug', g.slug,
          'rows', (select jsonb_agg((e->>'_row')::int) from jsonb_array_elements(g.rows) e),
          'message', sqlerrm);
      end;
    end loop;

    if p_dry_run then
      raise exception 'dry run' using errcode = 'NKDRY';
    end if;
  exception when sqlstate 'NKDRY' then
    null;  -- everything above is rolled back; counters and errors are kept
  end;

  if not p_dry_run then
    insert into public.admin_audit_log (actor_id, action, entity, entity_id, after)
    values (auth.uid(), 'import', 'product', null,
            jsonb_build_object('created', v_created, 'updated', v_updated, 'errors', jsonb_array_length(v_errors)));
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'created', v_created, 'updated', v_updated, 'errors', v_errors);
end $$;

-- ---------------------------------------------------------------------
-- Part G. Store settings (fees, hours, area, legal IDs) with validation + audit
-- ---------------------------------------------------------------------
create or replace function public.admin_update_store_settings(p_store_id bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  s        public.stores;
  d        jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_jsonb(st) into v_before from public.stores st where st.id = p_store_id for update;
  if v_before is null then raise exception 'store not found' using errcode = 'P0002'; end if;

  update public.stores set
    name                     = coalesce(p_patch->'name', name),
    address                  = coalesce(p_patch->'address', address),
    phone                    = coalesce(p_patch->>'phone', phone),
    whatsapp                 = coalesce(p_patch->>'whatsapp', whatsapp),
    gstin                    = coalesce(upper(p_patch->>'gstin'), gstin),
    fssai_license            = coalesce(p_patch->>'fssai_license', fssai_license),
    opening_hours            = coalesce(p_patch->'opening_hours', opening_hours),
    eta_minutes              = coalesce((p_patch->>'eta_minutes')::int, eta_minutes),
    min_order_value          = coalesce((p_patch->>'min_order_value')::numeric, min_order_value),
    delivery_fee             = coalesce((p_patch->>'delivery_fee')::numeric, delivery_fee),
    free_delivery_above      = coalesce((p_patch->>'free_delivery_above')::numeric, free_delivery_above),
    small_cart_threshold     = coalesce((p_patch->>'small_cart_threshold')::numeric, small_cart_threshold),
    small_cart_fee           = coalesce((p_patch->>'small_cart_fee')::numeric, small_cart_fee),
    packaging_fee            = coalesce((p_patch->>'packaging_fee')::numeric, packaging_fee),
    max_cod_order_value      = coalesce((p_patch->>'max_cod_order_value')::numeric, max_cod_order_value),
    max_open_orders_per_user = coalesce((p_patch->>'max_open_orders_per_user')::int, max_open_orders_per_user),
    auto_cancel_minutes      = coalesce((p_patch->>'auto_cancel_minutes')::int, auto_cancel_minutes),
    service_radius_km        = coalesce((p_patch->>'service_radius_km')::numeric, service_radius_km),
    location = case when p_patch ? 'location' then
                 extensions.st_setsrid(extensions.st_makepoint(
                   (p_patch#>>'{location,lng}')::float8, (p_patch#>>'{location,lat}')::float8), 4326)::extensions.geography
               else location end,
    service_area = case
                 when not (p_patch ? 'service_area') then service_area
                 when p_patch->'service_area' = 'null'::jsonb then null
                 else extensions.st_setsrid(extensions.st_geomfromgeojson(p_patch->>'service_area'), 4326)::extensions.geography
               end
  where id = p_store_id
  returning * into s;

  -- validation after the update: any failure rolls the update back
  if s.min_order_value < 0 or s.delivery_fee < 0 or s.free_delivery_above < 0 or s.small_cart_fee < 0
     or s.small_cart_threshold < 0 or s.packaging_fee < 0 then
    raise exception 'fees and thresholds cannot be negative' using errcode = '22023';
  end if;
  if s.max_cod_order_value <= 0 then raise exception 'max COD value must be above 0' using errcode = '22023'; end if;
  if s.max_cod_order_value < s.min_order_value then
    raise exception 'max COD value is below the minimum order: nobody could check out' using errcode = '22023';
  end if;
  if s.auto_cancel_minutes not between 2 and 60 then
    raise exception 'auto-cancel must be 2–60 minutes' using errcode = '22023';
  end if;
  if s.eta_minutes not between 5 and 240 then raise exception 'ETA must be 5–240 minutes' using errcode = '22023'; end if;
  if s.service_radius_km not between 0.3 and 30 then
    raise exception 'service radius must be 0.3–30 km' using errcode = '22023';
  end if;
  if s.max_open_orders_per_user not between 1 and 10 then
    raise exception 'open orders per user must be 1–10' using errcode = '22023';
  end if;
  if coalesce(s.gstin, '') <> '' and s.gstin !~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'GSTIN format looks wrong' using errcode = '22023';
  end if;
  if coalesce(s.fssai_license, '') <> '' and s.fssai_license !~ '^\d{14}$' then
    raise exception 'FSSAI licence is 14 digits' using errcode = '22023';
  end if;
  if jsonb_typeof(s.opening_hours) <> 'object' then
    raise exception 'opening_hours must be an object of weekday → ranges' using errcode = '22023';
  end if;
  for d in select value from jsonb_each(s.opening_hours) loop
    if jsonb_typeof(d) <> 'array' or exists (
         select 1 from jsonb_array_elements(d) rng
         where coalesce(rng.value->>'open', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
            or coalesce(rng.value->>'close', '') !~ '^([01]\d|2[0-3]):[0-5]\d$') then
      raise exception 'opening hours must be HH:MM ranges' using errcode = '22023';
    end if;
  end loop;

  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'store_settings', 'store', p_store_id::text, v_before, to_jsonb(s));

  return to_jsonb(s);
end $$;

-- ---------------------------------------------------------------------
-- Part H. Users & roles
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(p_query text default null, p_role public.app_role default null,
                                                   p_limit int default 30, p_offset int default 0)
returns table (
  id uuid, full_name text, email text, phone text, role public.app_role, is_blocked boolean,
  cod_allowed boolean, created_at timestamptz, orders_count int, delivered_count int,
  cancelled_count int, last_order_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name::text, p.email::text, p.phone::text, p.role, p.is_blocked, p.cod_allowed, p.created_at,
         count(o.id)::int,
         count(o.id) filter (where o.status = 'delivered')::int,
         count(o.id) filter (where o.status = 'cancelled' and o.cancelled_by = 'customer')::int,
         max(o.placed_at)
  from public.profiles p
  left join public.orders o on o.user_id = p.id
  where (p_role is null or p.role = p_role)
    and (p_query is null or p_query = ''
         or p.full_name ilike '%' || p_query || '%'
         or p.email ilike '%' || p_query || '%'
         or p.phone ilike '%' || p_query || '%')
  group by p.id
  order by max(o.placed_at) desc nulls last, p.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.app_role;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'admin' and (select count(*) from public.profiles where role = 'admin' and not is_blocked) <= 1 then
    raise exception 'cannot remove the last admin' using errcode = '22023';
  end if;

  perform set_config('app.role_change', 'on', true);
  update public.profiles set role = p_role where id = p_user_id;

  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'role_change', 'profile', p_user_id::text,
          jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));

  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, 'role_changed',
          jsonb_build_object('en', 'Your access changed', 'mr', 'तुमचा प्रवेश बदलला', 'hi', 'आपकी पहुँच बदली गई'),
          case when p_role in ('staff','admin')
            then jsonb_build_object('en', 'Store mode is now available in Account.',
                                    'mr', 'आता अकाउंटमध्ये स्टोअर मोड उपलब्ध आहे.',
                                    'hi', 'अब अकाउंट में स्टोर मोड उपलब्ध है।')
            else jsonb_build_object('en', 'Store mode has been turned off for your account.',
                                    'mr', 'तुमच्या अकाउंटसाठी स्टोअर मोड बंद केला आहे.',
                                    'hi', 'आपके अकाउंट के लिए स्टोर मोड बंद कर दिया गया है।')
          end,
          jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_user_blocked(p_user_id uuid, p_blocked boolean,
                                                         p_cod_allowed boolean default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'you cannot block yourself' using errcode = '22023'; end if;
  select jsonb_build_object('is_blocked', is_blocked, 'cod_allowed', cod_allowed, 'role', role)
    into v_before from public.profiles where id = p_user_id for update;
  if v_before is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  if v_before->>'role' = 'admin' and p_blocked then
    raise exception 'demote the admin before blocking' using errcode = '22023';
  end if;

  perform set_config('app.role_change', 'on', true);
  update public.profiles
     set is_blocked = p_blocked,
         cod_allowed = coalesce(p_cod_allowed, cod_allowed)
   where id = p_user_id;

  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user_block', 'profile', p_user_id::text, v_before,
          jsonb_build_object('is_blocked', p_blocked, 'cod_allowed', coalesce(p_cod_allowed, (v_before->>'cod_allowed')::boolean),
                             'note', p_note));
end $$;

-- ---------------------------------------------------------------------
-- Part I. Report views (admin only, security_invoker so RLS still applies)
-- ---------------------------------------------------------------------
create or replace view public.v_sales_daily with (security_invoker = true) as
select (o.placed_at at time zone 'Asia/Kolkata')::date                          as day,
       count(*) filter (where o.status <> 'cancelled')::int                     as orders,
       count(*) filter (where o.status = 'cancelled')::int                      as cancelled,
       coalesce(sum(o.grand_total) filter (where o.status = 'delivered'), 0)    as delivered_revenue,
       coalesce(sum(o.grand_total) filter (where o.status <> 'cancelled'), 0)   as order_value,
       round(avg(o.grand_total) filter (where o.status <> 'cancelled'), 2)      as avg_order_value,
       count(distinct o.user_id) filter (where o.status <> 'cancelled')::int    as customers
from public.orders o
where public.is_admin()
group by 1;

create or replace view public.v_top_products with (security_invoker = true) as
select p.id as product_id, p.slug, p.name,
       sum(oi.quantity)::int           as units,
       sum(oi.line_total)              as revenue,
       count(distinct oi.order_id)::int as orders
from public.order_items oi
join public.orders o   on o.id = oi.order_id
join public.products p on p.id = oi.product_id
where public.is_admin()
  and o.status <> 'cancelled'
  and oi.status = 'active'
  and o.placed_at >= now() - interval '30 days'
group by p.id, p.slug, p.name;

create or replace view public.v_low_stock with (security_invoker = true) as
select i.store_id, i.variant_id, pv.sku, p.id as product_id, p.name, pv.label,
       i.stock, i.low_stock_threshold, i.is_available,
       coalesce(s.sold_7d, 0)::int as sold_7d,
       case when coalesce(s.sold_7d, 0) = 0 then null
            else round(i.stock / (s.sold_7d / 7.0), 1) end as days_of_cover
from public.inventory i
join public.product_variants pv on pv.id = i.variant_id
join public.products p          on p.id = pv.product_id
left join lateral (
  select sum(oi.quantity) as sold_7d
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.variant_id = i.variant_id and oi.status = 'active'
    and o.status <> 'cancelled' and o.placed_at >= now() - interval '7 days'
) s on true
where public.is_admin() and pv.is_active and p.is_active and i.stock <= i.low_stock_threshold;

create or replace view public.v_zero_result_searches with (security_invoker = true) as
select lower(trim(q.query))             as query,
       count(*)::int                    as searches,
       count(distinct q.user_id)::int   as users,
       max(q.created_at)                as last_searched_at,
       array_agg(distinct q.language)   as languages
from public.search_queries q
where public.is_admin() and q.results_count = 0 and q.created_at >= now() - interval '30 days'
group by 1;

create or replace view public.v_cancellations with (security_invoker = true) as
select o.cancelled_by,
       coalesce(nullif(trim(o.cancel_reason), ''), '(no reason)') as reason,
       count(*)::int        as orders,
       sum(o.grand_total)   as value,
       max(o.cancelled_at)  as last_at
from public.orders o
where public.is_admin() and o.status = 'cancelled' and o.cancelled_at >= now() - interval '30 days'
group by 1, 2;

revoke all on public.v_sales_daily, public.v_top_products, public.v_low_stock,
              public.v_zero_result_searches, public.v_cancellations from anon;
grant select on public.v_sales_daily, public.v_top_products, public.v_low_stock,
                public.v_zero_result_searches, public.v_cancellations to authenticated;

create or replace function public.admin_dashboard_today()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'orders',            count(*) filter (where o.status <> 'cancelled'),
    'order_value',       coalesce(sum(o.grand_total) filter (where o.status <> 'cancelled'), 0),
    'delivered_revenue', coalesce(sum(o.grand_total) filter (where o.status = 'delivered'), 0),
    'avg_order_value',   coalesce(round(avg(o.grand_total) filter (where o.status <> 'cancelled'), 2), 0),
    'cancelled',         count(*) filter (where o.status = 'cancelled'),
    'in_progress',       count(*) filter (where o.status in ('placed','confirmed','packing','packed','out_for_delivery'))
  ) into v
  from public.orders o
  where (o.placed_at at time zone 'Asia/Kolkata')::date = v_today;

  return v || jsonb_build_object(
    'new_customers', (select count(*) from (
                        select o.user_id from public.orders o
                        group by o.user_id
                        having min(o.placed_at) >= v_today::timestamp at time zone 'Asia/Kolkata') first_today),
    'low_stock',   (select count(*) from public.v_low_stock),
    'open_issues', (select count(*) from public.order_issues where status = 'open'),
    'zero_result_searches_7d', (select count(distinct lower(trim(query))) from public.search_queries
                                where results_count = 0 and created_at >= now() - interval '7 days'));
end $$;

-- ---------------------------------------------------------------------
-- Part J. Storage: admin writes to the public `catalog` bucket
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 2097152,                                  -- 2 MB; the app uploads ~150 KB
       allowed_mime_types = array['image/webp','image/jpeg','image/png']
 where id = 'catalog';

drop policy if exists catalog_admin_insert on storage.objects;
create policy catalog_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'catalog' and public.is_admin());
drop policy if exists catalog_admin_update on storage.objects;
create policy catalog_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'catalog' and public.is_admin());
drop policy if exists catalog_admin_delete on storage.objects;
create policy catalog_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'catalog' and public.is_admin());

-- ---------------------------------------------------------------------
-- Part K. Grants: admin RPCs callable by logged-in users only (they check is_admin themselves)
-- ---------------------------------------------------------------------
revoke all on function
  public.admin_products_missing_attribute(bigint, text),
  public.admin_reorder(text, bigint[]),
  public.admin_set_collection_products(bigint, bigint[]),
  public.admin_upsert_product(jsonb),
  public.admin_add_product_images(text, jsonb),
  public.admin_import_products(jsonb, boolean),
  public.admin_update_store_settings(bigint, jsonb),
  public.admin_list_users(text, public.app_role, int, int),
  public.admin_set_role(uuid, public.app_role),
  public.admin_set_user_blocked(uuid, boolean, boolean, text),
  public.admin_dashboard_today()
from public, anon;

grant execute on function
  public.admin_products_missing_attribute(bigint, text),
  public.admin_reorder(text, bigint[]),
  public.admin_set_collection_products(bigint, bigint[]),
  public.admin_upsert_product(jsonb),
  public.admin_add_product_images(text, jsonb),
  public.admin_import_products(jsonb, boolean),
  public.admin_update_store_settings(bigint, jsonb),
  public.admin_list_users(text, public.app_role, int, int),
  public.admin_set_role(uuid, public.app_role),
  public.admin_set_user_blocked(uuid, boolean, boolean, text),
  public.admin_dashboard_today()
to authenticated;

-- internal helpers: not callable from the API
revoke all on function public.csv_attributes(bigint, jsonb), public.log_variant_price_change(),
                       public.validate_product_attributes(), public.validate_category_schema()
from public, anon, authenticated;
```

**After the migration**
```bash
supabase db push                      # or: supabase migration up (local)
supabase gen types typescript --local > mobile/src/types/database.ts
supabase db lint
```

**Checks**
- Updating a seeded product's `attributes` in Studio with an unknown key fails with `invalid attributes: …`.
- Removing a field from a category's `attribute_schema` fails with "mark them deprecated instead".
- `select public.admin_dashboard_today();` as a customer → `42501 forbidden`.

> **Statement timeout:** Supabase's default for the `authenticated` role is **8 seconds**. That's why imports are capped at 300 rows per call and the app sends chunks (7.6).

---

## 7.1 Admin shell & web build

**Goal:** one admin that works on a **tablet** at the counter and in a **browser** on the owner's laptop, built from the same Expo app.

**Files**
```
mobile/app/admin/_layout.tsx          # role guard + responsive shell (sidebar ≥ 900 px, stack below)
mobile/app/admin/index.tsx            # dashboard (7.10)
mobile/app/admin/categories/index.tsx, new.tsx, [id]/index.tsx, [id]/attributes.tsx
mobile/app/admin/products/index.tsx, new.tsx, [id].tsx, images.tsx
mobile/app/admin/import.tsx
mobile/app/admin/home/banners.tsx, sections.tsx, collections/index.tsx, collections/[id].tsx
mobile/app/admin/settings.tsx
mobile/app/admin/users.tsx
mobile/app/admin/synonyms.tsx
mobile/app/admin/reports/[report].tsx
mobile/src/features/admin/{AdminNav.tsx, useAdminGuard.ts, errors.ts}
mobile/src/lib/platform/storage.web.ts # session + MMKV fallback for web
```

**Steps**
1. **Guard** (UI only; the database is the real guard):
   ```tsx
   // app/admin/_layout.tsx
   export default function AdminLayout() {
     const { profile, isLoading } = useProfile();          // Phase 3
     const wide = useWindowDimensions().width >= 900;
     if (isLoading) return <FullScreenSpinner />;
     if (profile?.role !== 'admin') return <Redirect href="/" />;
     return wide ? (
       <View className="flex-1 flex-row bg-surface">
         <AdminNav variant="sidebar" />
         <View className="flex-1"><Slot /></View>
       </View>
     ) : (
       <Stack screenOptions={{ headerShown: true }} />
     );
   }
   ```
   `AdminNav` items: Dashboard · Categories · Products · Import · Home & banners · Collections · Synonyms · Settings · Users · Reports. Account tab shows **"⚙️ Admin"** only for admins.
2. **Error mapping** (`errors.ts`): RPC errors with `code === '22023'` and `hint === 'validation'` are split on `\n` into `{ path, message }` (`variants[2].price: cannot be more than MRP` → field `variants.1.price`) and pushed into react-hook-form with `setError`. `42501` → "You don't have access" + sign-out option. `23505` → shown on the slug/SKU field.
3. **Web support**
   - `app.config.ts`: `web: { bundler: 'metro', output: 'single' }`.
   - **Auth on web:** native Google sign-in isn't available in the browser, so the login screen calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/admin` } })` when `Platform.OS === 'web'`. Email OTP works unchanged. Add the admin URL to **Supabase → Auth → URL configuration → Redirect URLs**.
   - **Storage on web:** the SecureStore session adapter falls back to `localStorage` (`storage.web.ts`, picked by Metro's platform extensions). MMKV's web build also uses `localStorage`.
   - **Customer routes on web:** the web build exists for the admin only. In `(shop)/_layout.tsx`, `if (Platform.OS === 'web') return <Redirect href="/admin" />`. Shared product links are served by the separate web project in Phase 8.
4. **Deploy to Cloudflare Pages (free)**
   ```bash
   cd mobile
   APP_ENV=production npx expo export -p web        # → dist/
   npx wrangler pages deploy dist --project-name nearkart-admin
   ```
   With no `404.html`, Pages serves `index.html` for every path (SPA mode), so `/admin/products/12` works on refresh. Add `dist/_headers` with `X-Robots-Tag: noindex` and `X-Frame-Options: DENY`. Optional extra lock: **Cloudflare Access** (free for up to 50 users) in front of the admin domain, so only the owner's and staff's Google accounts can even load the page.
5. **CI:** a `web-admin.yml` workflow runs the export + `wrangler pages deploy` on tags `admin-v*` with `CLOUDFLARE_API_TOKEN` in GitHub secrets.

**Checks**
- A customer account opening `/admin` lands on Home. Calling `supabase.rpc('admin_dashboard_today')` from that account returns `42501`.
- The web admin loads at `https://nearkart-admin.pages.dev/admin`, logs in with Google, and survives a page refresh on a deep route.
- On a 10" tablet in landscape, the sidebar layout appears. On a phone, the stack layout does.

**Tests:** `useAdminGuard` redirects non-admins; `parseRpcError` maps validation lines to form paths (unit).

---

## 7.2 Category & sub-category editor

**Goal:** create, edit, order and switch on/off categories and sub-categories in three languages.

**Files:** `app/admin/categories/index.tsx`, `new.tsx`, `[id]/index.tsx`, `src/features/admin/categories/{api.ts, CategoryForm.tsx, IconPicker.tsx, ColorSwatches.tsx, ReorderList.tsx}`

**SQL:** Part C (`validate_category_schema`), Part D (`categories_admin_all`, `admin_reorder`).

**Screen: Categories**
```
Categories                                   [+ New category]
┌──────────────────────────────────────────────────────────┐
│ ⠿ 🥛 Dairy, Bread & Eggs     6 sub · 84 products   [●]  ›│
│     ↳ Milk · Curd & Yogurt · Paneer · Butter & Cheese …   │
│ ⠿ 🍎 Fruits & Vegetables     4 sub · 120 products  [●]  ›│
│ ⠿ 🧴 Personal Care           5 sub · 0 products    [○]  ›│   ← inactive
└──────────────────────────────────────────────────────────┘
```
- Drag handle `⠿` on native (`react-native-draggable-flatlist`), **↑ ↓ buttons** on every platform (drag on the web is unreliable). Releasing calls `admin_reorder('categories', ids)`.
- Counts come from one query: `categories` with `products(count)` via PostgREST embedded counts.

**Category form**
| Field | Rules |
|---|---|
| Name EN / मराठी / हिंदी | `LocalizedInput` (from Phase 1 display registry's sibling, 7.4) with **"Copy from English"** and a ⚠ badge when MR/HI are missing |
| Parent | "Top-level" or pick a top-level category. Only 2 levels (enforced in SQL). |
| Slug | Auto from English (`Dairy, Bread & Eggs` → `dairy-bread-eggs`). Editable until products exist (SQL blocks later changes because shared links use it). |
| Icon | Searchable grid of ~120 curated MaterialCommunityIcons (milk, fruit, bread, bottle, soap, baby, pet…) |
| Colour | 12 preset swatches already contrast-checked for light and dark themes |
| Image | One image, uploaded with the 7.5 helper into `catalog/categories/` |
| Active | Off = hidden from Home, the Categories tab and search. Products stay in the database. |

**Steps**
1. Writes are direct table calls (RLS = admin):
   ```ts
   export async function saveCategory(input: CategoryInput) {
     const row = { ...input, slug: input.slug || slugify(input.name.en) };
     const q = input.id
       ? supabase.from('categories').update(row).eq('id', input.id)
       : supabase.from('categories').insert(row);
     const { data, error } = await q.select().single();
     if (error) throw mapPgError(error);
     return data;
   }
   ```
2. After any save, invalidate `['categories']` and `['home']`. Customers pick it up on their next refetch (staleTime 5 minutes, plus refetch on app focus).
3. **Deactivate safety:** switching a category off shows "84 products will be hidden from customers. Orders already placed are not affected."

**Checks:** a new sub-category under "Dairy" shows in the category screen's left rail after a pull-to-refresh on a customer phone; a third nesting level is refused with a friendly message.

**Tests:** `slugify` (English, Devanagari-only → falls back to `cat-xxxx`, collisions); `ReorderList` emits the new id order.

---

## 7.3 Attribute schema builder + live preview

**Goal:** the no-code engine. The owner adds fields like *Fat %*, *Milk type*, *Organic* or *Shelf life* to a category, decides which ones are filters and badges, and sees **exactly** how customers will see them.

**Files:** `app/admin/categories/[id]/attributes.tsx`, `src/features/admin/attributes/{FieldList.tsx, FieldSheet.tsx, OptionsEditor.tsx, FiltersEditor.tsx, PreviewPane.tsx, sampleProduct.ts, validateSchema.ts, templates/*.json}`

**SQL:** Part C (`effective_attribute_schema`, `validate_attributes`, `validate_category_schema`, `admin_products_missing_attribute`).

**Layout** (two panes on tablet/web, tabs on phone)
```
Dairy › Milk  ·  Attributes                                  v4   [Save]
┌── Fields ───────────────────────────────┐ ┌── Preview  [EN|मराठी|हिंदी] [☀|🌙] ─┐
│ Inherited from Dairy (read-only)         │ │ ┌ Card ──────────┐ ┌ Highlights ────┐ │
│   Fat %        number · filter          │ │ │ [img] 🟢        │ │ Fat      3.5 %  │ │
│   Organic      yes/no · badge · filter  │ │ │ Amul Taaza      │ │ Milk     Cow    │ │
│ This sub-category                        │ │ │ 500 ml          │ │ Organic  ✓      │ │
│ ⠿ Milk type    one choice · filter  ✎   │ │ │ ₹27  ̶₹̶2̶8̶  [ADD]│ └─────────────────┘ │
│ ⠿ Pasteurised  yes/no               ✎   │ │ │ [Organic]       │ ┌ Filters ───────┐ │
│ ⠿ Old field    deprecated           ↺   │ │ └─────────────────┘ │ Milk type ▢Cow │ │
│ [+ Add field]                            │ │ ⚠ 2 Marathi labels missing          │ │
└──────────────────────────────────────────┘ └──────────────────────────────────────┘
Filters:  [Brand] [Price ₹0–50–100–200 ✎] [Veg] [Milk type] [Organic]   [+ Add filter]
```

**Add / edit field sheet**
1. **Type** as friendly cards with examples: *Text · Text in 3 languages · Number · Yes/No · One choice · Several choices · List · Date*.
2. **Label** EN / मराठी / हिंदी.
3. **Key** auto from the English label in `lower_snake_case` (`Fat %` → `fat`), unique across the effective schema, **locked after the first save**. No English letters → `field_1`, `field_2`.
4. Type settings: unit (`%`, `g`, `ml`, `days`…), min/max, **options editor** (label in 3 languages, value auto from English), multiline for text.
5. Flags: **Required**, **Filterable** (number/boolean/select/multiSelect only), **Badge on card** (boolean/select only, max 2 per category), **Show in Highlights** (default on), help text.

**Rules shown in the builder and enforced in SQL**
| Change | Allowed? | What happens |
|---|---|---|
| Labels, units, help text, option labels | ✅ anytime | Presentation only |
| Add optional field | ✅ | Existing products just don't show it |
| Add **required** field / make one required | ✅ with warning | `admin_products_missing_attribute()` → "23 products don't have *Milk type* yet. They can't be saved until it's filled." The product list gets a "Needs update (23)" filter. |
| Delete a saved field | ❌ | **Deprecate** instead (`"deprecated": true`): hidden from forms, filters and display; data kept; can be restored (↺) |
| Change type or key | ❌ | Add a new field, deprecate the old one |
| Remove a select option in use | ❌ in the builder | Mark the option `"hidden": true`; products using it still display its label |
| Structural change | auto | `schema_version` +1 (trigger), shown as "v4" |

**Templates** (bundled JSON, editable after picking): *Packaged food* (shelf life, ingredients, allergens, storage), *Fresh produce* (origin farm/region, sold by: weight/piece), *Dairy* (fat %, milk type, organic), *Personal care* (skin type, fragrance), *Household* (pack count, scent), *Blank*, *Copy existing…*.

**Live preview**
- Renders the **real** `ProductCard` (1.7), `ProductHighlights` (1.9) and `FilterSheet` (2.4) with the **draft** schema and a generated sample product.
- `sampleProduct(schema, lang)`: `number` → `min` or 1, `boolean` → true, `select` → first option, `multiSelect` → first two, `localizedText` → "Sample {label}", `localizedList` → 3 items, `date` → today + 90 days, plus a placeholder image tinted with the category colour.
- Language and theme toggles apply **only inside the preview** (a local `I18nextProvider` with its own instance + a `ThemeOverride`).
- **Translation report** under the preview: every label, option and unit missing `mr`/`hi`. Tap → jumps to the field.

**Steps**
1. Keep the draft in a Zustand store persisted to MMKV (`admin-schema-draft:<categoryId>`), so a crash or a closed tab doesn't lose work.
2. `validateSchema.ts` mirrors the SQL trigger rules (keys, types, options, labels, no deletes, no type change) for instant feedback. The SQL check is the final word.
3. **Save:** `update categories set attribute_schema = …, filters = …` → on success, invalidate `['categories']`, `['category', id]`, `['attribute-schema', id]`.
4. Show "Used by 61 of 84 products" next to each field (one RPC call per field on open, cached).

**Checks**
- Add *Milk type* (one choice: Cow/Buffalo/Toned), mark Filterable, save: the customer category screen shows a "Milk type" chip after refresh.
- Try to delete a saved field: the button is "Deprecate"; editing JSON in Studio to remove it is refused by the trigger.

**Tests:** shared cases file `supabase/tests/fixtures/schema-cases.json` run by **both** Jest (`validateSchema`) and pgTAP (trigger) so the two never drift; `sampleProduct` output always passes `validate_attributes` / the zod builder for every template; the preview renders every template in 3 languages × 2 themes without errors.

---

## 7.4 Product & variant editor (runtime zod)

**Goal:** add or edit a product with variants, legal info, tax and attributes in under 2 minutes, with mistakes caught before they reach customers.

**Files:** `app/admin/products/index.tsx`, `new.tsx`, `[id].tsx`, `src/features/attributes/inputs/*.tsx`, `src/features/attributes/registry.tsx` (adds `Input`), `src/features/attributes/buildZod.ts`, `src/features/admin/products/{ProductForm.tsx, VariantsEditor.tsx, LegalSection.tsx, usePriceGuard.ts, api.ts}`

**SQL:** Part E (`admin_upsert_product`, `log_variant_price_change`), Part C (attribute trigger).

**Product list:** search (uses `search_products` from Phase 2 with `include_inactive` handled client-side via a direct admin query), filters: category, brand, active/inactive, **Needs update**, **Out of stock**, **No image**. Each row: thumb, name, variants "500 ml · 1 L", price range, stock, active switch.

**Form sections**
| Section | Fields |
|---|---|
| **Basics** | Sub-category (picker grouped by parent), brand (search or "+ New brand"), name EN/MR/HI, description EN/MR/HI, veg/non-veg/not food (3-way), tags, active |
| **Attributes** | Rendered from `effectiveSchema(category)` through the registry's `Input` components. Changing the sub-category re-renders this section and keeps values whose keys still exist. |
| **Variants** | Repeatable rows: label (EN/MR/HI, e.g. "500 ml"), net quantity + unit, SKU, barcode (📷 scan with `expo-camera`), **MRP**, **selling price** (shows "7% OFF" live), max per order, default ◉, initial stock (new variants only; later changes go through the stock screen, Phase 6) |
| **Legal & tax** (required) | Manufacturer/packer name + address, country of origin (default "India"), shelf life ("6 months" / "Best before 3 days"), HSN code, GST rate (0 / 5 / 12 / 18 / 28 / 40 %). The store's FSSAI number is shown read-only as a reminder of what customers will see. |
| **Images** | 7.5 |

**Runtime zod**
```ts
// src/features/attributes/buildZod.ts
export function attributeZod(field: AttributeField): z.ZodTypeAny {
  const base = attributeRegistry[field.type].zod(field);   // e.g. number → z.number().min(field.min ?? -Infinity)
  return field.required && !field.deprecated ? base : base.optional().nullable();
}

export function buildProductSchema(schema: AttributeSchema) {
  const active = schema.fields.filter(f => !f.deprecated);
  return z.object({
    category_id: z.number({ required_error: 'pickSubCategory' }),
    name: localizedRequired,                 // en required, mr/hi optional
    description: localizedOptional,
    is_veg: z.boolean().nullable(),
    attributes: z.object(Object.fromEntries(active.map(f => [f.key, attributeZod(f)]))).strict(),
    manufacturer: z.object({ name: z.string().min(2), address: z.string().min(5) }),
    country_of_origin: z.string().min(2),
    shelf_life: z.string().optional(),
    hsn_code: z.string().regex(/^\d{4}(\d{2}){0,2}$/).optional().or(z.literal('')),
    gst_rate: z.number().min(0).max(40),
    variants: z.array(variantSchema).min(1),
  }).superRefine((v, ctx) => {
    const skus = v.variants.map(x => x.sku.trim().toUpperCase());
    skus.forEach((s, i) => skus.indexOf(s) !== i &&
      ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'duplicateSku' }));
  });
}

const variantSchema = z.object({
  id: z.number().optional(),
  sku: z.string().trim().min(2),
  barcode: z.string().trim().optional(),
  label: localizedRequired,
  net_quantity: z.number().positive(),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'pc', 'pack']),
  mrp: z.number().positive(),
  price: z.number().positive(),
  max_per_order: z.number().int().min(1).max(50).default(10),
  is_default: z.boolean(),
  initial_stock: z.number().int().min(0).optional(),
}).refine(v => v.price <= v.mrp, { path: ['price'], message: 'priceAboveMrp' });
```
`.strict()` mirrors the SQL rule "not a field of this category". When an older product has a **deprecated** key, the form keeps it in a hidden `_preserved` bag and sends it back unchanged.

**Attribute inputs** (added to the Phase 1 registry, one per type)
| Type | Input |
|---|---|
| `text` | `TextInput` (multiline if set) |
| `localizedText` | 3 tabs EN / मराठी / हिंदी + "Copy from English" |
| `number` | numeric keypad, − / + stepper, unit suffix |
| `boolean` | big Yes / No segmented toggle |
| `select` | segmented buttons (≤ 4 options) or a searchable sheet |
| `multiSelect` | chip selector |
| `localizedList` | add/remove rows, each with 3 language tabs |
| `date` | native date picker; `<input type="date">` on web |

**Guards that save real money**
- **Price typo guard** (`usePriceGuard`): if a price changes by more than **30 %**, or the price drops below 50 % of MRP, a confirm sheet shows "₹45 → ₹4.50. Is that right?".
- **Discount sanity:** a price equal to MRP shows no discount badge; a price above MRP can't be typed past validation.
- **Unsaved changes** guard on back/close; **draft autosave** to MMKV every 2 seconds (`admin-product-draft:<id|new>`).

**Save**
```ts
const { data, error } = await supabase.rpc('admin_upsert_product', { payload: toPayload(form, images) });
if (error) return applyServerErrors(error, setError);      // 22023 lines → fields
await removeOrphanImages(data.removed_image_paths);        // storage.from('catalog').remove(paths)
queryClient.invalidateQueries({ queryKey: ['product', data.slug] });
queryClient.invalidateQueries({ queryKey: ['products'] });
```
Price edits on a live product flow to customers in real time through the Phase 1 `variants:prices` channel, and carts re-quote (Phase 4).

**Checks**
- A product without manufacturer address can't be saved (client), and the same payload sent with `curl` is refused (server).
- Changing the price of a variant in a customer's open cart updates the cart within ~1 s and shows "Price changed".
- The audit log shows `price_change` with before/after.

**Tests:** `buildProductSchema` against every template + sample; strict unknown-key rejection; deprecated keys preserved; `toPayload` mapping; pgTAP: `admin_upsert_product` creates product + 2 variants + inventory rows + `initial` movement; second call with one variant removed sets it inactive; SKU used by another product → `23505`; price > MRP → `22023`; non-admin → `42501`.

---

## 7.5 Image upload (2 sizes)

**Goal:** sharp product photos that stay small on 2G and fit the 1 GB free Storage quota, made on the phone because Supabase image transformations are paid ⚠️.

**Files:** `src/features/admin/images/{processImage.ts, uploadImage.ts, ImageGrid.tsx, BulkMatcher.tsx}`, `app/admin/products/images.tsx`

**SQL:** Part J (bucket limits + admin policies), Part E (`admin_add_product_images`).

**Sizes**
| File | Size | Format | Used in |
|---|---|---|---|
| `<uuid>_full.webp` | 1080 px longest side, quality 0.8 (~80–150 KB) | WebP | Product detail gallery |
| `<uuid>_thumb.webp` | 300 px, quality 0.7 (~12–25 KB) | WebP | Cards, cart, orders |
| `<uuid>_share.jpg` (first image only) | 600 × 600, quality 0.75 (~50 KB) | **JPEG** | WhatsApp/Open Graph previews (Phase 8). WhatsApp doesn't reliably preview WebP. |

Paths: `catalog/products/<uuid>_full.webp`. The product id isn't in the path, so images can be uploaded **before** a new product is first saved. The share JPEG uses the same `<uuid>`, so Phase 8 derives it from `path` by replacing `_full.webp` with `_share.jpg`.

**Steps**
```ts
// processImage.ts
import * as ImageManipulator from 'expo-image-manipulator';
export async function processProductImage(uri: string, withShare: boolean) {
  const full  = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }],
                 { compress: 0.8, format: ImageManipulator.SaveFormat.WEBP });
  const thumb = await ImageManipulator.manipulateAsync(full.uri, [{ resize: { width: 300 } }],
                 { compress: 0.7, format: ImageManipulator.SaveFormat.WEBP });
  const share = withShare
    ? await ImageManipulator.manipulateAsync(full.uri, [{ resize: { width: 600, height: 600 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG })
    : null;
  return { full, thumb, share };                     // re-encoding also strips EXIF/GPS
}

// uploadImage.ts
export async function upload(path: string, uri: string, contentType: string) {
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from('catalog')
    .upload(path, body, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return path;
}
```
- Portrait photos: resize by the **longest side** (pass `height` instead of `width` when `height > width`).
- `ImageGrid`: pick multiple (`expo-image-picker`, `allowsMultipleSelection`), or take a photo; tiles show progress, retry and remove; long-press to reorder; the first tile is the main image; optionally tie an image to a variant ("1 L pack").
- On web, `expo-image-manipulator` uses a canvas. WebP encoding works in Chrome/Edge/Firefox; on old Safari, fall back to JPEG for `_full` and `_thumb` (check `canvas.toDataURL('image/webp')` once).
- **Photo tips** shown above the picker: white background, product fills 80 % of the frame, daylight, no flash glare. A ₹0 "lightbox" from a cardboard box and white paper is in the launch playbook (Phase 8.7).

**Bulk image matcher** (`app/admin/products/images.tsx`): pick 50 photos named by SKU (`AMUL-TAAZA-500.jpg`, `AMUL-TAAZA-500_2.jpg`). The screen groups files by SKU, shows "✓ 42 matched · ✗ 8 unknown SKU", processes and uploads them 3 at a time, then calls `admin_add_product_images(sku, images)`. This turns "photograph the shelf" into a 15-minute job.

**Checks:** a 4 MB camera photo becomes ~120 KB + ~18 KB; GPS EXIF is gone (check with an EXIF viewer); a customer card loads only the thumb (check network log).

**Tests:** `processProductImage` called with portrait/landscape sizes (mocked manipulator); `BulkMatcher.groupBySku` handles `_2`, `_3` suffixes and mixed case.

---

## 7.6 CSV import/export

**Goal:** load the first 500 products in an evening from a spreadsheet, and edit prices in bulk, without breaking Devanagari text.

**Files:** `app/admin/import.tsx`, `src/features/admin/csv/{template.ts, parse.ts, chunk.ts, exportCsv.ts}`, `assets/templates/products-template.csv`

**SQL:** Part B (`csv_bool`, `csv_localized`), Part F (`csv_attributes`, `admin_import_products`).

**Packages**
```bash
npx expo install expo-document-picker expo-file-system expo-sharing
npm install papaparse && npm install -D @types/papaparse
```

**CSV format** (one row per **variant**; product columns are read from the first row of each `product_slug`)
```
product_slug,category_slug,brand_slug,brand_name,name_en,name_mr,name_hi,description_en,description_mr,description_hi,is_veg,tags,hsn_code,gst_rate,country_of_origin,manufacturer_name,manufacturer_address,shelf_life,is_active,sku,barcode,variant_label_en,variant_label_mr,variant_label_hi,net_quantity,unit,mrp,price,max_per_order,is_default,stock,low_stock_threshold,attr.fat,attr.milk_type,attr.organic
amul-taaza,milk,amul,Amul,Amul Taaza Toned Milk,अमूल ताजा टोन्ड दूध,अमूल ताज़ा टोंड दूध,,,,yes,milk|doodh,0401,0,India,"Gujarat Co-op Milk Marketing Federation","Anand, Gujarat 388001",2 days,yes,AMUL-TAAZA-500,8901262150019,500 ml,५०० मिली,500 मिली,500,ml,28,27,6,yes,40,10,3,cow,no
amul-taaza,milk,amul,,,,,,,,,,,,,,,,,AMUL-TAAZA-1L,8901262150026,1 L,१ लिटर,1 लीटर,1,l,56,54,4,no,25,8,,,
```
- Booleans accept yes/no, true/false, 1/0, हो/नाही, हाँ/नहीं.
- Lists use `|`. Localized attribute columns are `attr.<key>_en|_mr|_hi`.
- **`stock`** sets the initial stock for new SKUs; for existing SKUs it means "set stock to" and is logged as an `adjustment`. Leave it empty to keep stock unchanged.
- **Images** aren't in the CSV. Use the bulk image matcher (7.5) after importing.
- The template is generated **per category** from the effective schema (`template.ts`), so the `attr.*` columns are always right.

**Import flow**
```
1. Pick file  →  2. Preflight (client)  →  3. Dry run (server)  →  4. Review  →  5. Import  →  6. Report
```
1. `DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'] })`.
2. `Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim().replace(/^﻿/, '') })`. Add `_row` (spreadsheet row number = index + 2). Preflight checks required columns exist and the file has ≤ 5,000 rows.
3. `chunk.ts` groups rows by `product_slug` and packs whole products into chunks of ≤ 300 rows (a product never spans two calls). Each chunk → `rpc('admin_import_products', { p_rows, p_dry_run: true })`, 2 chunks in parallel.
4. **Review:** "✓ 412 products OK (380 new, 32 updated) · ✗ 9 with errors". The error table shows row numbers, slug and the message (`variants[2].price: cannot be more than MRP`, `attr.milk_type: "Cow " is not one of the options`), plus **Download errors as CSV**.
5. **Import** runs the same chunks with `p_dry_run: false`. Chunks with errors import their good products only (per-product sub-transactions).
6. Invalidate `['products']`, `['home']`, `['categories']`.

**Export**
```ts
const rows = await fetchAllProductsForExport();   // products + variants + inventory, paged by 1000
const csv = '﻿' + Papa.unparse(rows, { columns: templateColumns(categoryId) });
if (Platform.OS === 'web') downloadBlob(csv, `nearkart-products-${today}.csv`);
else {
  const file = FileSystem.cacheDirectory + `nearkart-products-${today}.csv`;
  await FileSystem.writeAsStringAsync(file, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(file, { mimeType: 'text/csv' });
}
```
The `﻿` byte-order mark makes **Excel show Marathi and Hindi correctly**. Without it, Excel opens UTF-8 CSVs as gibberish. Tell users to save from Excel as **"CSV UTF-8 (Comma delimited)"**, not plain "CSV". Google Sheets is safe either way.

**Bulk price update** = export → change `mrp`/`price` in Sheets → import. Each change is logged (`price_change` audit) and pushed to open carts live.

**Checks:** a 300-row file dry-runs in < 8 s; a deliberate bad row is reported with its spreadsheet row number and nothing is written in dry-run mode; re-importing the same file reports "0 new, N updated" and changes nothing else.

**Tests:** `chunk.ts` never splits a product and respects 300 rows; BOM stripping; pgTAP: dry run leaves the tables unchanged but returns counts; a bad product doesn't block good ones; brand auto-created; `csv_bool('हो') = true`; attribute coercion errors are readable.

---

## 7.7 Banners, home sections, collections

**Goal:** the owner changes what customers see on Home for a festival or a weekend offer, schedules it, and it switches itself on and off.

**Files:** `app/admin/home/banners.tsx`, `sections.tsx`, `app/admin/home/collections/index.tsx`, `[id].tsx`, `src/features/admin/merch/{BannerForm.tsx, LinkPicker.tsx, ScheduleFields.tsx, SectionConfigForm.tsx, ProductPicker.tsx}`

**SQL:** Part D (`banners_admin_all`, `home_sections_admin_all`, `collections_admin_all`, `collection_products_admin_all`, `admin_reorder`, `admin_set_collection_products`). `get_home` from Phase 1 already filters by `is_active` and the `starts_at`/`ends_at` window.

**Banners**
- Image at **2:1** (crop guide in the picker, uploaded as `catalog/banners/<uuid>.webp`, 1080 × 540), optional title (3 languages, drawn on the image by the app for accessibility, not baked in).
- **Link picker** (`LinkPicker`, reused by Phase 8 campaigns): Category · Product · Collection · Search term → stored as `link = {type, value}`.
- **Schedule:** start / end date-time in **IST**, stored as `timestamptz` (`2026-11-01T06:00:00+05:30`). Status chip: *Live · Scheduled · Ended · Off*.
- Reorder with drag/arrows → `admin_reorder('banners', ids)`.

**Home sections**
| Type | Config editor | Notes |
|---|---|---|
| `banner_carousel` | none | Shows live banners |
| `category_grid` | pick and order categories (or "all active") | |
| `product_rail` | source: collection **or** sub-category, max items (default 12), sort (manual / bestselling / newest) | "Fresh fruits", "Under ₹99" |
| `collection_rail` | pick a collection | Big tile with the collection image |
| `buy_again` | none | Shown only to logged-in customers with past orders (Phase 8.2) |

Each section has title (3 languages), active switch, schedule and order. A **phone-frame preview** renders the real `HomeScreen` sections with the draft list ("what customers see at *date/time*", default now).

**Collections**
- Title (3 languages), slug, image, active.
- `ProductPicker`: search, multi-select, drag to order, "Add all from sub-category". Save → `admin_set_collection_products(id, productIds)`.
- Ideas to prepare ahead of time: *Diwali essentials*, *Ganpati pooja*, *Monsoon must-haves*, *Exam-week snacks*, *Under ₹49*, *New arrivals*.

**Checks:** a banner scheduled to start in 2 minutes appears on a customer's Home after it starts and a pull-to-refresh; an ended banner disappears without anyone touching it.

**Tests:** `ScheduleFields` converts IST input ↔ ISO correctly across midnight; `LinkPicker` produces valid `{type,value}`; status chip logic.

---

## 7.8 Store settings & fees

**Goal:** every number that affects checkout is editable, validated, explained in plain words and audited.

**Files:** `app/admin/settings.tsx`, `src/features/admin/settings/{FeesForm.tsx, HoursEditor.tsx, ServiceAreaEditor.tsx, LegalIdsForm.tsx, AppConfigForm.tsx, FeePreview.tsx}`

**SQL:** Part G (`admin_update_store_settings`), Part D (`app_config_admin_all`).

**Sections**
| Section | Fields | Help text shown |
|---|---|---|
| **Fees & limits** | minimum order, delivery fee, free delivery above, small-cart threshold & fee, packaging fee, max COD order value, max open orders per user | "Customers see these in Bill details before placing the order." |
| **Live preview** (`FeePreview`) | carts of ₹80, ₹150, ₹450 run through the same formula as `get_cart_quote` (a TS copy, tested against SQL) | "₹150 cart → delivery ₹20 + small cart ₹10 = ₹180" |
| **Timing** | ETA minutes, auto-cancel minutes | "Orders not accepted within 5 minutes are cancelled and the customer is told." |
| **Opening hours** | per weekday, one or more ranges, "closed all day" | Copy Monday to all days |
| **Delivery area** | store pin, radius slider (0.3–30 km) with a circle on the map, optional polygon (paste GeoJSON from geojson.io, free) | "Addresses outside this area can't order." |
| **Legal IDs** | GSTIN, FSSAI licence, seller name/address, customer-care phone, grievance officer | Shown on invoices and the Seller details page (Phase 9.8) |
| **App config** | support phone/WhatsApp, minimum app version, maintenance mode + message | Written to `app_config` |

**Steps**
1. One form, `react-hook-form` + zod with the **same limits as SQL** (fees ≥ 0, COD max ≥ minimum order, auto-cancel 2–60, radius 0.3–30, GSTIN/FSSAI regex).
2. Save sends **only changed fields** as `p_patch` to `admin_update_store_settings(storeId, patch)`.
3. Customers get the change live through the Phase 1 `store:<id>` Realtime channel (fees, ETA, open/closed). Carts re-quote.
4. A "History" link opens the audit rows for `entity = 'store'` with a before/after diff.

**Checks:** setting max COD below minimum order is refused with a clear message; changing the delivery fee updates an open customer cart within a second; the audit log has before/after.

**Tests:** `FeePreview` TS formula vs `get_cart_quote` via a pgTAP + Jest shared fixture; `HoursEditor` output passes the SQL format check.

---

## 7.9 Users & roles

**Goal:** give the shop helper Store mode, take it away when they leave, and stop abusive accounts, without touching SQL.

**Files:** `app/admin/users.tsx`, `src/features/admin/users/{UserRow.tsx, UserSheet.tsx, api.ts}`

**SQL:** Part H (`admin_list_users`, `admin_set_role`, `admin_set_user_blocked`), Part D (`profiles_admin_select`).

**Screen**
```
Users      [Search name / email / phone]   [All | Customers | Staff | Admins]
Rahul Patil   rahul@…   98xxxxxx12   Staff     14 orders · last 2 d ago      ›
Sneha K.      sneha@…   —            Customer  3 orders · 2 cancelled        ›
```
**User sheet:** role (Customer / Staff / Admin) with a confirm step, **Allow COD** switch, **Block** switch with a reason, order stats (placed, delivered, cancelled by customer), last 5 orders, "Call" / "WhatsApp".

**Rules**
- A person must **sign in once** before they can be promoted (their `profiles` row must exist). Onboarding a helper = "install the app, log in, tell me your email" → search → Staff.
- The **last admin** can't be demoted (SQL). You can't block yourself or an admin.
- Role changes notify the user ("Store mode is now available"). Their app re-reads the profile on the notification and on next focus, so Store mode appears/disappears without reinstalling.
- **COD abuse:** a customer with 3+ customer-side cancellations gets a "⚠ frequent cancellations" tag; the admin can switch off COD for them (they'll be able to pay online once Phase 10 ships).

**Checks:** promoting a user to Staff shows Store mode on their phone after the notification; demoting the only admin fails; a blocked user's `place_order` is refused (Phase 4 rule).

**Tests:** pgTAP: last-admin protection, self-block refused, customer calling `admin_set_role` → `42501`, audit rows written.

---

## 7.10 Dashboard & reports

**Goal:** the owner opens one screen in the morning and knows how yesterday went, what's running out, and **what people wanted but couldn't find**.

**Files:** `app/admin/index.tsx`, `app/admin/reports/[report].tsx`, `app/admin/synonyms.tsx`, `src/features/admin/reports/{StatTile.tsx, SalesBars.tsx, api.ts}`

**SQL:** Part I (views + `admin_dashboard_today`), Part D (`search_synonyms_admin_all`, `search_queries_admin_select`).

**Dashboard**
```
Today (IST)                                              ⟳ live
┌ Orders ┐ ┌ Order value ┐ ┌ Avg order ┐ ┌ In progress ┐ ┌ Cancelled ┐
│   37   │ │  ₹14,820    │ │   ₹401    │ │      4      │ │     2     │
└────────┘ └─────────────┘ └───────────┘ └─────────────┘ └───────────┘
Last 14 days ▁▃▅▂▆▇▅▃▆█▆▅▇▆  (orders · tap a bar for that day)
⚠ 12 items low on stock ›     🔍 9 searches found nothing this week ›    🧾 1 open issue ›
Top products (30 d) ›         Cancellation reasons (30 d) ›              New customers today: 5
```
- Tiles: `rpc('admin_dashboard_today')`. Refetched on any INSERT/UPDATE event from the staff `store-orders:store=<id>` channel (Phase 6) and every 60 s.
- 14-day bars: `from('v_sales_daily').select().gte('day', d14).order('day')`, drawn with `react-native-svg` (no paid chart library). Values in ₹ with Indian grouping; bars have accessible labels.

**Reports** (`reports/[report].tsx`, one generic table screen per view, sortable, **Export CSV** with BOM)
| Report | Source | Actions |
|---|---|---|
| Sales by day | `v_sales_daily` | Date range |
| Top products | `v_top_products` | Open product |
| Low stock | `v_low_stock` | **days of cover** column; "Update stock" → Phase 6 stock screen |
| Zero-result searches | `v_zero_result_searches` | **Add synonym** (prefilled `term` = the query) · **Create product** (prefilled name) · Dismiss |
| Cancellations | `v_cancellations` | Grouped by who cancelled and why |

**Synonyms** (`admin/synonyms.tsx`): list/add/edit/delete `search_synonyms` (`doodh → milk`, `दूध → milk`, `bhindi → okra`, `sabun → soap`) with a **"Test search"** box that calls `search_products` and shows the top 5 results live. The zero-result report links here. This loop (*search fails → add synonym or stock the item*) is the cheapest growth tool the store has.

**Checks:** the numbers match a hand count from Studio for one day; a zero-result search done on a customer phone shows up in the report within a minute; adding a synonym makes the same search return results.

**Tests:** pgTAP: views return 0 rows for a customer (not an error, thanks to `where is_admin()`) and correct sums for a seeded day crossing IST midnight (an order at 23:50 IST counts for that day, not the next); `StatTile` formats ₹ correctly.

---

## Testing for Phase 7

| Area | Tests |
|---|---|
| SQL (pgTAP, `supabase/tests/0700_admin.test.sql`) | attribute validation per type; schema trigger rules (no delete, no type change, 2 levels, version bump); `admin_upsert_product` happy path + every validation error; SKU conflict; images replace + removed paths; `admin_import_products` dry run/no writes, per-product errors, stock adjustments logged; store settings validation; last-admin protection; every admin function → `42501` for customer and staff; views empty for non-admins; storage policies (customer upload to `catalog` refused) |
| Shared fixtures | `schema-cases.json` (schema rules) and `attribute-cases.json` (values) run in **both** Jest and pgTAP |
| Unit (Jest) | `buildProductSchema`, `validateSchema`, `sampleProduct`, `slugify`, CSV `chunk`/parse, fee preview formula, IST schedule conversion, `parseRpcError` |
| Component (RNTL) | FieldSheet (key generation, type settings), VariantsEditor (default radio, discount label), price guard sheet, ImageGrid states, import review table |
| E2E (Maestro) `.maestro/admin-no-code.yaml` | admin logs in → new category "Pooja Items" + sub-category "Agarbatti" → adds field "Fragrance" (one choice) → creates product with 2 variants and a photo → logs out → guest opens Categories → sees "Pooja Items" → filters by Fragrance → adds to cart |
| Manual | web admin on Chrome + a 10" Android tablet; CSV round trip through Excel (UTF-8) and Google Sheets; 3 languages in the preview |

---

## Phase 7 wrap-up

- **New SQL:** `admin_audit_log`; helpers `slugify`, `csv_bool`, `csv_localized`, `csv_attributes`; `effective_attribute_schema`, `validate_attributes`, triggers `products_validate_attributes`, `categories_validate_schema`, `product_variants_price_log`; RPCs `admin_products_missing_attribute`, `admin_reorder`, `admin_set_collection_products`, `admin_upsert_product`, `admin_add_product_images`, `admin_import_products`, `admin_update_store_settings`, `admin_list_users`, `admin_set_role`, `admin_set_user_blocked`, `admin_dashboard_today`; views `v_sales_daily`, `v_top_products`, `v_low_stock`, `v_zero_result_searches`, `v_cancellations`; admin RLS on catalog and merchandising tables; `catalog` bucket write policies.
- **New app areas:** `app/admin/*`, `src/features/admin/*`, attribute `Input` components, runtime zod builder, image pipeline (full + thumb + share JPEG), CSV import/export, web build on Cloudflare Pages.
- **What the business can do now:** run the catalog, merchandising, prices, fees, staff and reporting without a developer.
- **Next:** Phase 8 adds wishlist, buy again, reviews, sharing with WhatsApp previews (using the `_share.jpg` made here), campaigns and the launch playbook.
