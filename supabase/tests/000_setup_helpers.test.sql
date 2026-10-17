-- Runs first (pg_prove goes alphabetically) and is NOT rolled back, so every later
-- test file can use these helpers. Local test database only.
-- Two helper styles are used by the phase tests; both are defined here:
--   basejump-style: create_supabase_user / get_supabase_uid / authenticate_as / clear_authentication
--   short style:    make_user / as_user / as_anon / as_postgres
-- plus place_test_order() for order fixtures.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.create_supabase_user(identifier text, email text default null,
                                                      phone text default null, metadata jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', coalesce(email, identifier || '@test.nearkart'), phone,
          jsonb_build_object('test_identifier', identifier) || coalesce(metadata, '{}'::jsonb),
          '{"provider":"email","providers":["email"]}', now(), now());
  return v;
end $$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where raw_user_meta_data ->> 'test_identifier' = identifier limit 1
$$;

create or replace function tests.authenticate_as(identifier text)
returns void language plpgsql as $$
declare v uuid := tests.get_supabase_uid(identifier);
begin
  if v is null then raise exception 'test user % not found', identifier; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.clear_authentication()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin perform tests.clear_authentication(); end $$;

create or replace function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.make_user(p_email text, p_role public.app_role default 'customer')
returns uuid language plpgsql as $$
declare v uuid := tests.create_supabase_user(split_part(p_email, '@', 1), p_email);
begin
  update public.profiles set role = p_role where id = v;
  return v;
end $$;

-- Places a COD order for a test user: p_variant_id × p_qty, plus variant 2 × 1 (so orders
-- have two lines). Opens the store, creates an address at the store if needed, and returns
-- to the postgres role afterwards.
create or replace function tests.place_test_order(identifier text, p_variant_id bigint, p_qty int)
returns uuid language plpgsql as $$
declare
  v_uid   uuid := tests.get_supabase_uid(identifier);
  v_store public.stores;
  v_addr  uuid;
  v_res   jsonb;
begin
  update public.stores set opening_hours = '{}'::jsonb, is_accepting_orders = true,
                           max_open_orders_per_user = 10, min_order_value = 0
   where id = public.default_store_id() returning * into v_store;
  update public.inventory set stock = greatest(stock, 50), is_available = true
   where store_id = v_store.id and variant_id in (p_variant_id, 2);
  delete from public.rate_limits;

  select id into v_addr from public.addresses where user_id = v_uid and deleted_at is null limit 1;
  if v_addr is null then
    insert into public.addresses (user_id, receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
    values (v_uid, 'Test User', '9876543210', '1', 'Test Area', 'Amravati', '444601',
            extensions.st_y(v_store.location::extensions.geometry), extensions.st_x(v_store.location::extensions.geometry))
    returning id into v_addr;
  end if;

  perform tests.as_user(v_uid);
  perform public.set_cart_quantity(p_variant_id, p_qty);
  if p_variant_id <> 2 then perform public.set_cart_quantity(2, 1); end if;
  v_res := public.place_order(v_addr, 'cod', null, gen_random_uuid());
  perform tests.as_postgres();
  return (v_res ->> 'order_id')::uuid;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select ok(tests.get_supabase_uid('nobody') is null, 'test helpers installed');
select * from finish();
