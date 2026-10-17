-- =====================================================================
-- 1001_payments.sql · Phase 10: online payments (Razorpay UPI/cards)
-- Requires 1000_payments_enums.sql (awaiting_payment, partially_refunded,
-- payment_attempt_status, refund_status) in an earlier transaction.
--
-- No Phase 4–6 function is redefined:
--   * get_cart_quote / place_order already read stores.upi_enabled and return
--     payment_methods (Phase 4); a BEFORE INSERT trigger here turns UPI orders
--     into 'awaiting_payment' with a stock hold.
--   * cancel_order already lets customers cancel 'awaiting_payment' (Phase 5).
--   * Board, staff alerts and customer messages ignore 'awaiting_payment' (Phases 5–6).
-- =====================================================================

-- ---------- Store switches & order money columns -------------------------
alter table public.stores
  add column if not exists upi_enabled          boolean not null default false,
  add column if not exists payment_hold_minutes int     not null default 15 check (payment_hold_minutes between 5 and 60);

alter table public.orders
  add column if not exists payment_expires_at timestamptz,
  add column if not exists amount_paid        numeric(10,2) not null default 0 check (amount_paid >= 0),
  add column if not exists amount_refunded    numeric(10,2) not null default 0 check (amount_refunded >= 0);

-- ---------- Tables -----------------------------------------------------------
-- one row per Razorpay order (= one payment attempt series for our order)
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  user_id             uuid references public.profiles(id) on delete set null,
  provider            text not null default 'razorpay',
  provider_order_id   text not null unique,                 -- order_XXXX
  provider_payment_id text unique,                          -- pay_XXXX (set when known)
  amount              numeric(10,2) not null check (amount > 0),
  currency            text not null default 'INR',
  method              text,                                 -- upi | card | netbanking | wallet
  status              public.payment_attempt_status not null default 'created',
  error_code          text,
  error_description   text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create trigger payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id),
  payment_id         uuid not null references public.payments(id),
  amount             numeric(10,2) not null check (amount > 0),
  reason             text not null check (reason in
                       ('order_cancelled', 'item_unavailable', 'late_payment', 'duplicate_payment', 'manual')),
  status             public.refund_status not null default 'pending',
  provider_refund_id text unique,                           -- rfnd_XXXX
  attempts           int not null default 0,
  last_error         text,
  resolved_note      text,                                  -- admin_resolve_refund()
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index refunds_order_idx   on public.refunds (order_id);
create index refunds_pending_idx on public.refunds (created_at) where status in ('pending', 'failed');
create trigger refunds_updated before update on public.refunds
  for each row execute function public.set_updated_at();

create table public.payment_webhook_events (
  event_id     text primary key,                            -- x-razorpay-event-id header
  event        text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create table public.payment_mismatches (
  id                  bigint generated always as identity primary key,
  provider_payment_id text,
  provider_order_id   text,
  kind                text not null check (kind in
                        ('missing_locally', 'status_differs', 'amount_differs', 'captured_without_order')),
  details             jsonb,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);

-- ---------- RLS: read-only for owners/staff; only functions write ------------
alter table public.payments               enable row level security;
alter table public.refunds                enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_mismatches     enable row level security;

create policy "payments: own or staff read" on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "refunds: own or staff read" on public.refunds for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.user_id = (select auth.uid()) or (select public.is_staff()))));
create policy "payment_mismatches: admin read" on public.payment_mismatches for select to authenticated
  using ((select public.is_admin()));
-- payment_webhook_events: no policies (service role only)

revoke insert, update, delete on public.payments, public.refunds, public.payment_mismatches
  from anon, authenticated;
revoke all on public.payment_webhook_events from anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.refunds;
exception when duplicate_object then null;
end $$;

-- ---------- UPI orders start unpaid, with the stock held ---------------------
-- place_order (Phase 4) inserts every order as 'placed'; this turns online ones into
-- 'awaiting_payment'. The stock decrement in place_order IS the hold.
create or replace function private.orders_init_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_method = 'upi' and new.status = 'placed' then
    new.status := 'awaiting_payment';
    new.payment_expires_at := now() + make_interval(mins => coalesce(
      (select s.payment_hold_minutes from public.stores s where s.id = new.store_id), 15));
  end if;
  return new;
end $$;

create trigger orders_init_payment before insert on public.orders
  for each row execute function private.orders_init_payment();

-- ---------- confirm_payment(): the only way an order becomes paid ------------
-- Service role only (Edge Functions). Idempotent.
-- Returns 'confirmed' | 'already_confirmed' | 'refund_late' | 'refund_duplicate' | 'amount_mismatch'
create or replace function public.confirm_payment(
  p_provider_order_id   text,
  p_provider_payment_id text,
  p_amount_paise        bigint,
  p_method              text,
  p_raw                 jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_pay   public.payments;
  v_order public.orders;
begin
  select * into v_pay from public.payments
   where provider_order_id = p_provider_order_id for update;
  if not found then
    insert into public.payment_mismatches (provider_order_id, provider_payment_id, kind, details)
    values (p_provider_order_id, p_provider_payment_id, 'captured_without_order', p_raw);
    return 'amount_mismatch';
  end if;

  if v_pay.status = 'captured' and v_pay.provider_payment_id = p_provider_payment_id then
    return 'already_confirmed';                       -- webhook replay / verify + webhook race
  end if;

  select * into v_order from public.orders where id = v_pay.order_id for update;

  if p_amount_paise <> round(v_pay.amount * 100) then
    update public.payments set status = 'captured', provider_payment_id = p_provider_payment_id,
           method = p_method, raw = p_raw where id = v_pay.id;
    insert into public.payment_mismatches (provider_order_id, provider_payment_id, kind, details)
    values (p_provider_order_id, p_provider_payment_id, 'amount_differs',
            jsonb_build_object('expected_paise', round(v_pay.amount * 100), 'got_paise', p_amount_paise));
    return 'amount_mismatch';                         -- admin decides; order not confirmed
  end if;

  update public.payments set status = 'captured', provider_payment_id = p_provider_payment_id,
         method = p_method, raw = p_raw, error_code = null, error_description = null
   where id = v_pay.id;

  if v_order.status = 'awaiting_payment' then
    -- placed_at resets so the store gets its full acceptance window (auto-cancel, Phase 6).
    update public.orders
       set status = 'placed', payment_status = 'paid', amount_paid = amount_paid + v_pay.amount,
           placed_at = now(), payment_expires_at = null
     where id = v_order.id;
    insert into public.order_status_events (order_id, status, note)
    values (v_order.id, 'placed', 'Paid online (' || coalesce(p_method, 'razorpay') || ')');
    return 'confirmed';
  end if;

  -- Money arrived but the order can't use it. Queue the refund FIRST with the right reason;
  -- the amount_paid update then finds nothing left to refund (no double refund).
  insert into public.refunds (order_id, payment_id, amount, reason)
  values (v_order.id, v_pay.id, v_pay.amount,
          case when v_order.status = 'cancelled' then 'late_payment' else 'duplicate_payment' end);
  update public.orders set amount_paid = amount_paid + v_pay.amount where id = v_order.id;
  return case when v_order.status = 'cancelled' then 'refund_late' else 'refund_duplicate' end;
end $$;

-- A failed attempt never touches the order: the customer can retry until the hold ends.
create or replace function public.fail_payment(
  p_provider_order_id text, p_code text, p_description text, p_raw jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payments
     set status = 'failed', error_code = p_code, error_description = p_description, raw = p_raw
   where provider_order_id = p_provider_order_id
     and status <> 'captured';                        -- out-of-order events can't undo a capture
end $$;

-- ---------- Refund queue (cancel AND item unavailable) -----------------------
-- One rule: money we hold beyond what the order now costs goes back.
create or replace function public.queue_refund_if_needed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_keep    numeric(10,2) := case when new.status = 'cancelled' then 0 else new.grand_total end;
  v_queued  numeric(10,2);
  v_refund  numeric(10,2);
  v_payment uuid;
begin
  if new.amount_paid = 0 then return new; end if;

  select coalesce(sum(r.amount), 0) into v_queued
    from public.refunds r where r.order_id = new.id and r.status <> 'failed';

  v_refund := new.amount_paid - v_queued - v_keep;
  if v_refund <= 0 then return new; end if;

  select p.id into v_payment from public.payments p
   where p.order_id = new.id and p.status = 'captured' order by p.created_at limit 1;
  if v_payment is null then return new; end if;

  insert into public.refunds (order_id, payment_id, amount, reason)
  values (new.id, v_payment, v_refund,
          case when new.status = 'cancelled' then 'order_cancelled' else 'item_unavailable' end);
  return new;
end $$;

create trigger orders_queue_refund
  after update of status, grand_total, amount_paid on public.orders
  for each row
  when (new.payment_method = 'upi')
  execute function public.queue_refund_if_needed();

-- Customer message when a refund is queued (pending) or done (processed).
create or replace function public.notify_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_amt  text := to_char(new.amount, 'FM99999990.00');
begin
  if not (tg_op = 'INSERT' or new.status is distinct from old.status) then return new; end if;
  if new.status not in ('pending', 'processed') then return new; end if;
  select o.user_id into v_user from public.orders o where o.id = new.order_id;
  if v_user is null then return new; end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (v_user, 'refund_update',
    case new.status when 'processed'
      then jsonb_build_object('en', 'Refund done', 'mr', 'परतावा जमा झाला', 'hi', 'रिफ़ंड हो गया')
      else jsonb_build_object('en', 'Refund started', 'mr', 'परतावा सुरू झाला', 'hi', 'रिफ़ंड शुरू हुआ') end,
    case new.status when 'processed'
      then jsonb_build_object('en', '₹' || v_amt || ' refunded to your account.',
                              'mr', '₹' || v_amt || ' तुमच्या खात्यात परत केले.',
                              'hi', '₹' || v_amt || ' आपके खाते में वापस किए गए।')
      else jsonb_build_object('en', 'Refund of ₹' || v_amt || ' started. It usually reaches you in 5–7 working days.',
                              'mr', '₹' || v_amt || ' चा परतावा सुरू. साधारण ५–७ कामकाजी दिवस लागतात.',
                              'hi', '₹' || v_amt || ' का रिफ़ंड शुरू। आम तौर पर 5–7 कार्यदिवस लगते हैं।') end,
    jsonb_build_object('order_id', new.order_id, 'refund_id', new.id, 'url', '/order/' || new.order_id));
  return new;
end $$;

create trigger refunds_notify after insert or update of status on public.refunds
  for each row execute function public.notify_refund();

-- Service role only: result from Razorpay (process-refunds function or refund.* webhook).
create or replace function public.mark_refund_result(
  p_provider_refund_id text, p_status public.refund_status, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.refunds;
begin
  select * into v_ref from public.refunds where provider_refund_id = p_provider_refund_id for update;
  if not found or v_ref.status = 'processed' then return; end if;   -- unknown or already final

  update public.refunds set status = p_status, last_error = p_error where id = v_ref.id;

  if p_status = 'processed' then
    update public.orders o
       set amount_refunded = o.amount_refunded + v_ref.amount,
           payment_status  = case when o.amount_refunded + v_ref.amount >= o.amount_paid
                                  then 'refunded'::public.payment_status
                                  else 'partially_refunded'::public.payment_status end
     where o.id = v_ref.order_id;
  end if;
end $$;

-- Admin: a refund that keeps failing was paid back by hand (cash/UPI). Closes it.
create or replace function public.admin_resolve_refund(p_refund_id uuid, p_note text)
returns public.refunds language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.refunds;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'note required' using errcode = '22023'; end if;

  select * into v_ref from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  if v_ref.status = 'processed' then return v_ref; end if;

  update public.refunds
     set status = 'processed', resolved_note = btrim(p_note),
         provider_refund_id = coalesce(provider_refund_id, 'manual_' || id::text)
   where id = p_refund_id returning * into v_ref;
  update public.orders o
     set amount_refunded = o.amount_refunded + v_ref.amount,
         payment_status  = case when o.amount_refunded + v_ref.amount >= o.amount_paid
                                then 'refunded'::public.payment_status
                                else 'partially_refunded'::public.payment_status end
   where o.id = v_ref.order_id;
  insert into public.admin_audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'refund_manual', 'refund', p_refund_id::text,
          jsonb_build_object('amount', v_ref.amount, 'note', btrim(p_note)));
  return v_ref;
end $$;

-- ---------- Customer: switch an unpaid order to pay on delivery --------------
create or replace function public.switch_order_to_cod(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_store public.stores;
  v_prof  public.profiles;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'awaiting_payment' then raise exception 'NOT_AWAITING_PAYMENT' using errcode = 'P0001'; end if;

  select * into v_store from public.stores where id = v_order.store_id;
  select * into v_prof  from public.profiles where id = v_uid;
  if not coalesce(v_prof.cod_allowed, true) then
    raise exception 'COD_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v_order.grand_total > v_store.max_cod_order_value then
    raise exception 'COD_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  update public.orders
     set payment_method = 'cod', status = 'placed', placed_at = now(), payment_expires_at = null
   where id = p_order_id returning * into v_order;
  insert into public.order_status_events (order_id, status, note, actor_id)
  values (p_order_id, 'placed', 'Switched to pay on delivery', v_uid);

  return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'payment_method', v_order.payment_method);
end $$;

-- ---------- Hold expiry: unpaid orders release their stock -------------------
create or replace function public.release_expired_payment_holds()
returns int language plpgsql security definer set search_path = '' as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select id from public.orders
     where status = 'awaiting_payment'
       and payment_expires_at < now() - interval '2 minutes'      -- grace for slow UPI confirmations
     order by payment_expires_at
     for update skip locked
  loop
    perform public._cancel_order_internal(v_id, 'payment_timeout', 'system', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Report view (same access rule as Phase 7 views) ------------------
create or replace view public.v_payments_daily with (security_invoker = true) as
with pay as (
  select (p.created_at at time zone 'Asia/Kolkata')::date as day,
         count(*) filter (where p.status = 'captured')                   as payments_captured,
         coalesce(sum(p.amount) filter (where p.status = 'captured'), 0) as amount_captured,
         count(*) filter (where p.status = 'failed')                     as payments_failed
  from public.payments p group by 1
), ref as (
  select (r.updated_at at time zone 'Asia/Kolkata')::date as day, sum(r.amount) as amount_refunded
  from public.refunds r where r.status = 'processed' group by 1
)
select coalesce(pay.day, ref.day) as day,
       coalesce(pay.payments_captured, 0) as payments_captured,
       coalesce(pay.amount_captured, 0)   as amount_captured,
       coalesce(pay.payments_failed, 0)   as payments_failed,
       coalesce(ref.amount_refunded, 0)   as amount_refunded
from pay full join ref on ref.day = pay.day
where public.is_admin();
revoke all on public.v_payments_daily from anon;
grant select on public.v_payments_daily to authenticated;

-- ---------- Grants ---------------------------------------------------------
revoke execute on function
  public.confirm_payment(text, text, bigint, text, jsonb),
  public.fail_payment(text, text, text, jsonb),
  public.mark_refund_result(text, public.refund_status, text),
  public.release_expired_payment_holds(),
  public.queue_refund_if_needed(),
  public.notify_refund()
from public, anon, authenticated;
grant execute on function
  public.confirm_payment(text, text, bigint, text, jsonb),
  public.fail_payment(text, text, text, jsonb),
  public.mark_refund_result(text, public.refund_status, text)
to service_role;

revoke execute on function public.switch_order_to_cod(uuid), public.admin_resolve_refund(uuid, text) from public, anon;
grant  execute on function public.switch_order_to_cod(uuid), public.admin_resolve_refund(uuid, text) to authenticated;

-- ---------- Jobs (pg_cron; URLs and secrets live in Vault) -------------------
select cron.schedule('release-payment-holds', '* * * * *', $$ select public.release_expired_payment_holds() $$);

select cron.schedule('process-refunds', '*/2 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'process_refunds_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret')),
    body    := '{}'::jsonb)
  where exists (select 1 from public.refunds where status in ('pending', 'failed') and attempts < 5)
    and exists (select 1 from vault.decrypted_secrets where name = 'process_refunds_url')
$$);

select cron.schedule('reconcile-payments', '30 0 * * *', $$      -- 06:00 IST
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_payments_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret')),
    body    := '{}'::jsonb)
  where exists (select 1 from vault.decrypted_secrets where name = 'reconcile_payments_url')
$$);
