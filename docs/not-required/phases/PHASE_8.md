# Phase 8: Engagement & Growth

> **Goal:** give people reasons to **come back** (wishlist, price-drop alerts, one-tap "Buy again", review prompts, well-timed offers) and to **bring others** (product links that look good in WhatsApp, open the app straight to the product, and work as a web page for people who don't have the app yet).
> **Duration:** about 1 week · **Depends on:** Phase 6 (Store Operations); uses the Phase 7 admin shell, link picker and share images · **Next:** Phase 9 (Hardening & Release)

**Done when:**
- [ ] A logged-in customer can ♥ a product, see it in **Account → Wishlist** with live stock, and gets **one** notification when its price drops
- [ ] Home shows **"Buy again"** for customers with delivered orders, and adding from it works in one tap
- [ ] Only a customer whose **delivered** order contained the product can rate it; one rating per person, editable; the product shows ★ average and count; admins can hide a review
- [ ] A review prompt arrives ~1 day after delivery (not at night, and not if the user turned it off)
- [ ] Sharing a product to WhatsApp shows a **preview with photo, name and price**; tapping it **opens the app on that product** (Android App Links), or a fast web page with "Get the app" if the app isn't installed
- [ ] After installing from that page, the app opens the shared product on first launch (install referrer)
- [ ] Admin can send a localized campaign to a segment, see the audience size first, and **frequency caps + quiet hours** are enforced by the database
- [ ] Notification preferences (offers, review reminders) are respected by every sender

| # | Heading | Output |
|---|---|---|
| 8.0 | Migration `0800_engagement.sql` | wishlist, reviews, ratings, buy again, prefs, campaigns, cron jobs |
| 8.1 | Wishlist | Heart, wishlist screen, price-drop alerts |
| 8.2 | Buy again | Home rail + full list |
| 8.3 | Ratings & reviews (verified buyers) | Review screen, product rating summary, prompts, moderation |
| 8.4 | Share product + deep links | Link share, share image card, App Links, `+native-intent`, install referrer |
| 8.5 | Web product pages (Cloudflare Pages) | Server-rendered `/p/<slug>` with Open Graph + JSON-LD, `assetlinks.json`, sitemap |
| 8.6 | Notification preferences & campaigns | Settings screen, Android channels, admin campaign composer |
| 8.7 | Launch playbook | Zero-cost plan for the first town |

---

## 8.0 Migration `0800_engagement.sql`

**Assumptions from earlier phases:**
- `notifications (id, user_id, type, title, body, data, read_at, created_at)` exists, and inserting a row triggers push delivery through the Phase 5 Database Webhook → `send-push` Edge Function.
- `notify_order_status` (Phase 5) only fires a notification when `orders.status` **changes**. This migration adds a column to `orders` and updates it, so check that your trigger compares `new.status is distinct from old.status` (or is declared `after update of status`).
- `pg_cron` is enabled (Phase 6 uses it for auto-cancel).

**File:** `supabase/migrations/0800_engagement.sql`

```sql
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
  store as (select s.id from public.stores s order by s.id limit 1)
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
```

**After the migration**
```bash
supabase db push
supabase gen types typescript --local > mobile/src/types/database.ts
```

**Optional:** if you want ★ ratings on product **cards**, re-create `list_products` (Phase 1) with `rating_avg` and `rating_count` added to each item it returns. Product detail reads them straight from `products`.

**Small change to Phase 5's `send-push` Edge Function:** pick the Android channel from the notification type, so people can mute offers in Android settings without muting order updates:
```ts
const channelId =
  ['campaign', 'campaign_test', 'price_drop'].includes(row.type) ? 'offers'
  : row.type === 'review_prompt' ? 'reminders'
  : 'orders';
```

---

## 8.1 Wishlist

**Goal:** save products for later, see them with **live stock**, and hear about price drops.

**Files:** `src/features/wishlist/{api.ts, useWishlist.ts, WishlistHeart.tsx}`, `app/account/wishlist.tsx`

**SQL:** Part B (`wishlist`, `wishlist_limit`, `notify_wishlist_price_drop`).

**Steps**
1. **IDs set, cached once per session:**
   ```ts
   export function useWishlistIds() {
     const { user } = useAuth();
     return useQuery({
       queryKey: ['wishlist-ids', user?.id],
       enabled: !!user,
       staleTime: 10 * 60_000,
       queryFn: async () => {
         const { data, error } = await supabase.from('wishlist').select('product_id');
         if (error) throw error;
         return new Set(data.map(r => r.product_id));
       },
     });
   }
   ```
2. **Optimistic toggle** with the login gate (Phase 3 `useRequireLogin('wishlist')`: "Log in to save your favourites"):
   ```ts
   export function useToggleWishlist() {
     const qc = useQueryClient();
     const { user } = useAuth();
     return useMutation({
       mutationFn: async ({ productId, saved }: { productId: number; saved: boolean }) => {
         const q = saved
           ? supabase.from('wishlist').delete().eq('product_id', productId)
           : supabase.from('wishlist').insert({ user_id: user!.id, product_id: productId });
         const { error } = await q;
         if (error && error.code !== '23505') throw error;     // already saved = fine
       },
       onMutate: async ({ productId, saved }) => {
         const key = ['wishlist-ids', user?.id];
         await qc.cancelQueries({ queryKey: key });
         const prev = qc.getQueryData<Set<number>>(key);
         const next = new Set(prev);
         saved ? next.delete(productId) : next.add(productId);
         qc.setQueryData(key, next);
         Haptics.selectionAsync();
         return { prev };
       },
       onError: (_e, _v, ctx) => qc.setQueryData(['wishlist-ids', user?.id], ctx?.prev),
       onSettled: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
     });
   }
   ```
3. **`WishlistHeart`** on `ProductCard` (top-right, 44 × 44 touch area) and in the product detail header. `accessibilityLabel`: "Save to wishlist" / "Remove from wishlist", `accessibilityState={{ selected }}`.
4. **Wishlist screen** (`Account → ♥ Wishlist`): one query with embedded rows, newest first:
   ```ts
   supabase.from('wishlist')
     .select(`created_at, product:products(id, slug, name, is_veg, is_active,
              variants:product_variants(id, label, price, mrp, is_default, is_active,
                inventory(stock, is_available)),
              images:product_images(thumb_path, sort_order))`)
     .order('created_at', { ascending: false });
   ```
   Rendered with the normal `ProductCard`, so **ADD**, "Only 3 left" and "Out of stock · Notify me" all work and update live through the Phase 1 inventory channel. Inactive products show "No longer available" with a Remove button.
5. **Price-drop notification** taps open the product (`data.link`).

**Checks:** heart a product as a guest → login sheet → after login it's saved; lower its price by 10 % in the admin → one "Price dropped" notification; lower it again the same day → no second one.

**Tests:** optimistic rollback on error (RNTL + mocked Supabase); pgTAP: user A can't read user B's wishlist; the 301st item is refused; price-drop fan-out respects `offers = false` and the 7-day cap; a 2 % drop sends nothing.

---

## 8.2 Buy again

**Goal:** a regular customer reorders their usual milk, bread and eggs in three taps. This is the biggest repeat-order driver in grocery.

**Files:** `src/features/buy-again/{api.ts, BuyAgainRail.tsx}`, `app/buy-again.tsx`

**SQL:** Part C (`buy_again`). The `home_sections` type `buy_again` already exists (Phase 1).

**Steps**
1. `useBuyAgain(limit)` → `supabase.rpc('buy_again', { p_limit: limit })`, `enabled: !!user`, `staleTime: 5 min`, invalidated when an order becomes `delivered` (Phase 5 order channel).
2. **Home:** when `get_home` returns a `buy_again` section, render `BuyAgainRail` **only** if the user is logged in and the RPC returns ≥ 3 items; otherwise render nothing (no empty box). In-stock items come first; out-of-stock ones show "Notify me".
3. Each tile uses the normal `AddButton` stepper, so it adds to the cart (Phase 4) with live re-quote.
4. **"See all ›"** opens `app/buy-again.tsx`: grid of up to 50, plus a **"Add all available (12)"** button that adds every in-stock item at quantity 1 (one `merge`-style cart mutation, then a toast "12 items added · View cart").
5. Order detail (Phase 5) keeps its "Reorder" button; Buy again is the cross-order version.

**Checks:** a customer with 2 delivered orders sees their items on Home; a new customer doesn't see the section at all; an item that went out of stock moves to the end and shows "Notify me".

**Tests:** pgTAP: only `delivered` orders and `active` lines count; another user's orders never appear; inactive variants excluded; `p_limit` clamped to 1–50. RNTL: rail hidden with < 3 items.

---

## 8.3 Ratings & reviews (verified buyers)

**Goal:** trustworthy ratings, because **only people who actually received the product** can leave one.

**Files:** `src/features/reviews/{api.ts, StarInput.tsx, RatingSummary.tsx, ReviewList.tsx, ReviewItemRow.tsx}`, `app/order/[id]/review.tsx`, `app/product/[slug]/reviews.tsx`, `app/admin/reviews.tsx`

**SQL:** Part D (`reviews`, `refresh_product_rating`, `submit_review`, `order_review_items`, `queue_review_prompts`, `orders.review_prompt_sent_at`, `products.rating_avg/rating_count`).

**Where people rate**
1. **Order detail** of a delivered order (Phase 5) → **"⭐ Rate items"** button → `app/order/[id]/review.tsx`.
2. The **review prompt** notification (~1 day after delivery, 11:00 IST) opens the same screen.
3. **Product detail** → "Rate this product" appears only if the user has a delivered order with it (the button calls `submit_review`; a `42501` reply hides it).

**Review screen**
```
Rate your order NK-261016-0042
┌───────────────────────────────────────────────┐
│ [img] Amul Taaza Toned Milk · 500 ml           │
│        ☆ ☆ ☆ ☆ ☆        [Add a comment]       │
│ [img] Britannia Brown Bread · 400 g            │
│        ★ ★ ★ ★ ☆  ✓ saved                     │
└───────────────────────────────────────────────┘
```
- One row per product from `order_review_items(orderId)`. **Tapping a star saves immediately** (`submit_review`, optimistic) and shows "✓ saved". The comment is optional (≤ 1000 characters, typed in any language).
- Star targets are 44 dp and the row is a single accessible "adjustable" control (`accessibilityRole="adjustable"`, swipe up/down changes the rating with TalkBack).

**Product detail**
- Header: **★ 4.3 (128)** from `products.rating_avg / rating_count`, shown only when `rating_count ≥ 3` (avoids "★ 1.0 (1)" scaring people off a good product).
- `RatingSummary`: average, 5→1 distribution bars (one grouped query over `reviews`), then the 3 newest reviews with comments, then "See all reviews ›" (`app/product/[slug]/reviews.tsx`, paged by 20, newest first). Each review shows first name, stars, date and a "✓ Verified purchase" tag (every review is one).
- The user's own review is pinned at the top with Edit / Delete.

**Moderation** (`app/admin/reviews.tsx`): newest reviews, filter "with comments" and "1–2 stars"; **Hide** (with a reason) / **Unhide**. Hiding recalculates the average (trigger). Low ratings are a signal for the owner: a 1-star "milk was sour" review should trigger a call, not just a hide.

**Checks:** a customer with no delivered order containing the product gets "only customers who received this product can review it"; rating twice updates the same row; hiding a review changes the average immediately.

**Tests:** pgTAP: verified-purchase rule (cancelled or undelivered orders don't count, `unavailable` lines don't count); one review per user per product; aggregates after insert/update/delete/hide; anon sees only visible reviews; `queue_review_prompts` sends once per order, skips users with `review_prompts = false`, skips orders already reviewed. RNTL: StarInput accessibility actions.

---

## 8.4 Share product + deep links

**Goal:** sharing a product on WhatsApp is the **main free growth channel** in a small town. The link must look good, open the app if installed, and still work if it isn't.

**Files:** `src/features/share/{links.ts, shareProduct.ts, ShareCard.tsx}`, `app/+native-intent.tsx`, `src/features/share/useInstallReferrer.ts`, `app.config.ts`

**Link format** (short, readable, works in any app)
```
https://<WEB_HOST>/p/<product-slug>        product
https://<WEB_HOST>/c/<category-slug>       category
nearkart://p/<product-slug>                in-app (from the web page's "Open in app")
```
`WEB_HOST` = `nearkart.pages.dev` to start (₹0). ⚠️ **Buy your own domain before you print QR codes or share widely.** Changing the host later breaks every link already sent and needs a new app release for App Links.

**Steps**
1. **App config**
   ```ts
   // app.config.ts (excerpt)
   const WEB_HOST = process.env.EXPO_PUBLIC_WEB_HOST ?? 'nearkart.pages.dev';
   export default {
     scheme: 'nearkart',
     android: {
       intentFilters: [{
         action: 'VIEW',
         autoVerify: true,                                   // Android App Links
         data: [
           { scheme: 'https', host: WEB_HOST, pathPrefix: '/p/' },
           { scheme: 'https', host: WEB_HOST, pathPrefix: '/c/' },
         ],
         category: ['BROWSABLE', 'DEFAULT'],
       }],
     },
     ios: { associatedDomains: [`applinks:${WEB_HOST}`] },   // ⚠️ needs the paid Apple Developer Program
   };
   ```
2. **Map web paths to app routes** with Expo Router's native intent hook:
   ```ts
   // app/+native-intent.tsx
   export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
     // handles https://host/p/x, nearkart://p/x and /p/x
     const m = path.match(/(?:^|\/)(p|c)\/([^/?#]+)/);
     if (m) return m[1] === 'p' ? `/product/${m[2]}` : `/category/${m[2]}`;
     return path;
   }
   ```
3. **Share as link (default)**: tiny, instant, and WhatsApp builds the preview card itself from the page's Open Graph tags (8.5).
   ```ts
   // shareProduct.ts
   export async function shareProductLink(p: ShareableProduct, lang: Lang) {
     const url = `https://${WEB_HOST}/p/${p.slug}?s=app`;
     const text = t('share.productText', {
       name: localize(p.name, lang), price: formatINR(p.price), store: localize(store.name, lang),
     });                                              // "Amul Taaza 500 ml – ₹27 at NearKart"
     await Share.share({ message: `${text}\n${url}` }, { dialogTitle: t('share.title') });
   }
   ```
4. **Share as image** (secondary button "Share as photo", best for **WhatsApp Status**): `ShareCard` is a 1080 × 1080 view with the product photo, name, price + struck MRP + "% OFF", store name, the short link as text and a QR code (`react-native-qrcode-svg`). Render it off-screen (`position: 'absolute', left: -10000`, `collapsable={false}`), capture it, share the file:
   ```ts
   const uri = await captureRef(cardRef, { format: 'png', quality: 0.9, width: 1080, height: 1080 });
   await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('share.title') });
   ```
   The image uses `_share.jpg` / `_full.webp` (Phase 7.5). Wait for `expo-image`'s `onLoad` before capturing, or the photo can be blank.
5. **Where share appears:** product detail header (⤴), long-press on a product card, category screen header (shares `/c/<slug>`), and the order-placed screen ("Tell a neighbour about NearKart" → shares the store link).
6. **Open after install (deferred deep link, Android, free):** the web page's "Get the app" button sends `referrer=utm_source=share&slug=<slug>` to the Play Store. On first launch:
   ```ts
   // useInstallReferrer.ts (runs once, after language/location onboarding)
   if (Platform.OS === 'android' && !storage.getBoolean('install-referrer-done')) {
     storage.set('install-referrer-done', true);
     const ref = await Application.getInstallReferrerAsync().catch(() => null);
     const slug = ref && new URLSearchParams(ref).get('slug');
     if (slug && /^[a-z0-9-]{1,80}$/.test(slug)) router.push(`/product/${slug}`);
   }
   ```

**Checks**
- Share a product to yourself on WhatsApp: the preview shows photo, name and price; tapping it on a phone **with** the app opens the product screen directly (no browser, no chooser) once App Links are verified (`adb shell pm get-app-links <package>` shows `verified`).
- On a phone **without** the app, the web page opens; "Get the app" → install → first launch opens that product.

**Tests:** `redirectSystemPath` (https, custom scheme, query strings, unknown paths); `shareProductLink` text in 3 languages; slug validation in the referrer handler.

---

## 8.5 Web product pages (Cloudflare Pages)

**Goal:** every shared link renders a **fast, server-rendered page**: WhatsApp and Facebook crawlers don't run JavaScript, so Open Graph tags must be in the HTML. The same pages make products findable on Google for free.

**Files**
```
web/                                   # separate Cloudflare Pages project: nearkart-web
  public/
    index.html                         # store landing: what we are, area served, Get the app, call/WhatsApp
    .well-known/assetlinks.json        # Android App Links verification
    _headers
    robots.txt
  functions/
    p/[slug].ts                        # product page
    c/[slug].ts                        # category page (same pattern, list of 20 products)
    sitemap.xml.ts
    _lib/{supabase.ts, html.ts, i18n.ts}
  wrangler.toml
```
**Environment (Pages → Settings → Variables):** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the public anon/publishable key, the same one the app ships; RLS already limits it to active catalog rows), `ANDROID_PACKAGE`, `STORE_ID`.

**Steps**
1. **`assetlinks.json`**: use **both** SHA-256 fingerprints: your upload key **and** the **Play App Signing** key (Play Console → Setup → App signing). Forgetting the Play key is the #1 reason App Links "work in debug, not from the Play Store".
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app", "package_name": "in.nearkart.app",
                 "sha256_cert_fingerprints": ["AA:BB:…(upload key)", "CC:DD:…(Play App Signing key)"] }
   }]
   ```
   `_headers`:
   ```
   /.well-known/assetlinks.json
     Content-Type: application/json
   /*
     X-Content-Type-Options: nosniff
   ```
2. **Product page function** (edge-cached for 10 minutes to protect the Supabase free egress quota):
   ```ts
   // functions/p/[slug].ts
   interface Env { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; ANDROID_PACKAGE: string; STORE_ID: string }

   export const onRequestGet: PagesFunction<Env> = async (ctx) => {
     const { request, env, params } = ctx;
     const cache = caches.default;
     const hit = await cache.match(request);
     if (hit) return hit;

     const slug = String(params.slug).toLowerCase();
     if (!/^[a-z0-9-]{1,80}$/.test(slug)) return notFound();
     const lang = pickLang(request);                                  // ?lang= → Accept-Language → 'mr'

     const product = await sbGet(env, 'products', {
       slug: `eq.${slug}`, is_active: 'eq.true',
       select: 'id,slug,name,description,is_veg,rating_avg,rating_count,country_of_origin,manufacturer,shelf_life,' +
               'variants:product_variants(label,mrp,price,net_quantity,unit,is_default,is_active),' +
               'images:product_images(path,thumb_path,sort_order)',
     }).then(rows => rows[0]);
     if (!product) return notFound(lang);
     const store = (await sbGet(env, 'stores', { id: `eq.${env.STORE_ID}`, select: 'name,phone,whatsapp,fssai_license' }))[0];

     const html = renderProductPage({ product, store, lang, env, url: new URL(request.url) });
     const res = new Response(html, {
       headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' },
     });
     ctx.waitUntil(cache.put(request, res.clone()));
     return res;
   };

   async function sbGet(env: Env, table: string, params: Record<string, string>) {
     const u = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
     Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
     const r = await fetch(u, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } });
     if (!r.ok) throw new Error(`supabase ${r.status}`);
     return r.json() as Promise<any[]>;
   }
   ```
   (With the newer `sb_publishable_…` keys, send only the `apikey` header.)
3. **What the page contains** (`renderProductPage`, < 25 KB, inline CSS, **no JavaScript needed**)
   - `<head>`: `<title>`, `og:title` (name · variant), `og:description` ("₹27 (MRP ₹28) · Delivered in ~20 min in Rajapeth"), `og:image` = public URL of `…_share.jpg` (600 × 600 JPEG, Phase 7.5), `og:url`, `twitter:card=summary_large_image`, `<link rel="alternate" hreflang>` for en/mr/hi, and **JSON-LD** `Product` + `Offer` (`priceCurrency: INR`, `price`, `availability` as `InStock` without promising live stock: "Prices as of now").
   - Body: photo, name in the chosen language with language links (EN · मराठी · हिंदी), variants with price/MRP/% off, ★ rating if ≥ 3 reviews, the **mandatory info** (MRP incl. taxes, net quantity, manufacturer, country of origin, shelf life, FSSAI), store name, **Call store** (`tel:`), **WhatsApp store** (`https://wa.me/91…?text=` prefilled with the product name).
   - **Open in app / Get the app**: on Android user agents, one button using an intent URL that opens the app if installed and falls back to the Play Store with the referrer:
     ```
     intent://p/<slug>#Intent;scheme=nearkart;package=<ANDROID_PACKAGE>;S.browser_fallback_url=<encoded Play URL with &referrer=utm_source%3Dshare%26slug%3D<slug>>;end
     ```
     Other browsers get a plain Play Store link.
   - Escape every value from the database (`html.ts` → `escapeHtml`), including names typed by the admin.
4. **Category page** `c/[slug].ts`: the category name, 20 products (via `rpc/list_products` with the anon key) as simple cards linking to `/p/<slug>`, and the same Open in app / Get the app button.
5. **`sitemap.xml.ts`**: all active product slugs (paged REST call, cached 1 day) → submit once in Google Search Console (free).
6. **Google Business Profile** (free): add the web landing page as the website, and post product links in "Updates". This is often how local people search for "grocery delivery near me".
7. **Deploy**
   ```bash
   cd web && npx wrangler pages deploy public --project-name nearkart-web
   ```
   Cloudflare Pages Functions free plan: 100,000 requests/day. With the 10-minute edge cache, even a viral share uses a few hundred Supabase requests.
8. **Analytics:** Cloudflare Web Analytics (free, no cookies) on the static pages; the `?s=app` / `?s=qr` source parameter shows which channel brings visitors.

**Checks:** paste a product URL into WhatsApp → preview with image; the [Rich Results Test](https://search.google.com/test/rich-results) recognises the Product; `curl -s https://<host>/.well-known/assetlinks.json` returns JSON with the right content type; an inactive product shows a friendly 404 with a link to the store page.

**Tests:** `renderProductPage` snapshot in 3 languages; `escapeHtml` with `<script>` in a product name; slug validation; `wrangler pages dev` smoke test in CI against the local Supabase.

---

## 8.6 Notification preferences & campaigns

**Goal:** people control what they get, and the owner can announce "Fresh mangoes are in!" to the right people, **without anyone being spammed**.

**Files:** `app/account/notification-settings.tsx`, `src/features/notifications/{preferences.ts, channels.ts}`, `app/admin/campaigns/index.tsx`, `app/admin/campaigns/[id].tsx`, `src/features/admin/campaigns/{CampaignForm.tsx, SegmentPicker.tsx, AudiencePreview.tsx}`

**SQL:** Part A (`notification_preferences`, `is_quiet_hours`), Part E (campaigns and functions), Part F (cron).

**Customer settings** (`Account → 🔔 Notifications`)
| Switch | Default | Covers |
|---|---|---|
| Order updates | **always on** (switch disabled, with the explanation "Needed to tell you about your orders") | status changes, item unavailable, cancellations |
| Offers & price drops | on | campaigns, wishlist price drops |
| Review reminders | on | "How was your order?" |
| Back in stock | n/a here | only sent for items where you tapped **Notify me**, which is consent per item |

Saving upserts `notification_preferences` (`onConflict: 'user_id'`). A link opens the **Android notification settings** for the app (`Linking.openSettings()`), where the three channels created at startup (`orders` high importance, `offers` default, `reminders` low) can be muted separately.

**Admin campaign composer** (`Admin → 📣 Campaigns`)
```
New campaign
Title    [EN] Fresh Alphonso mangoes are here 🥭   [मराठी] …  [हिंदी] …
Message  [EN] Ratnagiri Hapus, ₹499/dozen. Limited stock.  …
Image    [optional]          Opens  [Collection ▾ Mango season]     ← Phase 7 LinkPicker
Send to  (•) Everyone  ( ) Ordered in last [30] days  ( ) Haven't ordered in [21] days
         ( ) Never ordered  ( ) Bought from [Fruits ▾]  ( ) Wishlisted [product ▾]
Audience  1,240 people · 1,105 will receive · 135 skipped (got an offer recently)
[Send test to me]   [Schedule ▾ Sat 10:00]   [Send now]
```
- **Audience preview** → `admin_preview_campaign_audience(segment)`, refreshed as the segment changes.
- **Send now** → `admin_send_campaign(id)`. Refused during quiet hours (9 PM – 8 AM IST) with "Schedule it instead".
- **Schedule** → update the row (`status = 'scheduled', scheduled_at`). `run_scheduled_campaigns` sends it within 5 minutes of the time (or at 8 AM if the time falls in quiet hours).
- **Caps (database-enforced):** max 1 campaign per person per 72 hours and 2 per 7 days. The composer shows a warning when the store has already sent 2 campaigns this week.
- History list: sent date, audience, delivered count, skipped by caps, status (`failed` shows `last_error`).
- In-app: campaign notifications appear in the Phase 5 inbox with the image; tapping follows `data.link` (same `linkToHref` as banners).

**Scale note:** each notification row triggers one `send-push` call. 2,000 recipients = 2,000 Edge Function invocations (free tier: 500,000/month). If you outgrow this, change `send-push` to batch 100 tokens per Expo request.

**Checks:** turn off "Offers" → the next campaign skips you (audience count drops by one); send two campaigns in a day → the second one skips everyone who got the first; "Send now" at 22:00 IST is refused.

**Tests:** pgTAP: each segment type on seeded users; caps (72 h and 7 d); quiet hours (mock `now()` with `set local` on a test function or test `is_quiet_hours` boundaries at 07:59/08:00/20:59/21:00 IST); blocked users and staff excluded; `campaign_test` doesn't count toward caps; non-admin → `42501`. RNTL: preferences screen saves; SegmentPicker builds valid segment JSON.

---

## 8.7 Launch playbook

Software alone doesn't bring orders. This is the zero-cost plan for the first town. Items that cost a little are marked ⚠️.

### Before launch (2 weeks)
1. **Catalog that matches real demand:** take the **top 300–500 SKUs** from the store's billing software or sales book, not "everything". Import them with the CSV template (Phase 7.6).
2. **Photos in one evening:** a cardboard box lined with white paper, two phone torches or a window, the product filling 80 % of the frame. Name files by SKU and use the bulk image matcher (Phase 7.5).
3. **Translations:** staff who speak Marathi and Hindi fill `name_mr` / `name_hi` in Google Sheets. Add synonyms for local words (*doodh, dahi, kanda, batata, sabun, atta*).
4. **Legal info complete:** MRP, net quantity, manufacturer, country of origin on every product; GSTIN, FSSAI and seller details in settings (Phase 7.8, Phase 9.8).
5. **Realistic promise:** set the service radius to what staff can actually deliver on a bike (2–3 km to start) and an honest ETA. A kept 30-minute promise beats a broken 10-minute one.
6. **Dry runs:** 30 test orders by staff and family, including cancellations, "item unavailable" and a closed-store order.

### Soft launch (week 1–2)
- Invite **20–30 regular customers** in person at the counter. Help them install and place the first order right there.
- Make a WhatsApp group "NearKart early users" for feedback. Fix the top 3 complaints every week.
- **Free delivery for the first month:** set `free_delivery_above = 0` in settings. Revert it from the same screen later.

### Launch (week 3 onwards)
| Channel | Cost | How |
|---|---|---|
| **Counter QR standee** | ⚠️ ~₹100 print | Play Store link with `&referrer=utm_source%3Dcounter`. "Order from home. Delivered in 30 min." |
| **Bill footer** | ₹0 | Add the QR + "Order on NearKart" to the printed bill / invoice footer |
| **WhatsApp Status, daily** | ₹0 | Staff post 2–3 "Share as photo" cards (8.4): today's fresh arrivals, a deal, a festival collection |
| **Society / apartment WhatsApp groups** | ₹0 | Ask early users to share the store link once. Never spam groups yourself. |
| **Google Business Profile** | ₹0 | Website = web landing page, product posts with `/p/` links, reply to every Google review |
| **Play Store listing in Marathi & Hindi** | ₹0 | Local-language title, description and screenshots (Phase 9.10) |
| **Newspaper insert pamphlets** | ⚠️ ~₹1–2 per copy | Only after the soft launch works; QR with `utm_source=pamphlet` |

### Daily operations (the real growth engine)
- **Accept every order within the auto-cancel window.** If an item is missing, mark it unavailable (the customer is told) or call. Never let an order expire silently.
- **Morning routine (10 min):** dashboard → low stock → zero-result searches → add synonyms or order the item. Check open issues and 1–2★ reviews and call those customers.
- **Evening rush:** most grocery orders arrive 6–9 PM. Staff the counter accordingly, or use "Busy, ETA 45 min" mode (Phase 6.7) instead of closing.

### Campaign calendar (max 2 a week; the database enforces caps)
*Makar Sankranti* (til-gul), *Holi*, *Gudi Padwa*, *summer* (mangoes, cold drinks), *monsoon* (tea, snacks, umbrellas), *Raksha Bandhan*, *Ganeshotsav* (modak ingredients, pooja items), *Navratri*, *Diwali* (dry fruits, sweets, diyas), *exam weeks* (snacks). Prepare each collection and banner a week ahead in Phase 7.7 and schedule them.

### Weekly metrics (all from the Phase 7 dashboard)
| Metric | Healthy early target |
|---|---|
| Orders per day | growing week over week |
| Repeat customers (2+ orders in 30 days) | > 40 % |
| Cancellation rate | < 5 % (look at reasons) |
| Auto-cancelled orders | 0 |
| Average order value | ≥ free-delivery threshold |
| Zero-result searches | falling |
| Average rating | ≥ 4.2 |

### Never do
- Inflate MRP to show bigger discounts (illegal under Legal Metrology rules, and customers notice).
- Buy or write fake reviews. Reviews are verified purchases by design; keep it that way.
- Send more than 2 offers a week, or at night. People uninstall apps that spam them.

---

## Testing for Phase 8

| Area | Tests |
|---|---|
| SQL (pgTAP, `supabase/tests/0800_engagement.test.sql`) | wishlist RLS + limit; price-drop rule (≥ 5 %, default variant only, 7-day cap, prefs); `buy_again` (own delivered orders only, ordering, clamp); `submit_review` verified-purchase rule + upsert; rating aggregates incl. hide; `order_review_items` only for own delivered order; `queue_review_prompts` once per order + prefs; campaign segments, caps, quiet hours, test sends excluded from caps; `run_scheduled_campaigns` marks failures; every admin function → `42501` for non-admins |
| Unit (Jest) | `redirectSystemPath`, share text in 3 languages, referrer slug parsing, `renderProductPage` + `escapeHtml`, `pickLang` |
| Component (RNTL) | WishlistHeart optimistic toggle + rollback, BuyAgainRail visibility, StarInput accessibility, notification settings, SegmentPicker |
| E2E (Maestro) | `wishlist.yaml`: heart → login → wishlist shows item; `review.yaml`: delivered order (seeded) → rate 4★ → product shows rating after 3 seeded reviews |
| Manual | WhatsApp preview on Android; App Links from the Play internal track (`verified`); install-referrer open on a fresh install; web page on a 2G-throttled browser (< 2 s) |

---

## Phase 8 wrap-up

- **New SQL:** tables `notification_preferences`, `wishlist`, `reviews`, `campaigns`; columns `products.rating_avg`, `products.rating_count`, `orders.review_prompt_sent_at`; functions `is_quiet_hours`, `wishlist_limit`, `notify_wishlist_price_drop`, `buy_again`, `refresh_product_rating`, `submit_review`, `order_review_items`, `queue_review_prompts`, `campaign_audience`, `campaign_recipients`, `send_campaign_internal`, `admin_preview_campaign_audience`, `admin_send_campaign`, `run_scheduled_campaigns`; cron jobs `nk-review-prompts`, `nk-run-campaigns`.
- **New app areas:** wishlist, buy again, reviews, share link + share image, App Links + `+native-intent`, install referrer, notification settings with Android channels, admin campaigns and review moderation.
- **New web project:** `web/` on Cloudflare Pages (`nearkart-web`): server-rendered product and category pages with Open Graph and JSON-LD, `assetlinks.json`, sitemap.
- **Next:** Phase 9 hardens everything (offline, performance, accessibility, security review of RLS, free-tier limits, legal pages on the same web project) and releases v1.0 to the Play Store.
