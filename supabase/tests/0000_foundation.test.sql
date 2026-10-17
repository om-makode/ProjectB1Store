begin;
select plan(7);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'app_config', 'app_config exists');

-- every public table has RLS on
select is(
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
  0::bigint, 'RLS enabled on every public table');

-- the seed customer got a profile with language from metadata
select is((select language from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
          'mr', 'handle_new_user copied language');

-- act as the customer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'customer cannot promote themselves');

select lives_ok(
  $$ update public.profiles set full_name = 'Renamed' where id = '33333333-3333-3333-3333-333333333333' $$,
  'customer can edit own name');

select is((select count(*) from public.profiles), 1::bigint, 'customer sees only own profile');

select * from finish();
rollback;
