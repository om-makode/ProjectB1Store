# Phase 2: Search & Discovery

> **Goal:** a customer finds any product in a few keystrokes (or by voice), in English, Marathi, Hindi or "Hinglish" (*doodh*, *kanda*, *aata*), narrows results with filters that fit the category, and is never left at a dead end: zero-result searches are captured, and out-of-stock items offer "Notify me".
> **Duration:** about 1 week · **Depends on:** Phase 1 · **Next:** Phase 3 (Accounts, Addresses & Serviceability)

**Done when:**
- [ ] `0200_search.sql` applies cleanly and its pgTAP tests pass
- [ ] Typing `milk`, `doodh`, `dudh`, `दूध` or `amul` shows milk products within about 300 ms of the last keystroke on 4G
- [ ] A typo (`tamatr`, `biskit`) still finds the product
- [ ] Results are in-stock first; category and brand suggestions appear above results
- [ ] Voice search works in `mr-IN`, `hi-IN` and `en-IN` where the phone supports it, and the mic is hidden where it doesn't
- [ ] The category screen's **Filters** and **Sort** sheets are built entirely from `categories.filters` (no category-specific code) and show counts
- [ ] A zero-result search shows a helpful empty state and **"Request this product"**, and both appear in `search_queries`
- [ ] Out-of-stock items show **Notify me**; a logged-in user's alert is stored, and restocking in Studio marks it `triggered_at`
- [ ] Product detail shows **Similar products** and **Often bought together** rails; collection pages open from banners and rails

| # | Heading | Output |
|---|---|---|
| 2.1 | Search schema (trigram, synonyms, logging) | `0200_search.sql` |
| 2.2 | Search screen (instant, recent, trending) | `app/search.tsx`, `useSearch` |
| 2.3 | Suggestions & voice search | `search_suggestions()`, `VoiceSearchButton` |
| 2.4 | Filters & sort sheet (schema-driven) | `FilterSheet`, `SortSheet`, `category_filter_options()` |
| 2.5 | Zero-result capture | `log_search()`, empty state, request button |
| 2.6 | "Notify me" for out-of-stock | `stock_alerts`, `toggle_stock_alert()`, trigger |
| 2.7 | Similar & often-bought-together | `related_products()`, rails, collection pages |

---

## 2.1 Search schema (trigram, synonyms, logging)

**Goal:** fast, typo-tolerant, multilingual search with **no paid search service** (no Algolia, no Elastic). Postgres `pg_trgm` over `products.search_text` (maintained since Phase 1) plus an admin-managed synonym table.

**Files**
```
supabase/migrations/0200_search.sql
supabase/seed.sql                       (append synonyms)
supabase/tests/0200_search.test.sql
```

### How matching works

```
"Amul Doodh"  ──normalize──►  "amul doodh"
                    │
                    ├── whole-phrase synonym?          (none)
                    ├── word-by-word synonyms          "amul milk"
                    │      exact term, else closest term with similarity ≥ 0.5 (dudh → doodh → milk)
                    ▼
           terms = {"amul doodh", "amul milk"}
                    │
products.search_text (en + mr + hi names, brand, category, tags) matched with:
   • word_similarity (typos)            term <% search_text
   • substring (prefix / inside)         search_text LIKE '%term%'
                    │
score = best over terms (prefix 1.0 > word start 0.9 > inside 0.7 > fuzzy)
order = in stock first, then score, then sort_order
```

Why trigrams work for Devanagari: `pg_trgm` builds trigrams from characters, so `दूध` matches `दूध` inside `अमूल ताजा टोन्ड दूध`. Marathi and Hindi users who type in Latin script ("kanda", "aata") are covered by **synonyms** and by **tags** on products.

### SQL: `supabase/migrations/0200_search.sql`

```sql
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
```

> **`set pg_trgm.word_similarity_threshold`** on the function controls the `<%` operator (default 0.6 is too strict for typos in short words). 0.35 is a good start; tune it with real queries from `search_queries` in Phase 7.

### Seed synonyms (append to `seed.sql`)

```sql
insert into public.search_synonyms (term, maps_to) values
  -- Latin-script Marathi/Hindi → catalog English
  ('doodh','milk'), ('dudh','milk'), ('dahi','curd'), ('anda','egg'), ('ande','egg'), ('andi','egg'),
  ('kanda','onion'), ('pyaz','onion'), ('pyaaz','onion'), ('batata','potato'), ('aloo','potato'), ('alu','potato'),
  ('tamatar','tomato'), ('tameta','tomato'), ('mirchi','chilli'), ('kothimbir','coriander'), ('dhaniya','coriander'),
  ('aata','atta'), ('ata','atta'), ('gehu','wheat'), ('chawal','rice'), ('tandul','rice'),
  ('sakhar','sugar'), ('chini','sugar'), ('cheeni','sugar'), ('tel','oil'), ('namak','salt'), ('meeth','salt'),
  ('haldi','turmeric'), ('halad','turmeric'), ('jeera','cumin'), ('jira','cumin'), ('sabun','soap'),
  ('biskit','biscuit'), ('biscut','biscuit'), ('chai','tea'), ('chaha','tea'), ('paav','pav'), ('double roti','bread'),
  -- Devanagari words that may not appear in a product's own name
  ('दूध','milk'), ('कांदा','onion'), ('प्याज','onion'), ('बटाटा','potato'), ('आलू','potato'),
  ('साखर','sugar'), ('चीनी','sugar'), ('तेल','oil'), ('साबण','soap'), ('साबुन','soap'), ('चहा','tea'), ('चाय','tea');

insert into public.app_config (key, value) values
  ('trending_searches', '["milk","atta","onion","biscuits","oil","eggs","bread","sugar"]')
on conflict (key) do update set value = excluded.value;
```

**Steps**
1. `supabase migration new search` → `0200_search.sql`; paste.
2. `supabase db reset`, then `supabase gen types typescript --local > mobile/src/types/database.ts`.
3. Try in Studio's SQL editor: `select public.search_products('doodh');`, `select public.search_products('दूध');`, `select public.search_products('tamatr');`.
4. `explain analyze select public.search_products('milk');` should show `products_search_trgm` (Bitmap Index Scan) once there are more than a few hundred products. For 60 seed products Postgres may choose a sequential scan, which is fine.

**Checks**
- `expand_search_terms('Amul Doodh')` returns `{amul doodh, amul milk}`.
- `expand_search_terms('50%_off')` contains no `%` or `_`.
- As `anon`: `select * from search_queries` returns 0 rows; `select log_search('xyz','en',0)` succeeds.

**Tests: `supabase/tests/0200_search.test.sql`**
```sql
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
```

---

## 2.2 Search screen (instant, recent, trending)

**Goal:** Blinkit-style instant search: results update as you type, the keyboard never lags, and the screen is useful before the first keystroke.

**Files**
```
mobile/app/search.tsx
mobile/src/features/search/api.ts
mobile/src/features/search/useSearch.ts
mobile/src/features/search/useRecentSearches.ts
mobile/src/features/search/SearchInput.tsx
mobile/src/features/search/SearchIdle.tsx          # recent + trending + categories
mobile/src/features/search/SearchResults.tsx
mobile/src/lib/useDebouncedValue.ts
```

**Screen states**
```
Idle (empty input)                Typing (≥ 2 chars)                   Zero results
┌──────────────────────────┐      ┌──────────────────────────┐        ┌──────────────────────────┐
│ ← [Search "atta"    ] 🎤 │      │ ← [doodh            ] ✕  │        │ ← [ghee pickle      ] ✕  │
│ Recent searches   Clear  │      │ 🗂 Milk  (category)       │        │   (illustration)         │
│ ↺ milk   ↺ parle-g       │      │ 🏷 Amul  (brand)          │        │ No results for           │
│ Trending                 │      │ Showing results for milk │        │ "ghee pickle"            │
│ ↗ atta ↗ onion ↗ eggs    │      │ [card] [card]            │        │ • Check the spelling     │
│ Popular categories       │      │ [card] [card]            │        │ • Try fewer words        │
│ [tile][tile][tile][tile] │      │ …                        │        │ [Request this product]   │
└──────────────────────────┘      └──────────────────────────┘        │ Bestsellers rail         │
                                                                       └──────────────────────────┘
```

**Rotating placeholder** (small detail, big effect): the hint cycles every 2.5 s through trending terms: *Search "milk"* → *Search "atta"* → *Search "eggs"*, localized, and is paused when "Reduce motion" is on.

**API**
```ts
// src/features/search/api.ts
export type SearchPage = {
  items: ProductCardData[]; has_more: boolean; page: number;
  terms: string[]; categories: { id: number; slug: string; name: Localized; image_path: string | null; parent_id: number | null }[];
};

export async function searchProducts(q: string, lang: Lang, filters: ProductFilters, page: number, signal?: AbortSignal) {
  const { data, error } = await supabase
    .rpc('search_products', { p_q: q, p_lang: lang, p_filters: toRpcFilters(filters), p_page: page, p_size: 20 })
    .abortSignal(signal!);
  if (error) throw error;
  return data as unknown as SearchPage;
}
```

**Hook**
```ts
// src/features/search/useSearch.ts
export function useSearch(rawQuery: string, filters: ProductFilters) {
  const lang = useSettings((s) => s.language);
  const q = useDebouncedValue(rawQuery.trim(), 250);
  return useInfiniteQuery({
    queryKey: ['search', q, filters, lang],
    enabled: q.length >= 2,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => searchProducts(q, lang, filters, pageParam, signal),  // stale requests are aborted
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,       // old results stay while new ones load: no flicker
    staleTime: 60_000,
    gcTime: 5 * 60_000,                      // not persisted to MMKV (see 1.12)
  });
}
```

**Recent searches** (on the phone only, never uploaded): Zustand + MMKV, max 10, newest first, de-duplicated case-insensitively, with a "Clear" action and a long-press to remove one.

**When does a search "count"?** Logging every keystroke would fill the table with "mi", "mil", "milk". Log only when:
1. the user presses the keyboard's search key, **or**
2. taps a suggestion or trending/recent chip, **or**
3. the query stays unchanged for **2 s** with results on screen.

Each normalized query is logged at most once per screen visit (a `Set` in a ref). The same rule adds it to recent searches.

```tsx
// in SearchResults
const logged = useRef(new Set<string>());
const commit = useCallback((q: string, count: number) => {
  const key = q.toLowerCase();
  if (logged.current.has(key)) return;
  logged.current.add(key);
  addRecent(q);
  supabase.rpc('log_search', { p_query: q, p_lang: lang, p_results_count: count }).then(() => {}, () => {});  // fire-and-forget
}, [lang]);

useEffect(() => {
  if (!data || isFetching) return;
  const t = setTimeout(() => commit(q, data.pages[0]?.items.length ?? 0), 2000);
  return () => clearTimeout(t);
}, [q, data, isFetching, commit]);
```

**"Showing results for milk":** when `terms` contains something other than the typed text (a synonym or typo fix), show that line in small text above results, so users learn the app understood them.

**Keyboard & performance**
- `TextInput` is uncontrolled-ish: keep the raw text in local state, debounce for the query. Never put the raw text in a global store.
- `keyboardShouldPersistTaps="handled"` on lists, so tapping a result doesn't just close the keyboard.
- Results use the same memoised `ProductCard` and the live-stock overlay from Phase 1, so ADD works right from search.

**Checks**
- Type "dood" quickly then "h": only one request completes (earlier ones are aborted); the grid doesn't flash.
- Search "milk", go to a product, come back: query and scroll position are kept.

**Tests**
- Jest: `useRecentSearches` (max 10, de-dupe, clear).
- RNTL: typing 1 character doesn't call the RPC; 2+ characters does after the debounce (fake timers).

---

## 2.3 Suggestions & voice search

**Goal:** jump straight to a category or brand, and let people who don't like typing (many older users, and Marathi speakers on English keyboards) just say what they want.

**Files**
```
mobile/src/features/search/useSuggestions.ts
mobile/src/features/search/SuggestionRows.tsx
mobile/src/features/search/VoiceSearchButton.tsx
mobile/app.config.ts                       (speech recognition plugin)
```

### Suggestions

`search_suggestions(q)` returns up to 3 categories, 2 brands and some products, ranked. The screen shows **only the category and brand rows** above the instant product grid (products are already in the grid).

```ts
export function useSuggestions(rawQuery: string) {
  const q = useDebouncedValue(rawQuery.trim(), 150);   // a little faster than results
  return useQuery({
    queryKey: ['search', 'suggest', q],
    enabled: q.length >= 2,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('search_suggestions', { p_q: q, p_limit: 8 }).abortSignal(signal);
      if (error) throw error;
      return (data as unknown as Suggestion[]).filter((s) => s.kind !== 'product');
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}
```

Row actions: **category** → `/category/<slug>`; **brand** → keeps you on search with the brand name as the query and the brand filter applied. Highlight the matched part of the label in bold (simple case-insensitive `indexOf` on the localized label; skip highlighting when there's no direct match, e.g. synonyms).

### Voice search

Package: **`expo-speech-recognition`** (open source, free). It wraps Android's `SpeechRecognizer` and iOS's `SFSpeechRecognizer`. There's no per-request cost. On Android the recognition is usually done by the Google app's speech service (often online). On iOS some languages are recognised on-device.

```bash
npx expo install expo-speech-recognition
```

`app.config.ts`
```ts
plugins: [
  ['expo-speech-recognition', {
    microphonePermission: 'Allow NearKart to use the microphone for voice search.',
    speechRecognitionPermission: 'Allow NearKart to recognise your voice for search.',
    androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
  }],
],
```
It's native code, so rebuild the dev client (`npx expo run:android`).

```tsx
// src/features/search/VoiceSearchButton.tsx
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const LOCALE: Record<Lang, string> = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };

export function VoiceSearchButton({ onText, onFinal }: { onText: (t: string) => void; onFinal: (t: string) => void }) {
  const lang = useSettings((s) => s.language);
  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState(false);
  const last = useRef('');

  useEffect(() => { setAvailable(ExpoSpeechRecognitionModule.isRecognitionAvailable()); }, []);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => { setListening(false); if (last.current) onFinal(last.current); });
  useSpeechRecognitionEvent('result', (e) => {
    last.current = e.results[0]?.transcript ?? '';
    onText(last.current);                                   // interim text appears in the box live
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e.error !== 'no-speech' && e.error !== 'aborted') toast(t('voice.error'));
  });

  if (!available) return null;                             // no recogniser on this phone: hide the mic

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { toast(t('voice.permission')); return; }
    last.current = '';
    ExpoSpeechRecognitionModule.start({ lang: await pickLocale(LOCALE[lang]), interimResults: true, continuous: false });
  };

  return (
    <Pressable accessibilityRole="button"
      accessibilityLabel={listening ? t('voice.stop') : t('voice.start')}
      onPress={listening ? () => ExpoSpeechRecognitionModule.stop() : start}
      className="h-12 w-12 items-center justify-center">
      {listening ? <PulsingMic /> : <Icon name="microphone" />}
    </Pressable>
  );
}

// Not every phone has every language. Fall back mr-IN → hi-IN → en-IN.
async function pickLocale(preferred: string) {
  try {
    const { locales, installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    const all = new Set([...(locales ?? []), ...(installedLocales ?? [])]);
    if (all.size === 0) return preferred;                  // can't tell: just try
    return [preferred, 'hi-IN', 'en-IN'].find((l) => all.has(l)) ?? preferred;
  } catch { return preferred; }
}
```

While listening, show a bottom sheet with a pulsing mic, "Listening… say a product name" in the selected language, and the interim text. A final result triggers the search and counts as "committed" (logged, added to recent).

Spoken Marathi/Hindi comes back in Devanagari ("दूध"), which matches `search_text` directly. Spoken English for Indian products ("aata") is handled by synonyms.

**Checks**
- On a phone with the Google app: say "दूध" with the app in Marathi → milk results.
- Deny the microphone permission → a friendly toast; the app doesn't ask again on every tap (the OS handles "don't ask again").
- On an emulator without a recogniser: no mic icon.

---

## 2.4 Filters & sort sheet (schema-driven)

**Goal:** the chips and sheets on the category screen (Phase 1.6 left a placeholder `FilterChips`) are generated from `categories.filters`. Adding a filter to a category is a data change, never a code change.

**Files**
```
mobile/src/features/filters/types.ts
mobile/src/features/filters/toRpcFilters.ts
mobile/src/features/filters/useFilterOptions.ts
mobile/src/features/filters/FilterChips.tsx
mobile/src/features/filters/FilterSheet.tsx
mobile/src/features/filters/SortSheet.tsx
mobile/src/features/filters/sections/*.tsx       # BrandFilter, PriceFilter, AttributeFilter, VegFilter, StockFilter
```

### Filter definitions (from Plan §8.4)

```ts
export type FilterDef =
  | { type: 'brand'; quick?: boolean }
  | { type: 'price'; buckets: number[]; quick?: boolean }        // [0,30,60,100] → <30, 30–60, 60–100, 100+
  | { type: 'attribute'; key: string; quick?: boolean }           // label/options come from attribute_schema
  | { type: 'veg'; quick?: boolean }
  | { type: 'in_stock'; quick?: boolean };

export type ProductFilters = {
  brandIds?: number[];
  price?: { min?: number; max?: number };
  veg?: boolean;
  inStock?: boolean;
  attrs?: Record<string, string[] | boolean | { min?: number; max?: number }>;
};
export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'newest';
```

```ts
// toRpcFilters.ts: the only place that knows the RPC's filter JSON shape (Phase 1 product_matches_filters)
export function toRpcFilters(f: ProductFilters) {
  const out: Record<string, unknown> = {};
  if (f.brandIds?.length) out.brand_ids = f.brandIds;
  if (f.price?.min != null) out.price_min = f.price.min;
  if (f.price?.max != null) out.price_max = f.price.max;
  if (f.veg) out.veg = true;
  if (f.inStock) out.in_stock = true;
  const attrs = Object.fromEntries(Object.entries(f.attrs ?? {}).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v !== false && v != null));
  if (Object.keys(attrs).length) out.attrs = attrs;
  return out;
}
export const activeFilterCount = (f: ProductFilters) =>
  (f.brandIds?.length ? 1 : 0) + (f.price ? 1 : 0) + (f.veg ? 1 : 0) + (f.inStock ? 1 : 0) +
  Object.values(f.attrs ?? {}).filter((v) => (Array.isArray(v) ? v.length : v)).length;
```

**Which definitions apply?** The sub-category's `filters` if it has any, otherwise its parent's. Attribute labels and options come from the merged attribute schema (`mergeFields`, Phase 1.9). On **search** there's no category, so use a fixed default: `[{type:'veg',quick:true},{type:'in_stock',quick:true},{type:'price',buckets:[0,50,100,200,500]}]`.

**Counts:** `category_filter_options(category_id)` returns brand counts, attribute value counts and the price range for the selected sub-category. Options with a count of 0 are hidden, so users never pick a filter that returns nothing.

```ts
export function useFilterOptions(categoryId?: number) {
  return useQuery({
    queryKey: ['catalog', 'filter-options', categoryId],
    enabled: !!categoryId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('category_filter_options', { p_category_id: categoryId! });
      if (error) throw error;
      return data as unknown as FilterOptions;
    },
  });
}
```

### UI

**Chip bar** (horizontal, under the header): `[⇅ Sort ▾] [⚙ Filters • 2] [quick chip] [quick chip] …`. Quick chips are definitions with `quick: true` (for example "Veg", "Organic", "In stock") and toggle instantly. Selected chips are filled with the brand colour and show ✕.

**FilterSheet** (bottom sheet, 85% height): left column = filter names (Brand, Price, Milk type, Organic…), right column = options for the selected one. This mirrors Blinkit and works with large text.

| Def type | Options UI | Writes |
|---|---|---|
| `brand` | Checkbox list with counts, search box when more than 10 brands | `brandIds` |
| `price` | Radio list built from buckets: "Below ₹30", "₹30 – ₹60", "₹60 – ₹100", "₹100 and above" | `price {min,max}` (max exclusive) |
| `attribute` → `select` / `multiSelect` | Checkbox list of option labels with counts | `attrs[key] = string[]` |
| `attribute` → `boolean` | One switch ("Organic only") | `attrs[key] = true` |
| `attribute` → `number` | Radio list from `field.buckets` if set (e.g. fat 0–3%, 3–6%) | `attrs[key] = {min,max}` |
| `veg` | Switch "Veg only" with the green veg mark | `veg` |
| `in_stock` | Switch "Hide out of stock" | `inStock` |

Footer: **Clear all** (left) and **Apply** (right, shows the product count after applying when cheap: fetch page 0 with the draft filters and show `items.length` + "+" when `has_more`). Changes are drafted inside the sheet and only applied on **Apply**, so the grid doesn't refetch on every tap.

**SortSheet**: radio list "Relevance · Price: low to high · Price: high to low · Discount · Newest". Applies immediately and closes.

**State:** filters and sort live in the category screen's state, reset when the sub-category changes (as in Phase 1.6), and are kept when the user opens a product and comes back.

**Checks**
- Add `{"type":"attribute","key":"organic","quick":true}` to a category in Studio → an "Organic" chip appears after refresh.
- Choose "Below ₹30" in Milk: only products whose default variant price is under ₹30 remain.
- Brand list doesn't show brands with 0 products in this sub-category.

**Tests**
- Jest: `toRpcFilters` (empty → `{}`, false booleans dropped, arrays kept), `activeFilterCount`, price bucket labels in all 3 languages.
- RNTL: FilterSheet built from a fixture `filters` array shows one section per definition; Apply calls `onChange` once.

---

## 2.5 Zero-result capture

**Goal:** a search that finds nothing is turned into **data for the owner** ("23 people searched for *ghee* this week") and a polite next step for the customer.

**Files**
```
mobile/src/features/search/NoResults.tsx
```

When page 0 comes back with no items:
1. The 2-second commit (2.2) logs it with `results_count = 0`.
2. Show the **NoResults** state:
   - Illustration + "No results for "{q}"".
   - Tips: "Check the spelling", "Try a simpler word, like *atta* instead of *wheat flour 5 kg*", "Search in English, मराठी or हिंदी".
   - **Request this product** button → `log_search(q, lang, 0, p_requested => true)` → button turns into "✓ Thanks! We'll try to stock it". No login needed.
   - A **Bestsellers** rail (from the Home cache, no extra request) so the screen isn't a dead end.
3. If filters are active and the unfiltered search has results, show "No results with these filters" + **Clear filters** instead.

The owner sees these in Phase 7's **"Searched but not found"** report (`v_zero_result_searches`), grouped by normalized query with counts and "requested" counts. Two common fixes: add the product, or add a synonym (e.g. people type *gavat chaha*, the catalog says *lemongrass tea*).

**Checks**
- Search "ghee pickle" → empty state; tap Request → a row with `requested = true` appears in `search_queries`.
- Tapping Request twice records it once (the button is disabled after the first tap).

---

## 2.6 "Notify me" for out-of-stock

**Goal:** an out-of-stock product doesn't lose the customer: one tap asks to be told when it's back.

**Files**
```
mobile/src/features/stock-alerts/api.ts
mobile/src/features/stock-alerts/useStockAlerts.ts
mobile/src/features/stock-alerts/pending.ts          # guest alerts waiting for login
mobile/src/features/stock-alerts/NotifyMeButton.tsx
mobile/app/account/alerts.tsx                        # "Back-in-stock alerts" list
```

### How it flows

```
Out of stock card ──tap "Notify me"──► logged in?
                                         ├─ yes → toggle_stock_alert(variant, true) → "✓ We'll notify you"
                                         └─ no  → saved in MMKV "pending alerts" + sheet: "Log in so we can tell you"
                                                   (Phase 3 login flushes pending alerts automatically)

Stock goes 0 → >0 (Studio now; staff restock in Phase 6)
   └─ trigger notify_back_in_stock() sets stock_alerts.triggered_at
         └─ Phase 5 replaces the trigger body: inserts a notifications row (in-app + push) and sets notified_at
```

Until Phase 5, a triggered alert is visible in **Account → Back-in-stock alerts** with a "Back in stock!" badge and an ADD button, so the feature is useful from day one.

**API & hook**
```ts
export function useStockAlerts() {
  const userId = useAuth((s) => s.user?.id);            // Phase 3; undefined for guests
  return useQuery({
    queryKey: ['stock-alerts', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_alerts').select('variant_id, triggered_at, notified_at');
      if (error) throw error;
      return new Map(data.map((a) => [a.variant_id, a]));
    },
  });
}

export function useToggleStockAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ variantId, on }: { variantId: number; on: boolean }) => {
      const { error } = await supabase.rpc('toggle_stock_alert', { p_variant_id: variantId, p_on: on });
      if (error) throw error;
    },
    onMutate: async ({ variantId, on }) => {               // optimistic
      const key = ['stock-alerts', useAuth.getState().user?.id];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Map<number, StockAlert>>(key);
      const next = new Map(prev);
      on ? next.set(variantId, { variant_id: variantId, triggered_at: null, notified_at: null }) : next.delete(variantId);
      qc.setQueryData(key, next);
      return { prev, key };
    },
    onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.prev),
    onSettled: (_d, _e, _v, ctx) => ctx && qc.invalidateQueries({ queryKey: ctx.key }),
  });
}
```

**Guest alerts (`pending.ts`)**: a small Zustand + MMKV list of variant ids, max 20.
```ts
export const usePendingAlerts = create<{ ids: number[]; add: (id: number) => void; clear: () => void }>()(
  persist((set) => ({
    ids: [],
    add: (id) => set((s) => ({ ids: [...new Set([id, ...s.ids])].slice(0, 20) })),
    clear: () => set({ ids: [] }),
  }), { name: 'pending-stock-alerts', storage: createJSONStorage(() => mmkvStorage) }));

/** Called by Phase 3 right after a successful login. */
export async function flushPendingStockAlerts() {
  const { ids, clear } = usePendingAlerts.getState();
  for (const id of ids) await supabase.rpc('toggle_stock_alert', { p_variant_id: id, p_on: true });
  clear();
}
```

**`NotifyMeButton`** (used by `AddButton` when `available_qty === 0`, and on product detail)
```tsx
export function NotifyMeButton({ variantId, size = 'sm' }: { variantId: number; size?: 'sm' | 'lg' }) {
  const { data: alerts } = useStockAlerts();
  const pending = usePendingAlerts((s) => s.ids.includes(variantId));
  const toggle = useToggleStockAlert();
  const isLoggedIn = useAuth((s) => !!s.user);
  const on = alerts?.has(variantId) || pending;

  const press = () => {
    Haptics.selectionAsync();
    if (!isLoggedIn) {
      usePendingAlerts.getState().add(variantId);
      openLoginPrompt({ reason: 'stock_alert' });     // Phase 3 sheet; until then a toast with a Login button
      return;
    }
    toggle.mutate({ variantId, on: !on });
  };

  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={on ? t('stock.notifyOn') : t('stock.notifyMe')}
      onPress={press}
      className={cn('min-h-[36px] rounded-lg px-3 items-center justify-center border',
                    on ? 'border-muted bg-surfaceMuted' : 'border-brand')}>
      <Text className={on ? 'text-muted' : 'text-brand font-bold'}>
        {on ? `✓ ${t('stock.willNotify')}` : t('stock.notifyMe')}
      </Text>
    </Pressable>
  );
}
```

**Account → Back-in-stock alerts** (`app/account/alerts.tsx`): list of alerted variants (join through `get_product`-style cards: fetch with `catalog_product_cards` via a tiny RPC, or `supabase.from('product_variants').select('id, product_id, products(slug,name)')`), triggered ones on top with "Back in stock!" and ADD, others with "Waiting…" and a remove button.

**Abuse limits:** max 50 active alerts per user (server), 20 pending on the phone.

**Checks**
- Logged out: tap Notify me → login prompt; after logging in (Phase 3) the alert exists in `stock_alerts`.
- Logged in: tap → "✓ We'll notify you"; restock in Studio → the alert has `triggered_at`; the alerts screen shows "Back in stock!".
- Tap again → alert removed.

**Tests**
- pgTAP: `toggle_stock_alert` as anon raises `login_required`; re-arming resets `triggered_at`; a user can't see another user's alerts.
- Jest: `usePendingAlerts` de-dupe and cap; `flushPendingStockAlerts` clears after success.

---

## 2.7 Similar & often-bought-together

**Goal:** more items per order: each product page offers alternatives (when something is out of stock or too expensive) and complementary items (bread → butter, eggs). Also the **collection page** that banners and rails link to.

**Files**
```
mobile/src/features/catalog/useRelated.ts
mobile/src/features/catalog/components/RelatedRail.tsx
mobile/app/collection/[slug].tsx
```

**Data:** `related_products(product_id, 'similar' | 'together')` (SQL in 2.1).

| Rail | Rule now | Better rule later |
|---|---|---|
| **Similar products** | Same sub-category, in stock, default price within 0.5×–2×, closest price first | Same, plus "customers who viewed this bought…" |
| **Often bought together** | Shared `tags` in sibling sub-categories of the same parent, else the `bestsellers` collection | Co-purchase counts from `order_items` (enough data after a few hundred orders) |

```ts
export function useRelated(productId: number | undefined, kind: 'similar' | 'together') {
  return useQuery({
    queryKey: ['catalog', 'related', productId, kind],
    enabled: !!productId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('related_products', { p_product_id: productId!, p_kind: kind });
      if (error) throw error;
      return data as unknown as ProductCardData[];
    },
  });
}
```

**Product detail placement**
- If the selected variant is **out of stock**: show **Similar products** directly under the price block ("Try these instead"), above Highlights. This is where alternatives matter most.
- Otherwise: Highlights → Description → **Often bought together** → Mandatory info → **Similar products**.
- Rails render only when they have at least 2 items, and load lazily when scrolled into view (`onViewableItemsChanged` on the detail `ScrollView` sections, or just after the main content has rendered) so the detail screen's first paint is one request.

**Tagging tip for the admin:** tags drive "together" until there are orders. Give complementary items a shared tag: `breakfast` on bread, butter, jam, eggs; `chai` on tea, sugar, milk, biscuits; `pooja` on agarbatti, camphor, ghee, coconut.

**Collection page (`app/collection/[slug].tsx`)**: header with the collection image and title, a 2-column grid from `list_collection_products(slug, page)` with infinite scroll, sort not offered (the admin's order is the point of a collection). Banners with `link.type = 'collection'` and "See all" on collection rails open it.

**Checks**
- Open the 10 kg atta (out of stock): "Try these instead" shows in-stock atta of similar price.
- Open bread: "Often bought together" shows items tagged `breakfast`.
- A Diwali banner opens `/collection/diwali-specials`.

**Tests**
- pgTAP: `related_products(x, 'similar')` never includes `x` or out-of-stock items; `list_collection_products` puts in-stock first and returns `null` for an inactive collection.

---

## Testing for Phase 2

| Layer | What |
|---|---|
| pgTAP | Synonym (Latin + Devanagari), typo, brand and category matching; LIKE-wildcard stripping; OOS last; filters reuse; `log_search` de-dupe and RLS; `trending_searches` fallback; `category_filter_options` counts; `toggle_stock_alert` login/limit/re-arm; restock trigger; `related_products`; `list_collection_products` |
| Jest | `toRpcFilters`, `activeFilterCount`, price-bucket labels, recent searches store, pending alerts store, `pickLocale` fallback |
| RNTL | Search idle/typing/no-results states; debounce (fake timers); FilterSheet from fixture definitions; NotifyMeButton logged-in/out |
| Maestro | `search.yaml`: Home search bar → type "doodh" → see Amul milk → ADD → cart bar shows 1; `filters.yaml`: Dairy → Filters → Organic → Apply → chip shows • 1 → Clear all |
| Manual | Voice search in all 3 languages on a real Android phone; 2 GB phone: typing doesn't lag while results load; TalkBack reads suggestion rows ("Milk, category") |

## Phase 2 wrap-up

- **Migration:** `0200_search.sql` (+ synonyms and `trending_searches` in `seed.sql`)
- **New SQL objects:** tables `search_synonyms`, `search_queries`, `stock_alerts`; functions `search_synonyms_normalize` (trigger), `expand_search_terms`, `search_products`, `search_suggestions`, `trending_searches`, `log_search`, `category_filter_options`, `toggle_stock_alert`, `notify_back_in_stock` (trigger on `inventory`), `related_products`, `list_collection_products`.
- **Re-run** `supabase gen types` and commit.
- **Hand-off to Phase 3:** call `flushPendingStockAlerts()` right after login; `openLoginPrompt({ reason })` should show a reason-specific line ("Log in so we can tell you when it's back").
- **Hand-off to Phase 5:** `create or replace function public.notify_back_in_stock()` to insert a localized `notifications` row per waiting alert (type `back_in_stock`, data `{variant_id, product_slug}`) and set `notified_at`; the push webhook then delivers it.
- **Hand-off to Phase 7:** the "Searched but not found" report reads `search_queries where results_count = 0 or requested`; add a synonym editor for `search_synonyms`; tune `pg_trgm.word_similarity_threshold` from real data.
