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
-- Admin write policies on catalog/merchandising tables already exist (Phases 0–2:
-- "<table>: admin write"), so none are added here.

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
  v_store_id     bigint := coalesce(nullif(payload->>'store_id', '')::bigint, public.default_store_id());
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
  v_store_id bigint := public.default_store_id();
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

  -- protect_profile_privileges() (Phase 0) allows the change because the caller is_admin().
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

  -- protect_profile_privileges() (Phase 0) allows the change because the caller is_admin().
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

-- Admin insert/update/delete policies on the catalog bucket were created in Phase 1 (1.2).

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
