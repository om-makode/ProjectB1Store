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
