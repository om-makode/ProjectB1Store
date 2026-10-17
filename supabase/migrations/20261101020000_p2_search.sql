-- =====================================================================
-- 0200_search.sql · Phase 2: search, synonyms, logging, stock alerts, related
-- Requires 0100_catalog.sql (products.search_text, normalize_search, v_variant_offers, …)
-- =====================================================================

-- ---------- synonyms -------------------------------------------------

create table public.search_synonyms (
  id         bigint generated always as identity primary key,
  term       text not null,          -- what people type: 'doodh', 'दूध', 'kanda'
  maps_to    text not null,          -- what's in our catalog: 'milk', 'onion'
  created_at timestamptz not null default now(),
  unique (term, maps_to)
);
create index search_synonyms_term_trgm on public.search_synonyms using gin (term extensions.gin_trgm_ops);

-- Always store synonyms normalized, so lookups are exact matches.
create or replace function public.search_synonyms_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.term    := public.normalize_search(trim(new.term));
  new.maps_to := public.normalize_search(trim(new.maps_to));
  if new.term = '' or new.maps_to = '' or new.term = new.maps_to then
    raise exception 'Synonym term and target must be non-empty and different';
  end if;
  return new;
end $$;
create trigger search_synonyms_normalize before insert or update on public.search_synonyms
  for each row execute function public.search_synonyms_normalize();

alter table public.search_synonyms enable row level security;
create policy "synonyms: read"        on public.search_synonyms for select using (true);
create policy "synonyms: admin write" on public.search_synonyms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- search log (what people look for) ------------------------

create table public.search_queries (
  id            bigint generated always as identity primary key,
  query         text not null check (length(query) between 1 and 100),
  normalized    text not null,
  language      text check (language in ('en', 'mr', 'hi')),
  results_count int  not null check (results_count >= 0),
  requested     boolean not null default false,   -- tapped "Request this product"
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index search_queries_created_idx on public.search_queries (created_at desc);
create index search_queries_zero_idx    on public.search_queries (normalized, created_at desc)
  where results_count = 0 or requested;

alter table public.search_queries enable row level security;
-- No insert/update policy: only log_search() writes. Only staff read (Phase 7 report).
create policy "search_queries: staff read" on public.search_queries for select to authenticated
  using (public.is_staff());

-- ---------- stock alerts ("Notify me") -------------------------------

create table public.stock_alerts (
  user_id      uuid   not null references auth.users(id) on delete cascade,
  variant_id   bigint not null references public.product_variants(id) on delete cascade,
  created_at   timestamptz not null default now(),
  triggered_at timestamptz,      -- set by the restock trigger (this phase)
  notified_at  timestamptz,      -- set when the notification is actually sent (Phase 5)
  primary key (user_id, variant_id)
);
create index stock_alerts_pending_idx on public.stock_alerts (variant_id) where notified_at is null;

alter table public.stock_alerts enable row level security;
create policy "stock_alerts: own read"   on public.stock_alerts for select to authenticated using (user_id = auth.uid());
create policy "stock_alerts: own delete" on public.stock_alerts for delete to authenticated using (user_id = auth.uid());
-- Inserts and resets only through toggle_stock_alert(), so users can't fake triggered_at/notified_at.

-- ---------- query expansion ------------------------------------------

-- Returns the normalized query plus synonym-expanded variants.
create or replace function public.expand_search_terms(p_q text)
returns text[] language sql stable set search_path = '' as $$
  with q as (
    -- normalize and strip LIKE wildcards / backslashes so user input can't change the pattern
    select trim(regexp_replace(public.normalize_search(left(coalesce(p_q, ''), 100)), '[%_\\]+', ' ', 'g')) as q
  ),
  words as (
    select t.w, t.ord
      from q, regexp_split_to_table(q.q, '\s+') with ordinality as t(w, ord)
     where t.w <> ''
  ),
  mapped as (
    select w.ord,
           coalesce(
             (select s.maps_to from public.search_synonyms s where s.term = w.w limit 1),
             case when length(w.w) >= 4 then
               (select s.maps_to from public.search_synonyms s
                 where extensions.similarity(s.term, w.w) >= 0.5
                 order by extensions.similarity(s.term, w.w) desc limit 1)
             end,
             w.w) as w
      from words w
  )
  select coalesce(array_agg(distinct t) filter (where t is not null and length(t) >= 2), '{}')
    from (
      select q from q
      union all select string_agg(m.w, ' ' order by m.ord) from mapped m
      union all select s.maps_to from public.search_synonyms s, q where s.term = q.q
    ) x(t)
$$;

-- ---------- search_products ------------------------------------------

create or replace function public.search_products(
  p_q        text,
  p_lang     text   default 'en',
  p_filters  jsonb  default '{}'::jsonb,
  p_page     int    default 0,
  p_size     int    default 20,
  p_store_id bigint default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.35
as $$
declare
  v_store  bigint := coalesce(p_store_id, public.default_store_id());
  v_size   int    := least(greatest(coalesce(p_size, 20), 1), 50);
  v_page   int    := greatest(coalesce(p_page, 0), 0);
  v_terms  text[];
  v_ids    bigint[];
  v_cats   jsonb := '[]'::jsonb;
begin
  v_terms := public.expand_search_terms(p_q);
  if coalesce(array_length(v_terms, 1), 0) = 0 then
    return jsonb_build_object('items', '[]'::jsonb, 'has_more', false, 'page', 0,
                              'terms', '[]'::jsonb, 'categories', '[]'::jsonb);
  end if;

  select array_agg(x.id order by x.rn) into v_ids
  from (
    select p.id,
           row_number() over (order by (o.available_qty > 0) desc, m.score desc, p.sort_order, p.id) as rn
      from public.products p
      join public.categories c on c.id = p.category_id and c.is_active
      join lateral (
        select max(greatest(
                 extensions.word_similarity(t, p.search_text),
                 case when p.search_text like t || '%'        then 1.0
                      when p.search_text like '% ' || t || '%' then 0.9
                      when p.search_text like '%' || t || '%'  then 0.7
                      else 0 end)) as score
          from unnest(v_terms) as t
         where t operator(extensions.<%) p.search_text
            or p.search_text like '%' || t || '%'
      ) m on m.score is not null
      join lateral (
        select vo.price, vo.available_qty from public.v_variant_offers vo
         where vo.product_id = p.id and vo.store_id = v_store and vo.is_active
         order by (vo.available_qty > 0) desc, vo.is_default desc, vo.sort_order, vo.variant_id
         limit 1
      ) o on true
     where p.is_active
       and public.product_matches_filters(p.attributes, p.brand_id, p.is_veg,
                                          o.price, o.available_qty, p_filters)
     order by rn
     offset v_page * v_size limit v_size + 1
  ) x;

  -- Matching categories, shown as chips above results (first page only)
  if v_page = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name,
                                                 'image_path', c.image_path, 'parent_id', c.parent_id)), '[]'::jsonb)
      into v_cats
      from (
        select c.* from public.categories c
         where c.is_active
           and exists (select 1 from unnest(v_terms) t
                        where public.normalize_search(concat_ws(' ', c.name->>'en', c.name->>'mr', c.name->>'hi'))
                              like '%' || t || '%')
         order by c.parent_id nulls first, c.sort_order
         limit 4
      ) c;
  end if;

  return jsonb_build_object(
    'items',      public.catalog_product_cards(v_store, coalesce(v_ids[1:v_size], '{}'::bigint[])),
    'has_more',   coalesce(array_length(v_ids, 1), 0) > v_size,
    'page',       v_page,
    'terms',      to_jsonb(v_terms),
    'categories', v_cats);
end $$;

-- ---------- suggestions (autocomplete) -------------------------------

create or replace function public.search_suggestions(p_q text, p_limit int default 8)
returns jsonb
language sql stable security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.35
as $$
  with t as (select unnest(public.expand_search_terms(p_q)) as t),
  cat as (
    select 'category'::text as kind, c.slug, c.name as label, c.image_path, 1 as prio,
           max(extensions.word_similarity(t.t, public.normalize_search(concat_ws(' ', c.name->>'en', c.name->>'mr', c.name->>'hi')))) as score
      from public.categories c, t
     where c.is_active
       and public.normalize_search(concat_ws(' ', c.name->>'en', c.name->>'mr', c.name->>'hi')) like '%' || t.t || '%'
     group by c.id
     order by score desc limit 3
  ),
  brand as (
    select 'brand'::text, b.slug, b.name, b.logo_path, 2,
           max(extensions.word_similarity(t.t, public.normalize_search(concat_ws(' ', b.name->>'en', b.name->>'mr', b.name->>'hi'))))
      from public.brands b, t
     where public.normalize_search(concat_ws(' ', b.name->>'en', b.name->>'mr', b.name->>'hi')) like t.t || '%'
     group by b.id
     order by 6 desc limit 2
  ),
  prod as (
    select 'product'::text, p.slug, p.name,
           (select coalesce(pi.thumb_path, pi.path) from public.product_images pi
             where pi.product_id = p.id order by pi.sort_order, pi.id limit 1),
           3,
           max(greatest(extensions.word_similarity(t.t, p.search_text),
                        case when p.search_text like t.t || '%' then 1.0 else 0 end))
      from public.products p, t
     where p.is_active
       and (t.t operator(extensions.<%) p.search_text or p.search_text like '%' || t.t || '%')
     group by p.id
     order by 6 desc limit greatest(p_limit, 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'slug', slug, 'label', label, 'image_path', image_path)
                            order by prio, score desc), '[]'::jsonb)
    from (select * from (select * from cat union all select * from brand union all select * from prod) u
          order by prio, score desc limit least(greatest(p_limit, 1), 12)) s
$$;

-- ---------- trending (from real searches, falls back to app_config) --

create or replace function public.trending_searches(p_limit int default 8)
returns jsonb language sql stable security definer set search_path = '' as $$
  with real as (
    select normalized
      from public.search_queries
     where created_at > now() - interval '7 days' and results_count > 0
     group by normalized
    having count(distinct coalesce(user_id::text, id::text)) >= 3      -- at least 3 different searches
     order by count(*) desc
     limit least(greatest(p_limit, 1), 20)
  )
  select case when (select count(*) from real) >= 3
              then (select jsonb_agg(normalized) from real)
              else coalesce((select value from public.app_config where key = 'trending_searches'), '[]'::jsonb)
         end
$$;

-- ---------- logging --------------------------------------------------

-- Called by the app when a search "counts" (submitted, suggestion tapped,
-- results viewed for 2 s) and when "Request this product" is tapped.
-- results_count comes from the client: it is analytics only, never used for decisions.
create or replace function public.log_search(
  p_query text, p_lang text, p_results_count int, p_requested boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_norm text := public.normalize_search(trim(left(coalesce(p_query, ''), 100)));
  v_uid  uuid := auth.uid();
begin
  if length(v_norm) < 2 then return; end if;
  -- de-duplicate the same user's same query within 1 minute (requests always recorded)
  if v_uid is not null and not p_requested and exists (
       select 1 from public.search_queries
        where user_id = v_uid and normalized = v_norm and created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.search_queries (query, normalized, language, results_count, requested, user_id)
  values (left(trim(p_query), 100), v_norm,
          case when p_lang in ('en', 'mr', 'hi') then p_lang end,
          greatest(coalesce(p_results_count, 0), 0), coalesce(p_requested, false), v_uid);
end $$;

-- ---------- filter options (counts for the filter sheet) -------------

create or replace function public.category_filter_options(p_category_id bigint, p_store_id bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with prods as (
    select p.* from public.products p
      join public.categories c on c.id = p.category_id and c.is_active
     where p.is_active and (p.category_id = p_category_id or c.parent_id = p_category_id)
  ),
  b as (
    select coalesce(jsonb_agg(jsonb_build_object('id', br.id, 'name', br.name, 'count', x.n)
                              order by x.n desc, br.id), '[]'::jsonb) as v
      from (select brand_id, count(*) n from prods where brand_id is not null group by brand_id) x
      join public.brands br on br.id = x.brand_id
  ),
  av as (
    select e.key as k, coalesce(a.value, e.value #>> '{}') as v, count(*) as n
      from prods
     cross join lateral jsonb_each(prods.attributes) e
      left join lateral jsonb_array_elements_text(
             case when jsonb_typeof(e.value) = 'array' then e.value end) a(value) on true
     where jsonb_typeof(e.value) in ('string', 'array', 'boolean')
       and not (jsonb_typeof(e.value) = 'array' and a.value is null)
     group by 1, 2
  ),
  a as (
    select coalesce(jsonb_object_agg(k, vals), '{}'::jsonb) as v
      from (select k, jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc) vals
              from av group by k) z
  ),
  pr as (
    select jsonb_build_object('min', min(o.price), 'max', max(o.price)) as v
      from prods p
      join public.v_variant_offers o
        on o.product_id = p.id and o.store_id = coalesce(p_store_id, public.default_store_id()) and o.is_active
  )
  select jsonb_build_object('brands', b.v, 'attributes', a.v, 'price', pr.v,
                            'veg_count', (select count(*) from prods where is_veg))
    from b, a, pr
$$;

-- ---------- Notify me ------------------------------------------------

create or replace function public.toggle_stock_alert(p_variant_id bigint, p_on boolean)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;
  if not p_on then
    delete from public.stock_alerts where user_id = v_uid and variant_id = p_variant_id;
    return false;
  end if;
  if (select count(*) from public.stock_alerts where user_id = v_uid and notified_at is null) >= 50 then
    raise exception 'too_many_alerts' using errcode = 'P0001';
  end if;
  insert into public.stock_alerts (user_id, variant_id)
  values (v_uid, p_variant_id)
  on conflict (user_id, variant_id)
  do update set created_at = now(), triggered_at = null, notified_at = null;   -- re-arm an old alert
  return true;
end $$;

-- When a variant goes from "not sellable" to "sellable", mark waiting alerts.
-- Phase 5 replaces this function body to also insert a notification row and set notified_at.
create or replace function public.notify_back_in_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.stock = 0 or not old.is_available)
     and new.stock > 0 and new.is_available then
    update public.stock_alerts
       set triggered_at = now()
     where variant_id = new.variant_id
       and notified_at is null
       and triggered_at is null;
  end if;
  return null;
end $$;
create trigger inventory_back_in_stock after update of stock, is_available on public.inventory
  for each row execute function public.notify_back_in_stock();

-- ---------- related products (2.7) -----------------------------------

-- p_kind: 'similar'  = same sub-category, similar price, alternatives (other brands welcome)
--         'together' = complementary items: shared tags in sibling sub-categories,
--                      falling back to the "bestsellers" collection.
-- Phase 4+ can switch 'together' to real co-purchase data from order_items.
create or replace function public.related_products(
  p_product_id bigint, p_kind text default 'similar', p_limit int default 12, p_store_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store bigint := coalesce(p_store_id, public.default_store_id());
  v_limit int    := least(greatest(coalesce(p_limit, 12), 1), 24);
  me      record;
  v_ids   bigint[];
begin
  select p.id, p.category_id, p.brand_id, p.tags, c.parent_id,
         (select o.price from public.v_variant_offers o
           where o.product_id = p.id and o.store_id = v_store and o.is_active
           order by o.is_default desc, o.sort_order limit 1) as price
    into me
    from public.products p join public.categories c on c.id = p.category_id
   where p.id = p_product_id;
  if not found then return '[]'::jsonb; end if;

  if p_kind = 'together' then
    select array_agg(id order by score desc, sort_order) into v_ids from (
      select p.id, p.sort_order,
             cardinality(array(select unnest(p.tags) intersect select unnest(me.tags))) as score
        from public.products p
        join public.categories c on c.id = p.category_id
       where p.is_active and p.id <> me.id
         and p.category_id <> me.category_id
         and c.parent_id = me.parent_id
         and exists (select 1 from public.v_variant_offers o
                      where o.product_id = p.id and o.store_id = v_store and o.available_qty > 0)
       order by score desc, p.sort_order
       limit v_limit) x;
    if coalesce(array_length(v_ids, 1), 0) < 4 then
      select array_agg(cp.product_id order by cp.sort_order) into v_ids
        from public.collection_products cp
        join public.collections col on col.id = cp.collection_id and col.slug = 'bestsellers'
       where cp.product_id <> me.id;
      v_ids := v_ids[1:v_limit];
    end if;
  else
    select array_agg(id order by rank) into v_ids from (
      select p.id,
             row_number() over (order by abs(o.price - coalesce(me.price, o.price)), p.sort_order) as rank
        from public.products p
        join lateral (select vo.price from public.v_variant_offers vo
                       where vo.product_id = p.id and vo.store_id = v_store and vo.available_qty > 0
                       order by vo.is_default desc, vo.sort_order limit 1) o on true
       where p.is_active and p.id <> me.id and p.category_id = me.category_id
         and (me.price is null or o.price between me.price * 0.5 and me.price * 2)
       order by rank
       limit v_limit) x;
  end if;

  return public.catalog_product_cards(v_store, coalesce(v_ids, '{}'::bigint[]));
end $$;

-- ---------- collection page (2.7) ------------------------------------

create or replace function public.list_collection_products(
  p_slug text, p_page int default 0, p_size int default 20, p_store_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store bigint := coalesce(p_store_id, public.default_store_id());
  v_size  int    := least(greatest(coalesce(p_size, 20), 1), 50);
  v_page  int    := greatest(coalesce(p_page, 0), 0);
  v_col   public.collections;
  v_ids   bigint[];
begin
  select * into v_col from public.collections where slug = p_slug and is_active;
  if not found then return null; end if;
  select array_agg(x.product_id order by x.rn) into v_ids from (
    select cp.product_id,
           row_number() over (order by
             exists (select 1 from public.v_variant_offers o
                      where o.product_id = cp.product_id and o.store_id = v_store and o.available_qty > 0) desc,
             cp.sort_order) as rn
      from public.collection_products cp
      join public.products p on p.id = cp.product_id and p.is_active
     where cp.collection_id = v_col.id
     order by rn offset v_page * v_size limit v_size + 1) x;
  return jsonb_build_object(
    'collection', jsonb_build_object('id', v_col.id, 'slug', v_col.slug, 'title', v_col.title, 'image_path', v_col.image_path),
    'items',      public.catalog_product_cards(v_store, coalesce(v_ids[1:v_size], '{}'::bigint[])),
    'has_more',   coalesce(array_length(v_ids, 1), 0) > v_size,
    'page',       v_page);
end $$;
