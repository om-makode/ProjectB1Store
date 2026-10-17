-- ============================================================================
-- 0300_accounts_addresses.sql
-- Addresses, serviceability, account deletion, avatars bucket
-- ============================================================================

-- Uses the `private` schema created in the Phase 0 foundation migration.

-- ---------------------------------------------------------------------------
-- 1. Serviceability (used by addresses trigger, the app, and Phase 4 checkout)
-- ---------------------------------------------------------------------------

-- Internal: works on a geography point. Picks the best store for the point:
-- a store whose area covers it (nearest first); otherwise the nearest store
-- (so the UI can say "nearest store is 7.4 km away").
create or replace function private.serviceability_for_point(p_point extensions.geography)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_point is null then
    return jsonb_build_object('serviceable', false, 'reason', 'NO_LOCATION');
  end if;

  select
    s.id,
    s.eta_minutes,
    extensions.st_distance(s.location, p_point) / 1000.0 as distance_km,
    case
      when s.service_area is not null then extensions.st_covers(s.service_area, p_point)
      else extensions.st_dwithin(s.location, p_point, coalesce(s.service_radius_km, 0) * 1000.0)
    end as inside
  into v_row
  from public.stores s
  where s.location is not null and s.is_active
  order by inside desc, distance_km asc
  limit 1;

  if not found then
    return jsonb_build_object('serviceable', false, 'reason', 'NO_STORE');
  end if;

  return jsonb_build_object(
    'serviceable',      coalesce(v_row.inside, false),
    'store_id',         case when v_row.inside then v_row.id end,
    'nearest_store_id', v_row.id,
    'distance_km',      round(v_row.distance_km::numeric, 2),
    'eta_minutes',      case when v_row.inside then v_row.eta_minutes end,
    'reason',           case when v_row.inside then null else 'OUTSIDE_AREA' end
  );
end;
$$;

-- Public: lat/lng in, answer out. Callable by guests (onboarding, map pin).
create or replace function public.check_serviceability(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;

  return private.serviceability_for_point(
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  );
end;
$$;

revoke all on function public.check_serviceability(double precision, double precision) from public;
grant execute on function public.check_serviceability(double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Addresses
-- ---------------------------------------------------------------------------

create table public.addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label           text not null default 'home' check (label in ('home', 'work', 'other')),
  receiver_name   text not null check (char_length(btrim(receiver_name)) between 2 and 80),
  receiver_phone  text not null check (receiver_phone ~ '^[6-9][0-9]{9}$'),   -- 10-digit Indian mobile, no +91
  house           text not null check (char_length(btrim(house)) between 1 and 120),   -- flat / house no. / building
  area            text not null check (char_length(btrim(area)) between 2 and 160),    -- street / locality
  landmark        text check (landmark is null or char_length(landmark) <= 120),
  city            text not null check (char_length(btrim(city)) between 2 and 80),
  pincode         text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  latitude        double precision not null check (latitude between -90 and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  location        extensions.geography(Point, 4326) not null,   -- set by trigger from lat/lng
  is_serviceable  boolean not null default false,                -- set by trigger, never by the client
  is_default      boolean not null default false,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.addresses is 'Customer delivery addresses. Soft-deleted (deleted_at) so old orders keep their address_id.';

create index addresses_user_idx on public.addresses (user_id) where deleted_at is null;
-- At most one default address per user (among live addresses).
create unique index addresses_one_default_per_user
  on public.addresses (user_id) where is_default and deleted_at is null;

-- Trigger: compute location + serviceability, keep exactly one default, limit count.
create or replace function private.addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live_count int;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'ADDRESS_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;

  new.location := extensions.st_setsrid(
    extensions.st_makepoint(new.longitude, new.latitude), 4326
  )::extensions.geography;

  new.is_serviceable := coalesce(
    (private.serviceability_for_point(new.location) ->> 'serviceable')::boolean, false
  );

  if new.deleted_at is not null then
    new.is_default := false;
    return new;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_live_count
    from public.addresses a
    where a.user_id = new.user_id and a.deleted_at is null;

    if v_live_count >= 20 then
      raise exception 'ADDRESS_LIMIT' using errcode = 'P0001';
    end if;

    if v_live_count = 0 then
      new.is_default := true;          -- the first address is the default
    end if;
  end if;

  if new.is_default then
    update public.addresses a
       set is_default = false
     where a.user_id = new.user_id
       and a.is_default
       and a.id <> new.id;
  end if;

  return new;
end;
$$;

create trigger addresses_before_write
  before insert or update on public.addresses
  for each row execute function private.addresses_before_write();

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

alter table public.addresses enable row level security;

create policy "addresses: read own live"
  on public.addresses for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

create policy "addresses: insert own"
  on public.addresses for insert to authenticated
  with check (user_id = (select auth.uid()) and deleted_at is null);

create policy "addresses: update own live"
  on public.addresses for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- No DELETE policy: deletion is soft, through delete_address().
revoke delete on public.addresses from anon, authenticated;
revoke all on public.addresses from anon;

-- Soft delete + promote another address to default if needed.
create or replace function public.delete_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  update public.addresses a
     set deleted_at = now()
   where a.id = p_address_id
     and a.user_id = v_uid
     and a.deleted_at is null;

  if not found then
    raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The trigger cleared is_default on the deleted row; if the user now has no
  -- default, promote the most recently used live address.
  if not exists (
    select 1 from public.addresses a
    where a.user_id = v_uid and a.deleted_at is null and a.is_default
  ) then
    update public.addresses a
       set is_default = true
     where a.id = (
       select a2.id from public.addresses a2
       where a2.user_id = v_uid and a2.deleted_at is null
       order by a2.updated_at desc
       limit 1
     );
  end if;
end;
$$;

revoke all on function public.delete_address(uuid) from public, anon;
grant execute on function public.delete_address(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Account deletion (DPDP Act + Play Store requirement)
-- Phase 4 replaces this function to also (a) refuse while orders are open and
-- (b) anonymise past orders, which must be kept for GST records.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  delete from public.addresses where user_id = v_uid;

  -- Removes the login. profiles (and everything that cascades from it) go with it.
  -- Avatar files are removed by the app through the Storage API first (direct
  -- deletes from storage.objects are blocked by Supabase).
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Avatars bucket: public read, each user writes only <uid>/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: update own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
