-- =====================================================================
-- 0900_hardening.sql · Phase 9: hardening before release
--   * Indexes: the ones Phase 9.6 lists already exist from Phases 1–5
--     (orders_user_placed_idx, orders_store_status_idx, order_items_order_idx,
--      order_status_events_order_idx, inventory_movements_variant_idx, …).
--     Add new ones here only after EXPLAIN shows a real need.
--   * Rate limits: rate_limits + check_rate_limit() live in Phase 0 and are used
--     by place_order (Phase 4). The maintenance switch is checked there too.
-- =====================================================================

-- ---------- Ops health (admin dashboard + scheduled alert) -----------------
create or replace view public.v_ops_health with (security_invoker = true) as
select
  (select count(*) from public.orders where status = 'placed'
     and placed_at < now() - interval '5 minutes')                          as unaccepted_over_5m,
  (select count(*) from public.orders where status = 'cancelled' and cancelled_by = 'system'
     and cancelled_at > now() - interval '1 hour')                          as auto_cancelled_last_hour,
  (select max(p.updated_at) from public.push_tokens p
     join public.profiles pr on pr.id = p.user_id and pr.role in ('staff','admin')) as last_staff_token_seen,
  (select count(*) from public.inventory where stock = 0 and is_available)  as out_of_stock_variants
where public.is_admin();
-- Same access rule as the Phase 7 report views: readable by logged-in users, rows only for admins.
revoke all on public.v_ops_health from anon;
grant select on public.v_ops_health to authenticated;

-- ---------- Client IP for guest-side limits (best effort) ------------------
create or replace function public.request_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown')
$$;
revoke execute on function public.request_ip() from public, anon, authenticated;

-- ---------- Statement timeouts for API roles --------------------------------
alter role anon          set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
notify pgrst, 'reload config';

-- ---------- app_config keys for release ------------------------------------
insert into public.app_config (key, value, description) values
  ('latest_app_version', '{"android": "1.0.0", "ios": "1.0.0"}', 'Soft "update available" prompt (Phase 9.9)')
on conflict (key) do nothing;

update public.app_config
   set value = jsonb_set(value, '{ordering_only}', 'true', true)
 where key = 'maintenance' and not (value ? 'ordering_only');

update public.app_config
   set value = value || '{"seller": "", "grievance": ""}'::jsonb
 where key = 'legal_urls' and not (value ? 'seller');
