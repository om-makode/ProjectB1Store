-- =====================================================================
-- 0800_engagement.sql  ·  Phase 8: engagement & growth
-- =====================================================================

-- ---------------------------------------------------------------------
-- Part A. Notification preferences (order updates are always on)
-- ---------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  offers         boolean not null default true,     -- campaigns + wishlist price drops
  review_prompts boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_own_select on public.notification_preferences;
create policy notification_preferences_own_select on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notification_preferences_own_insert on public.notification_preferences;
create policy notification_preferences_own_insert on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists notification_preferences_own_update on public.notification_preferences;
create policy notification_preferences_own_update on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- frequency-cap lookups
create index if not exists notifications_user_type_created_idx
  on public.notifications (user_id, type, created_at desc);

create or replace function public.is_quiet_hours()
returns boolean language sql stable set search_path = '' as $$
  -- marketing messages only between 08:00 and 20:59 IST
  select extract(hour from (now() at time zone 'Asia/Kolkata')) not between 8 and 20;
$$;

-- ---------------------------------------------------------------------
-- Part B. Wishlist + price-drop alerts
-- ---------------------------------------------------------------------
create table if not exists public.wishlist (
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists wishlist_product_idx on public.wishlist (product_id);
alter table public.wishlist enable row level security;

drop policy if exists wishlist_own_select on public.wishlist;
create policy wishlist_own_select on public.wishlist
  for select to authenticated using (user_id = auth.uid());
drop policy if exists wishlist_own_insert on public.wishlist;
create policy wishlist_own_insert on public.wishlist
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists wishlist_own_delete on public.wishlist;
create policy wishlist_own_delete on public.wishlist
  for delete to authenticated using (user_id = auth.uid());

-- Keep wishlists sane (and the price-drop fan-out bounded)
create or replace function public.wishlist_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.wishlist w where w.user_id = new.user_id) >= 300 then
    raise exception 'wishlist is full (300 items)' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists wishlist_limit on public.wishlist;
create trigger wishlist_limit before insert on public.wishlist
  for each row execute function public.wishlist_limit();

-- When the DEFAULT variant's price drops by ≥ 5 %, tell people who saved the product.
-- Max one price-drop notification per user per product per 7 days; respects the "offers" preference.
create or replace function public.notify_wishlist_price_drop()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name jsonb;
begin
  if not (new.is_default and new.is_active) then return new; end if;
  if new.price >= old.price * 0.95 then return new; end if;

  select p.name into v_name from public.products p where p.id = new.product_id and p.is_active;
  if v_name is null then return new; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select w.user_id, 'price_drop',
         jsonb_build_object('en', 'Price dropped 🎉', 'mr', 'किंमत कमी झाली 🎉', 'hi', 'कीमत घटी 🎉'),
         jsonb_build_object(
           'en', coalesce(v_name->>'en', '') || ' is now ₹' || new.price::text || ' (was ₹' || old.price::text || ')',
           'mr', coalesce(v_name->>'mr', v_name->>'en', '') || ' आता ₹' || new.price::text || ' (आधी ₹' || old.price::text || ')',
           'hi', coalesce(v_name->>'hi', v_name->>'en', '') || ' अब ₹' || new.price::text || ' (पहले ₹' || old.price::text || ')'),
         jsonb_build_object('product_id', new.product_id, 'variant_id', new.id,
                            'link', jsonb_build_object('type', 'product', 'value', new.product_id))
  from public.wishlist w
  join public.profiles pr on pr.id = w.user_id and not pr.is_blocked
  left join public.notification_preferences np on np.user_id = w.user_id
  where w.product_id = new.product_id
    and coalesce(np.offers, true)
    and not exists (
      select 1 from public.notifications n
      where n.user_id = w.user_id and n.type = 'price_drop'
        and n.data->>'product_id' = new.product_id::text
        and n.created_at >= now() - interval '7 days');
  return new;
end $$;

drop trigger if exists product_variants_price_drop on public.product_variants;
create trigger product_variants_price_drop
  after update of price on public.product_variants
  for each row execute function public.notify_wishlist_price_drop();

-- ---------------------------------------------------------------------
-- Part C. Buy again
-- ---------------------------------------------------------------------
create or replace function public.buy_again(p_limit int default 20)
returns table (
  product_id bigint, product_slug text, product_name jsonb, is_veg boolean,
  variant_id bigint, variant_label jsonb, price numeric, mrp numeric, max_per_order int,
  thumb_path text, stock int, in_stock boolean, times_bought int, last_bought_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with bought as (
    select oi.variant_id, count(distinct o.id)::int as times, max(o.placed_at) as last_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.user_id = auth.uid() and o.status = 'delivered' and oi.status = 'active'
    group by oi.variant_id
  ),
  store as (select public.default_store_id() as id)
  select p.id, p.slug::text, p.name, p.is_veg,
         v.id, v.label, v.price, v.mrp, v.max_per_order,
         (select pi.thumb_path from public.product_images pi
           where pi.product_id = p.id
           order by (pi.variant_id is not distinct from v.id) desc, pi.sort_order
           limit 1)::text,
         coalesce(i.stock, 0),
         coalesce(i.stock, 0) > 0 and coalesce(i.is_available, false),
         b.times, b.last_at
  from bought b
  join public.product_variants v on v.id = b.variant_id and v.is_active
  join public.products p on p.id = v.product_id and p.is_active
  left join public.inventory i on i.variant_id = v.id and i.store_id = (select id from store)
  order by (coalesce(i.stock, 0) > 0 and coalesce(i.is_available, false)) desc, b.times desc, b.last_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------
-- Part D. Reviews (verified buyers only) + rating aggregates
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists rating_avg   numeric(2,1) not null default 0,
  add column if not exists rating_count int          not null default 0;

alter table public.orders
  add column if not exists review_prompt_sent_at timestamptz;

create table if not exists public.reviews (
  product_id    bigint not null references public.products(id) on delete cascade,
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  order_id      uuid   not null references public.orders(id),
  rating        smallint not null check (rating between 1 and 5),
  comment       text check (char_length(comment) <= 1000),
  reviewer_name text not null,                 -- first name snapshot; profiles stay private
  language      text check (language in ('en','mr','hi')),
  is_hidden     boolean not null default false,
  hidden_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (product_id, user_id)
);
create index if not exists reviews_product_recent_idx on public.reviews (product_id, created_at desc) where not is_hidden;
alter table public.reviews enable row level security;

drop policy if exists reviews_public_select on public.reviews;
create policy reviews_public_select on public.reviews
  for select to anon, authenticated using (not is_hidden or user_id = auth.uid() or public.is_admin());
drop policy if exists reviews_own_delete on public.reviews;
create policy reviews_own_delete on public.reviews
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists reviews_admin_update on public.reviews;
create policy reviews_admin_update on public.reviews
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- no insert/update policy for customers: they go through submit_review()

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

create or replace function public.refresh_product_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pid bigint := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
begin
  update public.products p
     set rating_avg   = coalesce(s.avg_rating, 0),
         rating_count = coalesce(s.cnt, 0)
    from (select round(avg(r.rating)::numeric, 1) as avg_rating, count(*)::int as cnt
          from public.reviews r
          where r.product_id = v_pid and not r.is_hidden) s
   where p.id = v_pid;
  return null;
end $$;

drop trigger if exists reviews_refresh_rating on public.reviews;
create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_product_rating();

create or replace function public.submit_review(p_product_id bigint, p_rating int, p_comment text default null,
                                                p_language text default null)
returns public.reviews language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid;
  v_name  text;
  v_row   public.reviews;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be 1–5' using errcode = '22023';
  end if;
  if (select is_blocked from public.profiles where id = auth.uid()) then
    raise exception 'account blocked' using errcode = '42501';
  end if;

  select o.id into v_order
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.user_id = auth.uid() and o.status = 'delivered'
    and oi.product_id = p_product_id and oi.status = 'active'
  order by o.delivered_at desc nulls last
  limit 1;
  if v_order is null then
    raise exception 'only customers who received this product can review it' using errcode = '42501';
  end if;

  select split_part(coalesce(nullif(trim(p.full_name), ''), 'Customer'), ' ', 1)
    into v_name from public.profiles p where p.id = auth.uid();

  insert into public.reviews (product_id, user_id, order_id, rating, comment, reviewer_name, language)
  values (p_product_id, auth.uid(), v_order, p_rating,
          nullif(trim(p_comment), ''), v_name,
          case when p_language in ('en','mr','hi') then p_language end)
  on conflict (product_id, user_id) do update
     set rating   = excluded.rating,
         comment  = excluded.comment,
         order_id = excluded.order_id,
         language = excluded.language
  returning * into v_row;
  return v_row;
end $$;

-- What can I review from this order? (review screen)
create or replace function public.order_review_items(p_order_id uuid)
returns table (product_id bigint, product_slug text, product_name jsonb, variant_label jsonb,
               thumb_path text, my_rating smallint, my_comment text)
language sql stable security definer set search_path = '' as $$
  select distinct on (oi.product_id)
         oi.product_id, p.slug::text, oi.name_snapshot, oi.variant_label_snapshot,
         oi.image_path::text, r.rating, r.comment
  from public.orders o
  join public.order_items oi on oi.order_id = o.id and oi.status = 'active'
  join public.products p on p.id = oi.product_id
  left join public.reviews r on r.product_id = oi.product_id and r.user_id = o.user_id
  where o.id = p_order_id and o.user_id = auth.uid() and o.status = 'delivered'
  order by oi.product_id;
$$;

-- Daily at 11:00 IST: "How was your order?" for orders delivered 20–48 h ago
create or replace function public.queue_review_prompts()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  with picked as (
    update public.orders o
       set review_prompt_sent_at = now()
     where o.status = 'delivered'
       and o.user_id is not null                      -- deleted accounts keep orders, get no prompts
       and o.review_prompt_sent_at is null
       and o.delivered_at between now() - interval '48 hours' and now() - interval '20 hours'
    returning o.id, o.user_id, o.order_number
  ),
  ins as (
    insert into public.notifications (user_id, type, title, body, data)
    select pk.user_id, 'review_prompt',
           jsonb_build_object('en', 'How was your order?', 'mr', 'तुमची ऑर्डर कशी होती?', 'hi', 'आपका ऑर्डर कैसा रहा?'),
           jsonb_build_object('en', 'Rate the items from order ' || pk.order_number || '. It takes 10 seconds.',
                              'mr', 'ऑर्डर ' || pk.order_number || ' मधील वस्तूंना रेटिंग द्या. फक्त १० सेकंद.',
                              'hi', 'ऑर्डर ' || pk.order_number || ' के सामान को रेटिंग दें। सिर्फ़ 10 सेकंड।'),
           jsonb_build_object('order_id', pk.id, 'route', '/order/' || pk.id || '/review')
    from picked pk
    left join public.notification_preferences np on np.user_id = pk.user_id
    where coalesce(np.review_prompts, true)
      and not exists (select 1 from public.reviews r
                      join public.order_items oi on oi.product_id = r.product_id and oi.order_id = pk.id
                      where r.user_id = pk.user_id)
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Part E. Campaigns (admin → segment, with caps and quiet hours)
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id             bigint generated always as identity primary key,
  title          jsonb not null,                     -- {en, mr, hi}
  body           jsonb not null,
  link           jsonb,                              -- same shape as banners.link
  image_path     text,
  segment        jsonb not null default '{"type":"all"}'::jsonb,
  status         text  not null default 'draft'
                   check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at   timestamptz,
  sent_at        timestamptz,
  recipients     int not null default 0,
  skipped_capped int not null default 0,
  last_error     text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.campaigns enable row level security;
drop policy if exists campaigns_admin_all on public.campaigns;
create policy campaigns_admin_all on public.campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- Segments:
--   {"type":"all"}
--   {"type":"ordered_within_days","days":30}      delivered order in the last N days
--   {"type":"lapsed","days":21}                   ordered before, nothing in the last N days
--   {"type":"never_ordered"}                      signed up, never ordered
--   {"type":"category_buyers","category_id":12}   bought from a category (or its sub-categories) in 90 days
--   {"type":"wishlisted","product_id":345}        has the product in their wishlist
create or replace function public.campaign_audience(p_segment jsonb)
returns table (recipient_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text := coalesce(p_segment->>'type', 'all');
  v_days int  := greatest(coalesce(nullif(p_segment->>'days', '')::int, 30), 1);
  v_cat  bigint := nullif(p_segment->>'category_id', '')::bigint;
  v_prod bigint := nullif(p_segment->>'product_id', '')::bigint;
begin
  return query
  select p.id
  from public.profiles p
  left join public.notification_preferences np on np.user_id = p.id
  where p.role = 'customer' and not p.is_blocked and coalesce(np.offers, true)
    and case v_type
      when 'all' then true
      when 'ordered_within_days' then exists (
        select 1 from public.orders o
        where o.user_id = p.id and o.status = 'delivered' and o.delivered_at >= now() - make_interval(days => v_days))
      when 'lapsed' then exists (
          select 1 from public.orders o where o.user_id = p.id and o.status = 'delivered')
        and not exists (
          select 1 from public.orders o where o.user_id = p.id and o.placed_at >= now() - make_interval(days => v_days))
      when 'never_ordered' then not exists (select 1 from public.orders o where o.user_id = p.id)
      when 'category_buyers' then exists (
        select 1 from public.order_items oi
        join public.orders o      on o.id = oi.order_id
        join public.products pr   on pr.id = oi.product_id
        join public.categories c  on c.id = pr.category_id
        where o.user_id = p.id and o.status = 'delivered' and o.placed_at >= now() - interval '90 days'
          and (c.id = v_cat or c.parent_id = v_cat))
      when 'wishlisted' then exists (
        select 1 from public.wishlist w where w.user_id = p.id and w.product_id = v_prod)
      else false
    end;
end $$;

-- Caps: max 1 campaign per user per 72 h and 2 per 7 days
create or replace function public.campaign_recipients(p_segment jsonb)
returns table (recipient_id uuid, capped boolean)
language sql stable security definer set search_path = '' as $$
  select a.recipient_id,
         exists (select 1 from public.notifications n
                 where n.user_id = a.recipient_id and n.type = 'campaign'
                   and n.created_at >= now() - interval '72 hours')
         or (select count(*) from public.notifications n
             where n.user_id = a.recipient_id and n.type = 'campaign'
               and n.created_at >= now() - interval '7 days') >= 2
  from public.campaign_audience(p_segment) a;
$$;

create or replace function public.send_campaign_internal(p_campaign_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c        public.campaigns;
  v_sent   int;
  v_capped int;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  if c.status not in ('draft','scheduled') then
    raise exception 'campaign is already %', c.status using errcode = '22023';
  end if;
  if coalesce(c.title->>'en', '') = '' or coalesce(c.body->>'en', '') = '' then
    raise exception 'title and message need English text' using errcode = '22023';
  end if;

  update public.campaigns set status = 'sending' where id = c.id;

  with rec as materialized (
    select * from public.campaign_recipients(c.segment)
  ),
  ins as (
    insert into public.notifications (user_id, type, title, body, data)
    select r.recipient_id, 'campaign', c.title, c.body,
           jsonb_build_object('campaign_id', c.id, 'link', c.link, 'image_path', c.image_path)
    from rec r
    where not r.capped
    returning 1
  )
  select (select count(*) from ins), (select count(*) from rec where capped)
    into v_sent, v_capped;

  update public.campaigns
     set status = 'sent', sent_at = now(), recipients = v_sent, skipped_capped = v_capped, last_error = null
   where id = c.id;
  return v_sent;
end $$;

create or replace function public.admin_preview_campaign_audience(p_segment jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'audience',     count(*),
      'will_receive', count(*) filter (where not capped),
      'capped',       count(*) filter (where capped),
      'quiet_hours_now', public.is_quiet_hours())
    from public.campaign_recipients(p_segment));
end $$;

create or replace function public.admin_send_campaign(p_campaign_id bigint, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c      public.campaigns;
  v_sent int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_test then   -- "Send test to me": not counted in caps
    select * into c from public.campaigns where id = p_campaign_id;
    if not found then raise exception 'campaign not found' using errcode = 'P0002'; end if;
    insert into public.notifications (user_id, type, title, body, data)
    values (auth.uid(), 'campaign_test', c.title, c.body,
            jsonb_build_object('campaign_id', c.id, 'link', c.link, 'image_path', c.image_path));
    return jsonb_build_object('sent', 1, 'test', true);
  end if;

  if public.is_quiet_hours() then
    raise exception 'quiet hours (9 PM – 8 AM IST): schedule it instead' using errcode = '22023';
  end if;
  v_sent := public.send_campaign_internal(p_campaign_id);
  return jsonb_build_object('sent', v_sent, 'test', false);
end $$;

-- Every 5 minutes: send scheduled campaigns that are due (waits for 8 AM if due at night)
create or replace function public.run_scheduled_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_done int := 0;
begin
  if public.is_quiet_hours() then return 0; end if;
  for r in select id from public.campaigns
           where status = 'scheduled' and scheduled_at <= now()
           order by scheduled_at
  loop
    begin
      perform public.send_campaign_internal(r.id);
      v_done := v_done + 1;
    exception when others then
      update public.campaigns set status = 'failed', last_error = sqlerrm where id = r.id;
    end;
  end loop;
  return v_done;
end $$;

-- ---------------------------------------------------------------------
-- Part F. Jobs (pg_cron, UTC)
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('nk-review-prompts', 'nk-run-campaigns');
select cron.schedule('nk-review-prompts', '30 5 * * *',  $$select public.queue_review_prompts()$$);   -- 11:00 IST
select cron.schedule('nk-run-campaigns',  '*/5 * * * *', $$select public.run_scheduled_campaigns()$$);

-- ---------------------------------------------------------------------
-- Part G. Grants
-- ---------------------------------------------------------------------
revoke all on function
  public.buy_again(int),
  public.submit_review(bigint, int, text, text),
  public.order_review_items(uuid),
  public.admin_preview_campaign_audience(jsonb),
  public.admin_send_campaign(bigint, boolean)
from public, anon;
grant execute on function
  public.buy_again(int),
  public.submit_review(bigint, int, text, text),
  public.order_review_items(uuid),
  public.admin_preview_campaign_audience(jsonb),
  public.admin_send_campaign(bigint, boolean)
to authenticated;

-- internal only (cron / triggers / other definer functions)
revoke all on function
  public.campaign_audience(jsonb),
  public.campaign_recipients(jsonb),
  public.send_campaign_internal(bigint),
  public.run_scheduled_campaigns(),
  public.queue_review_prompts(),
  public.notify_wishlist_price_drop(),
  public.refresh_product_rating()
from public, anon, authenticated;
