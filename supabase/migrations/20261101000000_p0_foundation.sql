-- =====================================================================
-- 0000_foundation.sql: extensions, enums, shared helpers, profiles,
-- roles, app_config. Every later migration depends on this file.
-- =====================================================================

-- ---------- Extensions ------------------------------------------------
-- Supabase convention: extensions live in the `extensions` schema.
create extension if not exists pg_trgm  with schema extensions;   -- fuzzy search (Phase 2)
create extension if not exists unaccent with schema extensions;   -- accent-insensitive search (Phase 2)
create extension if not exists postgis  with schema extensions;   -- store location, service area (Phases 1, 3)
-- Scheduled jobs (auto-cancel, cleanups) and HTTP calls to Edge Functions (push, refunds).
-- Both ship with Supabase; enabling them here keeps every later migration free of setup.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- Internal helpers that must never be reachable through the API (PostgREST only
-- exposes `public`). Security-definer functions owned by postgres can still use it.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- Enums (plan §8.1, all created here) ------------------------
create type public.app_role          as enum ('customer', 'staff', 'admin');
create type public.order_status      as enum ('placed', 'confirmed', 'packing', 'packed',
                                              'out_for_delivery', 'delivered', 'cancelled');
create type public.payment_method    as enum ('cod', 'upi');
create type public.payment_status    as enum ('pending', 'paid', 'failed', 'refunded');
create type public.cancel_actor      as enum ('customer', 'store', 'system');
create type public.order_item_status as enum ('active', 'unavailable');
create type public.stock_reason      as enum ('order', 'order_cancel', 'item_unavailable',
                                              'restock', 'adjustment', 'damage', 'initial');
create type public.issue_type        as enum ('missing_item', 'damaged', 'wrong_item', 'quality', 'other');
create type public.issue_status      as enum ('open', 'resolved', 'rejected');
create type public.section_type      as enum ('banner_carousel', 'category_grid', 'product_rail',
                                              'collection_rail', 'buy_again');

-- ---------- Shared helpers --------------------------------------------
-- Keeps updated_at current. Attach with:
--   create trigger set_updated_at before update on public.<t>
--   for each row execute function public.set_updated_at();
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Validates a {en, mr, hi} jsonb value: an object, only known keys, string values,
-- and a non-empty English value. Used in CHECK constraints from Phase 1 on.
create or replace function public.is_localized_text(v jsonb, require_en boolean default true)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null
     and jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each(v) e
       where e.key not in ('en', 'mr', 'hi')
          or jsonb_typeof(e.value) not in ('string', 'null')
     )
     and (not require_en or coalesce(btrim(v ->> 'en'), '') <> '');
$$;

-- ---------- Profiles ---------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text check (char_length(full_name) <= 100),
  email        text,
  phone        text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  avatar_path  text,                                   -- path in the `avatars` bucket (Phase 3)
  language     text not null default 'en' check (language in ('en', 'mr', 'hi')),
  role         public.app_role not null default 'customer',
  is_blocked   boolean not null default false,
  cod_allowed  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where role <> 'customer';

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- Role helpers (used by RLS everywhere) -----------------------
-- SECURITY DEFINER so they can read profiles without recursing into profiles' own RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('staff', 'admin')
      and not p.is_blocked
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and not p.is_blocked
  );
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- New user → profile row --------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  lang text  := meta ->> 'language';
begin
  insert into public.profiles (id, email, full_name, language)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(meta ->> 'full_name', meta ->> 'name', ''), 100), ''),
    case when lang in ('en', 'mr', 'hi') then lang else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Protect privileged profile columns --------------------------
-- A customer may edit their name/phone/language/avatar, but never role,
-- is_blocked or cod_allowed. Admins change those via admin_set_role() (Phase 7).
-- auth.uid() is NULL for the SQL editor / service role, which lets the owner
-- bootstrap the first admin (see "First admin" below).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role        is distinct from old.role
    or new.is_blocked  is distinct from old.is_blocked
    or new.cod_allowed is distinct from old.cod_allowed
    or new.id          is distinct from old.id
    or new.email       is distinct from old.email then
      raise exception 'not allowed to change protected profile fields'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------- Profiles RLS -----------------------------------------------
alter table public.profiles enable row level security;

-- Own row, or any row for staff (they need the customer's name/phone on orders).
create policy "profiles: read own or staff"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: admin update any"
  on public.profiles for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No insert policy: rows are created only by handle_new_user().
-- No delete policy: account deletion goes through delete_my_account() (Phase 3.8).

-- ---------- App config ---------------------------------------------------
create table public.app_config (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value       jsonb not null,
  is_public   boolean not null default true,         -- false = staff/admin only
  description text,
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

alter table public.app_config enable row level security;

create policy "app_config: public read"
  on public.app_config for select
  to anon, authenticated
  using (is_public or (select public.is_staff()));

create policy "app_config: admin write"
  on public.app_config for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

insert into public.app_config (key, value, description) values
  ('min_app_version', '{"android": "0.1.0", "ios": "0.1.0"}',
     'Builds below this must update (force-update screen, Phase 9.9)'),
  ('maintenance',     '{"enabled": false, "message": {"en": "We are updating the app. Back soon!", "mr": "ॲप अपडेट होत आहे. लवकरच परत येऊ!", "hi": "ऐप अपडेट हो रहा है। जल्द वापस आएँगे!"}}',
     'Shows a full-screen message and blocks checkout'),
  ('support',         '{"phone": "+910000000000", "whatsapp": "+910000000000", "email": "support@example.com", "hours": {"en": "7 AM – 10 PM", "mr": "सकाळी ७ – रात्री १०", "hi": "सुबह 7 – रात 10"}}',
     'Help screen and "Call store" buttons'),
  ('legal_urls',      '{"privacy": "", "terms": "", "refunds": ""}',
     'Filled in Phase 9.8')
on conflict (key) do nothing;

-- ---------- Rate limits (one mechanism for every RPC) --------------------
-- Fixed-window counter. Used by place_order (Phase 4) and any later RPC that needs a cap.
-- Raises RATE_LIMITED (SQLSTATE PT429, so PostgREST answers HTTP 429).
create table public.rate_limits (
  key          text        not null,          -- e.g. 'place_order:<uid>'
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;  -- no policies: only definer code touches it
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window))
                                      * extract(epoch from p_window));
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'RATE_LIMITED' using errcode = 'PT429',
      hint = format('Try again after %s', v_start + p_window);
  end if;
end $$;
revoke execute on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;

select cron.schedule('rate-limits-cleanup', '7 * * * *',
  $$ delete from public.rate_limits where window_start < now() - interval '1 day' $$);
