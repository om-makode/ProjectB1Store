begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures (run as postgres) -----------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.local');

-- Use the seed store; make it a 4 km radius around a known point.
update public.stores
   set location = extensions.st_setsrid(extensions.st_makepoint(77.7500, 20.9300), 4326)::extensions.geography,
       service_radius_km = 4,
       service_area = null
 where id = (select min(id) from public.stores);

-- check_serviceability --------------------------------------------------------
select ok((public.check_serviceability(20.9300, 77.7500) ->> 'serviceable')::boolean,
          'store location is serviceable');
select ok(not (public.check_serviceability(21.0200, 77.7500) ->> 'serviceable')::boolean,
          '10 km north is not serviceable');
select is(public.check_serviceability(21.0200, 77.7500) ->> 'reason', 'OUTSIDE_AREA', 'reason is OUTSIDE_AREA');
select throws_ok($$ select public.check_serviceability(123, 77) $$, 'P0001', 'INVALID_LOCATION', 'bad latitude rejected');

-- Polygon overrides radius
update public.stores
   set service_area = extensions.st_geogfromtext(
     'SRID=4326;POLYGON((77.70 21.05, 77.80 21.05, 77.80 20.90, 77.70 20.90, 77.70 21.05))')
 where id = (select min(id) from public.stores);
select ok((public.check_serviceability(21.0200, 77.7500) ->> 'serviceable')::boolean,
          'inside polygon wins over radius');
update public.stores set service_area = null where id = (select min(id) from public.stores);

-- Addresses as user A ---------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
values ('Asha', '9876543210', '12', 'Rajapeth', 'Amravati', '444601', 20.9300, 77.7500);

select is((select count(*)::int from public.addresses where is_default), 1, 'first address becomes default');
select ok((select is_serviceable from public.addresses limit 1), 'trigger sets is_serviceable');

insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude, is_default)
values ('Asha', '9876543210', '5', 'Far colony', 'Amravati', '444602', 21.0200, 77.7500, true);

select is((select count(*)::int from public.addresses where is_default), 1, 'still exactly one default');
select ok(not (select is_serviceable from public.addresses where area = 'Far colony'), 'far address not serviceable');

select throws_ok(
  $$ insert into public.addresses (user_id, receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
     values ('00000000-0000-0000-0000-0000000000b1', 'X', '9876543210', '1', 'Area', 'City', '444601', 20.93, 77.75) $$,
  '42501', null, 'cannot insert an address for another user');

-- Soft delete hides the row and promotes another default
select public.delete_address((select id from public.addresses where is_default));
select is((select count(*)::int from public.addresses), 1, 'deleted address hidden');
select is((select count(*)::int from public.addresses where is_default), 1, 'remaining address promoted to default');

-- User B sees nothing of A
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.addresses), 0, 'user B cannot see user A addresses');

select * from finish();
rollback;
