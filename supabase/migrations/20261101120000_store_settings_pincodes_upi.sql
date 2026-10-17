-- =====================================================================
-- Admin store settings: delivery pincodes + online payments switch.
--
-- admin_update_store_settings() is copied from 20261101070000_p7_admin.sql
-- (the only definition) and now also accepts:
--   serviceable_pincodes  jsonb array of 6-digit pincodes (trimmed, deduped, sorted; ≤ 200)
--   upi_enabled           boolean (Razorpay keys must be configured for it to work)
--   payment_hold_minutes  5–60 (also enforced by the column check from p10)
-- Grants are unchanged (create or replace keeps them).
-- =====================================================================

create or replace function public.admin_update_store_settings(p_store_id bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  s        public.stores;
  d        jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_jsonb(st) into v_before from public.stores st where st.id = p_store_id for update;
  if v_before is null then raise exception 'store not found' using errcode = 'P0002'; end if;

  update public.stores set
    name                     = coalesce(p_patch->'name', name),
    address                  = coalesce(p_patch->'address', address),
    phone                    = coalesce(p_patch->>'phone', phone),
    whatsapp                 = coalesce(p_patch->>'whatsapp', whatsapp),
    gstin                    = coalesce(upper(p_patch->>'gstin'), gstin),
    fssai_license            = coalesce(p_patch->>'fssai_license', fssai_license),
    opening_hours            = coalesce(p_patch->'opening_hours', opening_hours),
    eta_minutes              = coalesce((p_patch->>'eta_minutes')::int, eta_minutes),
    min_order_value          = coalesce((p_patch->>'min_order_value')::numeric, min_order_value),
    delivery_fee             = coalesce((p_patch->>'delivery_fee')::numeric, delivery_fee),
    free_delivery_above      = coalesce((p_patch->>'free_delivery_above')::numeric, free_delivery_above),
    small_cart_threshold     = coalesce((p_patch->>'small_cart_threshold')::numeric, small_cart_threshold),
    small_cart_fee           = coalesce((p_patch->>'small_cart_fee')::numeric, small_cart_fee),
    packaging_fee            = coalesce((p_patch->>'packaging_fee')::numeric, packaging_fee),
    max_cod_order_value      = coalesce((p_patch->>'max_cod_order_value')::numeric, max_cod_order_value),
    max_open_orders_per_user = coalesce((p_patch->>'max_open_orders_per_user')::int, max_open_orders_per_user),
    auto_cancel_minutes      = coalesce((p_patch->>'auto_cancel_minutes')::int, auto_cancel_minutes),
    service_radius_km        = coalesce((p_patch->>'service_radius_km')::numeric, service_radius_km),
    location = case when p_patch ? 'location' then
                 extensions.st_setsrid(extensions.st_makepoint(
                   (p_patch#>>'{location,lng}')::float8, (p_patch#>>'{location,lat}')::float8), 4326)::extensions.geography
               else location end,
    service_area = case
                 when not (p_patch ? 'service_area') then service_area
                 when p_patch->'service_area' = 'null'::jsonb then null
                 else extensions.st_setsrid(extensions.st_geomfromgeojson(p_patch->>'service_area'), 4326)::extensions.geography
               end,
    -- added 20261101120000: delivery pincodes (addresses without GPS) and online payments
    serviceable_pincodes = case
                 when not (p_patch ? 'serviceable_pincodes') then serviceable_pincodes
                 else coalesce((
                   select array_agg(distinct btrim(x) order by btrim(x))
                     from jsonb_array_elements_text(p_patch->'serviceable_pincodes') x
                    where btrim(x) <> ''), '{}'::text[])
               end,
    upi_enabled          = coalesce((p_patch->>'upi_enabled')::boolean, upi_enabled),
    payment_hold_minutes = coalesce((p_patch->>'payment_hold_minutes')::int, payment_hold_minutes)
  where id = p_store_id
  returning * into s;

  -- validation after the update: any failure rolls the update back
  if s.min_order_value < 0 or s.delivery_fee < 0 or s.free_delivery_above < 0 or s.small_cart_fee < 0
     or s.small_cart_threshold < 0 or s.packaging_fee < 0 then
    raise exception 'fees and thresholds cannot be negative' using errcode = '22023';
  end if;
  if s.max_cod_order_value <= 0 then raise exception 'max COD value must be above 0' using errcode = '22023'; end if;
  if s.max_cod_order_value < s.min_order_value then
    raise exception 'max COD value is below the minimum order: nobody could check out' using errcode = '22023';
  end if;
  if s.auto_cancel_minutes not between 2 and 60 then
    raise exception 'auto-cancel must be 2–60 minutes' using errcode = '22023';
  end if;
  if s.eta_minutes not between 5 and 240 then raise exception 'ETA must be 5–240 minutes' using errcode = '22023'; end if;
  if s.service_radius_km not between 0.3 and 30 then
    raise exception 'service radius must be 0.3–30 km' using errcode = '22023';
  end if;
  if s.max_open_orders_per_user not between 1 and 10 then
    raise exception 'open orders per user must be 1–10' using errcode = '22023';
  end if;
  if coalesce(s.gstin, '') <> '' and s.gstin !~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'GSTIN format looks wrong' using errcode = '22023';
  end if;
  if coalesce(s.fssai_license, '') <> '' and s.fssai_license !~ '^\d{14}$' then
    raise exception 'FSSAI licence is 14 digits' using errcode = '22023';
  end if;
  if p_patch ? 'serviceable_pincodes' and jsonb_typeof(p_patch->'serviceable_pincodes') <> 'array' then
    raise exception 'serviceable_pincodes must be a list of pincodes' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(s.serviceable_pincodes) pc where pc !~ '^[1-9][0-9]{5}$') then
    raise exception 'pincodes must be 6 digits and not start with 0' using errcode = '22023';
  end if;
  if cardinality(s.serviceable_pincodes) > 200 then
    raise exception 'at most 200 delivery pincodes' using errcode = '22023';
  end if;
  if s.payment_hold_minutes not between 5 and 60 then
    raise exception 'payment hold must be 5–60 minutes' using errcode = '22023';
  end if;
  if jsonb_typeof(s.opening_hours) <> 'object' then
    raise exception 'opening_hours must be an object of weekday → ranges' using errcode = '22023';
  end if;
  for d in select value from jsonb_each(s.opening_hours) loop
    if jsonb_typeof(d) <> 'array' or exists (
         select 1 from jsonb_array_elements(d) rng
         where coalesce(rng.value->>'open', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
            or coalesce(rng.value->>'close', '') !~ '^([01]\d|2[0-3]):[0-5]\d$') then
      raise exception 'opening hours must be HH:MM ranges' using errcode = '22023';
    end if;
  end loop;

  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'store_settings', 'store', p_store_id::text, v_before, to_jsonb(s));

  return to_jsonb(s);
end $$;
