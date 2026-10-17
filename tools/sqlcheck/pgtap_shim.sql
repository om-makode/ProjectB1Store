-- Minimal pgTAP stand-in for PGlite (harness only). Results go to tap_results.
create schema if not exists tap; grant usage on schema tap to public;
create table if not exists tap.results (n serial, ok boolean, description text, detail text);
grant all on tap.results to public; grant all on sequence tap.results_n_seq to public;
create or replace function public.plan(int) returns text language sql as $$ select '1..' || $1 $$;
create or replace function public._tap(b boolean, d text, det text default null) returns text language plpgsql security definer as $$
begin insert into tap.results (ok, description, detail) values (coalesce(b, false), d, det);
return case when coalesce(b,false) then 'ok' else 'not ok' end || ' - ' || coalesce(d,''); end $$;
create or replace function public.ok(boolean, text default null) returns text language sql as $$ select public._tap($1, $2) $$;
create or replace function public.is(anyelement, anyelement, text default null) returns text language sql as $$
  select public._tap($1 is not distinct from $2, $3, format('have %s want %s', $1, $2)) $$;
create or replace function public.isnt(anyelement, anyelement, text default null) returns text language sql as $$
  select public._tap($1 is distinct from $2, $3) $$;
create or replace function public.matches(text, text, text default null) returns text language sql as $$
  select public._tap($1 ~ $2, $3, $1) $$;
create or replace function public.has_table(name, name, text default null) returns text language sql as $$
  select public._tap(to_regclass($1 || '.' || $2) is not null, $3) $$;
create or replace function public.lives_ok(text, text default null) returns text language plpgsql as $$
begin execute $1; return public._tap(true, $2);
exception when others then return public._tap(false, $2, sqlerrm); end $$;
create or replace function public.throws_ok(text, text, text, text) returns text language plpgsql as $$
begin execute $1; return public._tap(false, $4, 'no error');
exception when others then
  return public._tap(($2 is null or sqlstate = $2) and ($3 is null or sqlerrm = $3), $4, sqlstate || ': ' || sqlerrm); end $$;
create or replace function public.throws_ok(text, text, text) returns text language sql as $$ select public.throws_ok($1, $2, null, $3) $$;
create or replace function public.throws_ok(text, text) returns text language sql as $$ select public.throws_ok($1, $2, null, null) $$;
create or replace function public.throws_ok(text) returns text language sql as $$ select public.throws_ok($1, null, null, null) $$;
create or replace function public.finish() returns setof text language sql as $$ select null::text where false $$;
