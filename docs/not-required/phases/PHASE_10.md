# Phase 10: Online Payments (UPI)

> **Goal:** let customers **pay before delivery** with UPI (and cards/netbanking/wallets) through **Razorpay**, safely. An order counts as paid **only after the server verifies it with Razorpay**, never because the phone says so. Cancellations and unavailable items on paid orders are **refunded automatically**. Cash on Delivery stays available.
> **Duration:** about 1–1.5 weeks (plus Razorpay account activation, which can take several days) · **Depends on:** Phase 9 (live app, legal pages) · **Next:** v1.1 release, then the "Later" list in the [overview](00_PHASES_OVERVIEW.md) (riders, coupons, multi-store)

**Done when:**
- [ ] Checkout offers **UPI / online** and **Cash on delivery**, with server rules for which is allowed (e.g. COD hidden above `max_cod_order_value`)
- [ ] Choosing online creates the order as `awaiting_payment`, **holds the stock**, and opens Razorpay Checkout (UPI apps on the phone appear automatically)
- [ ] The order becomes `placed` + `paid` **only** through `confirm_payment()`, called by the `verify-payment` or `razorpay-webhook` Edge Function after **HMAC signature verification** and an amount check. Replaying a webhook changes nothing.
- [ ] Unpaid orders release their stock after `stores.payment_hold_minutes` (pg_cron) and are cancelled with reason `payment_timeout`
- [ ] A payment that arrives **late** (after the hold expired) or **twice** for the same order is refunded automatically
- [ ] Cancelling a paid order, or marking an item unavailable on it, creates a **refund** for the right amount, processed by Razorpay's Refunds API, with live status for the customer
- [ ] Staff see **"PAID ONLINE: don't collect cash"** on paid orders
- [ ] A daily reconciliation compares our `payments` with Razorpay's and flags mismatches. The admin has a Payments screen.
- [ ] pgTAP tests cover idempotency, late/duplicate payments, hold expiry and refund amounts. The whole flow is tested end to end in Razorpay **test mode**.

| # | Heading | Output |
|---|---|---|
| 10.1 | Razorpay account & keys | Account, KYC, test/live keys, auto-capture, webhook secret, Supabase secrets |
| 10.2 | Payments schema | `1000_payments_enums.sql`, `1001_payments.sql`: tables, columns, RLS, `place_order` changes, `confirm_payment`, hold expiry, refund queue |
| 10.3 | `create-payment` Edge Function | Razorpay order from the DB amount, reuse on retry |
| 10.4 | Checkout payment step | Payment method picker, Razorpay Checkout, `verify-payment`, pending/failed/retry states |
| 10.5 | Webhook verification | `razorpay-webhook` with HMAC check, event log, idempotent handlers |
| 10.6 | Refunds on cancel / item unavailable | Refund trigger, `process-refunds` function, refund webhooks, customer UI |
| 10.7 | Reconciliation report | Daily `reconcile-payments` job, mismatch table, admin Payments screen, settlement check |

> ⚠️ **Costs:** Razorpay's Standard plan has **no setup or annual fee** but charges a **fee per successful transaction** (historically about **2%** for most domestic methods, with **18% GST on that fee**; some methods such as Amex, international cards or EMI cost more). UPI pricing has changed over time with the government's zero-MDR rules, so **check razorpay.com/pricing** before going live and put the real numbers in your margin sheet. The fee is generally **not returned** when you refund a payment. Instant refunds cost extra; normal refunds don't.
>
> **Interim option before this phase:** "Cash on delivery" can already mean **cash or UPI to the delivery person** (a printed static UPI QR of the store). Rename the option to "Pay on delivery (cash / UPI)" in Phase 4 copy. It costs nothing and covers many customers until online payments are live.

---

## 10.1 Razorpay account & keys

**Goal:** an activated Razorpay account, test and live keys, and every secret stored only on the server side.

**Steps**
1. **Sign up** at razorpay.com as the business. Activation (KYC) usually asks for: PAN (business or proprietor), a business proof (GST certificate, Udyam, or shop & establishment licence), the bank account for settlements, and a **website or app link with contact details, terms, privacy policy and refund/cancellation policy**. The Phase 9.8 pages on Cloudflare Pages are exactly this; give the `/seller`, `/terms`, `/privacy` and `/refunds` URLs and the Play Store link.
2. **Test mode** works immediately, before activation. Build and test everything with `rzp_test_…` keys.
3. Dashboard → **Account & Settings → Payment capture** → set **Automatic** capture (immediate). Otherwise payments stay `authorized` and are refunded by Razorpay if not captured in time.
4. Dashboard → **Webhooks** → add `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`, set a long random **webhook secret**, and select events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. Create separate webhooks (and secrets) for test and live mode.
5. Store secrets in Supabase (never in the app, never in git):
   ```bash
   supabase secrets set \
     RAZORPAY_KEY_ID=rzp_test_xxx \
     RAZORPAY_KEY_SECRET=xxxxxxxx \
     RAZORPAY_WEBHOOK_SECRET=xxxxxxxx \
     INTERNAL_CRON_SECRET=$(openssl rand -hex 32)
   ```
   The **key id** is not secret (Checkout needs it on the phone), but the app gets it from `create-payment`'s response, so switching test → live needs **no app release**.
6. Note the **settlement cycle** (by default a few working days after capture; check your dashboard). Cash-flow planning: online money arrives later than COD cash.

**Checks:** a test payment from the Razorpay dashboard's test tools shows up in the webhook logs (Dashboard → Webhooks → delivery attempts) once 10.5 is deployed.

---

## 10.2 Payments schema

**Goal:** model payment attempts, refunds and webhook events; change `place_order` so online orders wait for payment while their stock is held; add the single trusted function that marks an order paid.

**Files**
```
supabase/migrations/1000_payments_enums.sql    # enum changes only (see note)
supabase/migrations/1001_payments.sql          # everything else
supabase/tests/70_payments.test.sql
```

> **Why two files?** `ALTER TYPE … ADD VALUE` can't be used by later statements **in the same transaction**, and each migration file runs as one transaction. Adding the enum values in their own file avoids "unsafe use of new value" errors.

### `1000_payments_enums.sql`
```sql
alter type public.order_status   add value if not exists 'awaiting_payment' before 'placed';
alter type public.payment_status add value if not exists 'partially_refunded' after 'paid';

create type public.payment_attempt_status as enum ('created', 'authorized', 'captured', 'failed');
create type public.refund_status          as enum ('pending', 'processing', 'processed', 'failed');
```

### `1001_payments.sql`: tables and columns
```sql
-- store switches
alter table public.stores
  add column if not exists upi_enabled          boolean not null default false,
  add column if not exists payment_hold_minutes int     not null default 15 check (payment_hold_minutes between 5 and 60);

-- order money tracking
alter table public.orders
  add column if not exists payment_expires_at timestamptz,
  add column if not exists amount_paid        numeric(10,2) not null default 0,
  add column if not exists amount_refunded    numeric(10,2) not null default 0;

-- one row per Razorpay order (= one payment attempt series for our order)
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  user_id             uuid not null references public.profiles(id),
  provider            text not null default 'razorpay',
  provider_order_id   text not null unique,                 -- order_XXXX
  provider_payment_id text unique,                          -- pay_XXXX (set when known)
  amount              numeric(10,2) not null check (amount > 0),
  currency            text not null default 'INR',
  method              text,                                 -- upi | card | netbanking | wallet (from Razorpay)
  status              public.payment_attempt_status not null default 'created',
  error_code          text,
  error_description   text,
  raw                 jsonb,                                -- last payment entity from Razorpay
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
  reason             text not null,                         -- order_cancelled | item_unavailable | late_payment | duplicate_payment | manual
  status             public.refund_status not null default 'pending',
  provider_refund_id text unique,                           -- rfnd_XXXX
  attempts           int not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index refunds_pending_idx on public.refunds (created_at) where status in ('pending','failed');
create trigger refunds_updated before update on public.refunds
  for each row execute function public.set_updated_at();

-- webhook idempotency + audit
create table public.payment_webhook_events (
  event_id     text primary key,                            -- x-razorpay-event-id header
  event        text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- reconciliation findings (10.7)
create table public.payment_mismatches (
  id                  bigint generated always as identity primary key,
  provider_payment_id text,
  provider_order_id   text,
  kind                text not null,                        -- missing_locally | status_differs | amount_differs | captured_without_order
  details             jsonb,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
```

### RLS
```sql
alter table public.payments               enable row level security;
alter table public.refunds                enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_mismatches     enable row level security;

create policy "own payments" on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "own refunds" on public.refunds for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.user_id = (select auth.uid()) or (select public.is_staff()))));
create policy "admin mismatches" on public.payment_mismatches for select to authenticated
  using ((select public.is_admin()));
-- payment_webhook_events: no policies (service role only)
-- no insert/update/delete policies anywhere: only the functions below write
```
Add `refunds` to the Realtime publication (the customer sees refund status change live). `orders` is already in it.
```sql
alter publication supabase_realtime add table public.refunds;
```

### `place_order` changes (`create or replace` with the Phase 4 body plus these parts)
```sql
-- after loading v_store and computing totals:
if p_payment_method = 'upi' then
  if not v_store.upi_enabled then
    raise exception 'payment_method_unavailable' using errcode = 'P0001';
  end if;
elsif p_payment_method = 'cod' then
  if v_grand_total > v_store.max_cod_order_value or not v_profile.cod_allowed then
    raise exception 'cod_not_allowed' using errcode = 'P0001';   -- app suggests paying online
  end if;
end if;

-- when inserting the order:
insert into public.orders (…, status, payment_method, payment_status, payment_expires_at, placed_at, …)
values (…,
  case when p_payment_method = 'upi' then 'awaiting_payment' else 'placed' end,
  p_payment_method, 'pending',
  case when p_payment_method = 'upi' then now() + make_interval(mins => v_store.payment_hold_minutes) end,
  now(), …);
-- stock is decremented exactly as for COD: the decrement IS the hold.
```
Also update the Phase 4–6 code that should ignore unpaid orders:
- **Store board** (`useOrdersBoard`, Phase 6.2) filters `status <> 'awaiting_payment'`. Staff never see unpaid orders.
- **`notify_order_status()`** (Phase 5): no staff "new order" notification for `awaiting_payment`. It fires when the status becomes `placed`.
- **`auto_cancel_stale_orders()`** (Phase 6.8) already only looks at `status = 'placed'` and `placed_at`. `confirm_payment()` resets `placed_at` to the payment time, so staff get the full acceptance window.
- **`get_cart_quote()`** (Phase 4.3) returns `payment_methods`:
  ```jsonc
  "payment_methods": [
    { "method": "upi", "allowed": true },
    { "method": "cod", "allowed": false, "reason": "cod_limit", "limit": 2000 }
  ]
  ```
- **`cancel_order()`** (Phase 5.3): a customer may also cancel an `awaiting_payment` order (it simply releases the stock).

### `confirm_payment()`: the only way an order becomes paid
Called by the Edge Functions with the **service role** only. It's idempotent and handles the awkward cases.
```sql
create or replace function public.confirm_payment(
  p_provider_order_id   text,
  p_provider_payment_id text,
  p_amount_paise        bigint,
  p_method              text,
  p_raw                 jsonb
) returns text                      -- 'confirmed' | 'already_confirmed' | 'refund_late' | 'refund_duplicate' | 'amount_mismatch'
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
    return 'already_confirmed';                                         -- webhook replay / verify + webhook race
  end if;

  select * into v_order from public.orders where id = v_pay.order_id for update;

  -- amount check in paise, against OUR stored amount
  if p_amount_paise <> round(v_pay.amount * 100) then
    update public.payments set status = 'captured', provider_payment_id = p_provider_payment_id,
           method = p_method, raw = p_raw where id = v_pay.id;
    insert into public.payment_mismatches (provider_order_id, provider_payment_id, kind, details)
    values (p_provider_order_id, p_provider_payment_id, 'amount_differs',
            jsonb_build_object('expected_paise', round(v_pay.amount * 100), 'got_paise', p_amount_paise));
    return 'amount_mismatch';                                           -- admin decides; order not confirmed
  end if;

  update public.payments set status = 'captured', provider_payment_id = p_provider_payment_id,
         method = p_method, raw = p_raw, error_code = null, error_description = null
   where id = v_pay.id;

  if v_order.status = 'awaiting_payment' then
    update public.orders
       set status = 'placed', payment_status = 'paid', amount_paid = v_pay.amount,
           placed_at = now(), payment_expires_at = null
     where id = v_order.id;
    insert into public.order_status_events (order_id, status, note)
    values (v_order.id, 'placed', 'Paid online (' || coalesce(p_method, 'razorpay') || ')');
    return 'confirmed';
  end if;

  -- money arrived but the order can't use it: refund automatically
  update public.orders set amount_paid = amount_paid + v_pay.amount where id = v_order.id;
  insert into public.refunds (order_id, payment_id, amount, reason)
  values (v_order.id, v_pay.id, v_pay.amount,
          case when v_order.status = 'cancelled' then 'late_payment' else 'duplicate_payment' end);
  return case when v_order.status = 'cancelled' then 'refund_late' else 'refund_duplicate' end;
end $$;
revoke execute on function public.confirm_payment(text, text, bigint, text, jsonb) from public, anon, authenticated;
```
`fail_payment(p_provider_order_id, p_code, p_description, p_raw)` (same style, service role only) sets `payments.status = 'failed'` and the error fields, **without** touching the order: the customer can retry until the hold expires.

> **Duplicate payments across attempts:** if a customer retries with a *new* Razorpay order and both succeed, the second `confirm_payment` finds the order already `placed`/paid and queues a `duplicate_payment` refund. `create-payment` (10.3) prevents most of this by reusing the existing Razorpay order.

### Hold expiry (pg_cron)
```sql
create or replace function public.release_expired_payment_holds()
returns int language plpgsql security definer set search_path = '' as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select id from public.orders
     where status = 'awaiting_payment'
       and payment_expires_at < now() - interval '2 minutes'      -- grace for slow UPI confirmations
     for update skip locked
  loop
    -- reuse the internal cancel + restock helper from Phase 5/6 (the one cancel_order() and
    -- auto_cancel_stale_orders() call); here named _cancel_order_internal for clarity
    perform public._cancel_order_internal(v_id, 'system', 'payment_timeout');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.release_expired_payment_holds() from public, anon, authenticated;

select cron.schedule('release-payment-holds', '* * * * *', $$ select public.release_expired_payment_holds() $$);
```
A payment captured after this ran becomes a `late_payment` refund in `confirm_payment()`. The customer is never charged for an order they didn't get.

### Refund queue trigger (handles cancel **and** item unavailable)
One rule: after any change to a paid order, money we hold beyond what the order now costs must go back.
```sql
create or replace function public.queue_refund_if_needed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_keep      numeric(10,2) := case when new.status = 'cancelled' then 0 else new.grand_total end;
  v_queued    numeric(10,2);
  v_refund    numeric(10,2);
  v_payment   uuid;
begin
  if new.amount_paid = 0 then return new; end if;

  select coalesce(sum(amount), 0) into v_queued
    from public.refunds where order_id = new.id and status <> 'failed';

  v_refund := new.amount_paid - v_queued - v_keep;
  if v_refund <= 0 then return new; end if;

  select id into v_payment from public.payments
   where order_id = new.id and status = 'captured' order by created_at limit 1;

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
```
- **Cancel** (customer before packing, staff, or system) → full refund of what's left.
- **`staff_mark_item_unavailable()`** (Phase 6.4) lowers `grand_total` → refund of the difference. If the last item goes, the order is cancelled → the rest is refunded.
- The "already queued, not failed" sum stops double refunds when several updates happen in a row.

`mark_refund_result(p_provider_refund_id text, p_status refund_status, p_error text)` (service role only) updates the refund and, on `processed`, adds it to `orders.amount_refunded` and sets `payment_status` to `refunded` (all of `amount_paid` returned) or `partially_refunded`. It also inserts a customer notification ("₹42 refunded to your UPI account").

### Customer notifications (extend `notify_order_status`)
| Event | Message (EN; MR/HI in i18n) |
|---|---|
| `awaiting_payment` → `placed` | "Payment received. Your order is placed." |
| cancelled with `payment_timeout` | "Payment not completed in time. Your order was cancelled. Any amount debited will be refunded automatically." |
| refund queued | "Refund of ₹X started. It usually reaches you in 5–7 working days." |
| refund processed | "₹X refunded to your account." |

**Tests (pgTAP, `70_payments.test.sql`):** see the list at the end of 10.6.

---

## 10.3 `create-payment` Edge Function

**Goal:** create (or reuse) a Razorpay order for one of **our** orders, using the amount **from the database**. The phone sends only our order id.

**Files**
```
supabase/functions/_shared/razorpay.ts       # tiny fetch client (basic auth), types
supabase/functions/_shared/supabase.ts       # service client + "who is calling" helper
supabase/functions/create-payment/index.ts
```

**`_shared/razorpay.ts`**
```ts
const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!;
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;
const AUTH = 'Basic ' + btoa(`${KEY_ID}:${KEY_SECRET}`);

export async function rzp<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new RazorpayError(res.status, body?.error?.code, body?.error?.description);
  return body as T;
}
export const keyId = KEY_ID;

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// constant-time compare for signatures
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
```

**`create-payment/index.ts`**
```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { rzp, keyId } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  // 1. Who is calling? (the function is deployed WITH JWT verification)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { orderId } = await req.json();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 2. Load OUR order: must be the caller's, awaiting payment, hold not expired
  const { data: order } = await admin.from('orders')
    .select('id, order_number, user_id, status, grand_total, payment_expires_at')
    .eq('id', orderId).single();
  if (!order || order.user_id !== user.id) return json({ error: 'not_found' }, 404);
  if (order.status !== 'awaiting_payment') return json({ error: 'not_payable', status: order.status }, 409);
  const secondsLeft = Math.floor((Date.parse(order.payment_expires_at) - Date.now()) / 1000);
  if (secondsLeft < 60) return json({ error: 'hold_expired' }, 409);

  // 3. Reuse an open Razorpay order for the same amount (prevents duplicate payments on retry)
  const { data: existing } = await admin.from('payments')
    .select('provider_order_id, amount, status')
    .eq('order_id', order.id).in('status', ['created', 'failed'])
    .eq('amount', order.grand_total).order('created_at', { ascending: false }).limit(1).maybeSingle();

  let providerOrderId = existing?.provider_order_id;
  if (!providerOrderId) {
    const rzpOrder = await rzp<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: Math.round(Number(order.grand_total) * 100),     // paise, integer
        currency: 'INR',
        receipt: order.order_number,                              // ≤ 40 chars
        notes: { order_id: order.id },
      }),
    });
    providerOrderId = rzpOrder.id;
    await admin.from('payments').insert({
      order_id: order.id, user_id: user.id, provider_order_id: providerOrderId, amount: order.grand_total,
    });
  }

  const { data: profile } = await admin.from('profiles').select('full_name, email, phone').eq('id', user.id).single();
  return json({
    keyId,                                   // test or live, decided by server secrets
    razorpayOrderId: providerOrderId,
    amountPaise: Math.round(Number(order.grand_total) * 100),
    currency: 'INR',
    timeoutSeconds: secondsLeft - 30,        // Checkout closes before our hold expires
    prefill: { name: profile?.full_name ?? '', email: profile?.email ?? '', contact: profile?.phone ?? '' },
  });
});
```
Deploy: `supabase functions deploy create-payment` (JWT verification **on**, the default).

**Rules**
- The amount comes **only** from `orders.grand_total`. The request body is just `{ orderId }`.
- If `grand_total` changed (it can't while `awaiting_payment`, but defend anyway), a new Razorpay order is created for the new amount, because Razorpay orders have a fixed amount.
- Errors from Razorpay are logged to Sentry (Phase 9.4) without customer data.

**Checks:** calling with another user's order id → 404. Calling twice → same `razorpayOrderId`. Amount in the Razorpay dashboard equals `grand_total × 100`.

---

## 10.4 Checkout payment step

**Goal:** a clear payment choice, a smooth Razorpay Checkout (UPI apps on the phone show up), and honest states when payment is slow, fails or the app is closed in the middle.

**Packages**
```bash
npm install react-native-razorpay
npx expo prebuild        # native module: needs a development build, not Expo Go (already the case since Phase 0)
```
> `react-native-razorpay` is a native module. It autolinks in a prebuild/dev build. Check its README for **ProGuard/R8 rules**, since Phase 9.2 turned R8 on for release builds; a missing rule shows up only in release builds, so test the payment on a **release** APK.

**Files**
```
mobile/src/features/payments/api.ts                 # createPayment(), verifyPayment() → Edge Functions
mobile/src/features/payments/useRazorpayCheckout.ts
mobile/src/features/payments/PaymentMethodPicker.tsx
mobile/src/features/payments/PayNowBanner.tsx        # on order detail while awaiting_payment
mobile/src/features/payments/RefundStatus.tsx        # on order detail (10.6)
mobile/app/cart.tsx                                  # picker added above Place order
mobile/app/order/[id].tsx                            # payment states
supabase/functions/verify-payment/index.ts
```

### Payment method picker (cart)
Driven by `quote.payment_methods` (10.2), never hard-coded:
```
Pay with
 (•) UPI / Cards / Netbanking         Pay now, secure via Razorpay
 ( ) Pay on delivery (cash / UPI)     Not available above ₹2,000          ← disabled with reason
```
- The last choice is remembered (MMKV). If it's no longer allowed, fall back to the first allowed method and say why.
- Button text follows the choice: **"Pay ₹412"** vs **"Place order · ₹412"**.

### Flow
```ts
// useRazorpayCheckout.ts (sketch)
export function useRazorpayCheckout() {
  const qc = useQueryClient();
  return async function pay(orderId: string) {
    const p = await createPayment(orderId);                     // 10.3
    try {
      const res = await RazorpayCheckout.open({
        key: p.keyId,
        order_id: p.razorpayOrderId,
        amount: p.amountPaise,
        currency: p.currency,
        name: 'NearKart',
        description: t('payments.orderDesc'),
        prefill: p.prefill,
        timeout: p.timeoutSeconds,
        theme: { color: tokens.brand },
      });
      // res = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
      const v = await verifyPayment(res);                        // fast path; the webhook is the safety net
      return v.result;                                           // 'confirmed' | 'pending'
    } catch (e: any) {
      // user closed the sheet, UPI app declined, network… Order stays awaiting_payment until the hold ends.
      return 'not_completed';
    } finally {
      qc.invalidateQueries({ queryKey: ['orders', 'detail', orderId] });
    }
  };
}
```
Cart → `place_order(…, 'upi', …)` → navigate to `order/[id]` **first**, then open Checkout from there. If the app is killed during payment, the customer lands back on a screen that knows the order.

### `verify-payment` Edge Function (fast confirmation)
```ts
// supabase/functions/verify-payment/index.ts (JWT verification on)
const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

// 1. Signature from Checkout = HMAC_SHA256(order_id + "|" + payment_id, key_secret), hex
const expected = await hmacHex(Deno.env.get('RAZORPAY_KEY_SECRET')!, `${razorpay_order_id}|${razorpay_payment_id}`);
if (!safeEqual(expected, razorpay_signature)) return json({ error: 'bad_signature' }, 400);

// 2. The signature proves authenticity, not that money was captured: fetch the payment
const payment = await rzp<any>(`/payments/${razorpay_payment_id}`);
if (payment.order_id !== razorpay_order_id) return json({ error: 'order_mismatch' }, 400);

// 3. Check the caller owns the order (payments.user_id = caller), then:
if (payment.status === 'captured') {
  const { data } = await admin.rpc('confirm_payment', {
    p_provider_order_id: razorpay_order_id, p_provider_payment_id: razorpay_payment_id,
    p_amount_paise: payment.amount, p_method: payment.method, p_raw: payment,
  });
  return json({ result: data === 'confirmed' || data === 'already_confirmed' ? 'confirmed' : data });
}
return json({ result: 'pending' });          // 'authorized' → auto-capture will follow; webhook confirms
```

### Order detail states
| `status` / `payment_status` | Shown to the customer |
|---|---|
| `awaiting_payment`, attempt `created` | **PayNowBanner**: "Complete payment to place your order · 12:34 left" + **Pay now** (reopens Checkout with the same Razorpay order) + "Cancel order" |
| `awaiting_payment`, attempt `failed` | "Payment failed: *{reason}*. Try again or choose Pay on delivery." + **Pay now** + **Switch to pay on delivery** |
| verify returned `pending` | "Confirming your payment…" spinner; Realtime on `orders` flips it to Placed when the webhook arrives |
| `placed` + `paid` | Normal live timeline (Phase 5) with a "Paid online · UPI" chip |
| `cancelled` (`payment_timeout`) | "Payment not completed in time. Any amount debited will be refunded automatically." |
| refunds exist | **RefundStatus** card: "Refund ₹42 · Processing · usually 5–7 working days" → "Refunded on 18 Oct" |

**Switch to pay on delivery:** a small RPC `switch_order_to_cod(order_id)` (customer, own order, `awaiting_payment` only, re-checks COD limits). It sets `payment_method = 'cod'`, `status = 'placed'`, clears `payment_expires_at`, and logs an event. Any Razorpay order left open is harmless: if it's paid later, `confirm_payment()` turns it into a `duplicate_payment` refund.

### Staff side (Phase 6 screens)
- Order card and order screen show a big badge: **✅ PAID ONLINE: don't collect cash** vs **💵 COLLECT ₹412**.
- Pick list and invoice print "Paid: UPI (Razorpay) pay_XXXX" or "Amount to collect: ₹412".
- When staff mark an item unavailable on a paid order, the confirmation says "₹42 will be refunded to the customer automatically".

**Checks (test mode):** pay with test UPI ID `success@razorpay` → order Placed within seconds. `failure@razorpay` → failed state with retry. Close Checkout → banner with countdown. Kill the app during payment, reopen → order screen shows the right state.

---

## 10.5 Webhook verification

**Goal:** Razorpay's server-to-server notifications are the **source of truth**. They confirm payments even when the phone died mid-payment, and they report refund results. Every call is signature-checked and processed **exactly once**.

**Files**
```
supabase/functions/razorpay-webhook/index.ts
```

```ts
// razorpay-webhook/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { hmacHex, safeEqual } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  const raw = await req.text();                                   // RAW body: verify before parsing
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const expected = await hmacHex(Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!, raw);
  if (!safeEqual(expected, signature)) return new Response('bad signature', { status: 400 });

  const eventId = req.headers.get('x-razorpay-event-id') ?? crypto.randomUUID();
  const body = JSON.parse(raw);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Idempotency: first writer wins; a duplicate delivery returns 200 and does nothing
  const { error: dup } = await admin.from('payment_webhook_events')
    .insert({ event_id: eventId, event: body.event, payload: body });
  if (dup?.code === '23505') return new Response('duplicate', { status: 200 });

  try {
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid': {
        const p = body.payload.payment.entity;
        await admin.rpc('confirm_payment', {
          p_provider_order_id: p.order_id, p_provider_payment_id: p.id,
          p_amount_paise: p.amount, p_method: p.method, p_raw: p,
        });
        break;
      }
      case 'payment.failed': {
        const p = body.payload.payment.entity;
        await admin.rpc('fail_payment', {
          p_provider_order_id: p.order_id, p_code: p.error_code,
          p_description: p.error_description, p_raw: p,
        });
        break;
      }
      case 'refund.processed':
      case 'refund.failed': {
        const r = body.payload.refund.entity;
        await admin.rpc('mark_refund_result', {
          p_provider_refund_id: r.id,
          p_status: body.event === 'refund.processed' ? 'processed' : 'failed',
          p_error: r.error_description ?? null,
        });
        break;
      }
    }
    await admin.from('payment_webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId);
    return new Response('ok', { status: 200 });
  } catch (e) {
    await admin.from('payment_webhook_events').update({ error: String(e) }).eq('event_id', eventId);
    // delete the event row so Razorpay's retry can process it again
    await admin.from('payment_webhook_events').delete().eq('event_id', eventId);
    return new Response('retry', { status: 500 });
  }
});
```
Deploy **without** Supabase JWT verification (Razorpay can't send a Supabase JWT; the HMAC is the authentication):
```bash
supabase functions deploy razorpay-webhook --no-verify-jwt
```

**Rules**
- Verify the signature on the **raw** body string. Parsing and re-serializing JSON changes bytes and breaks the HMAC.
- Respond quickly with 2xx. Razorpay retries failed deliveries for a while and may disable a webhook that keeps failing, so watch Dashboard → Webhooks.
- Both `payment.captured` and `order.paid` can arrive for the same payment, plus `verify-payment` may have confirmed it already. `confirm_payment()` returns `already_confirmed` for all but the first.
- Events can arrive **out of order** (e.g. `payment.failed` for one attempt after `payment.captured` for a retry). `fail_payment()` only touches the attempt row, never a paid order.

**Local testing:** `supabase functions serve` + a free tunnel (`cloudflared tunnel --url http://localhost:54321`) → set the tunnel URL as a **test-mode** webhook in Razorpay → pay with test credentials → watch `payment_webhook_events`.

**Tests:** wrong signature → 400 and nothing written. Same event id twice → second is a no-op. `payment.captured` before `verify-payment` → order confirmed once.

---

## 10.6 Refunds on cancel / item unavailable

**Goal:** money goes back automatically and visibly whenever a paid order is cancelled or shrinks, with retries when Razorpay is slow or fails.

**Files**
```
supabase/functions/process-refunds/index.ts
supabase/migrations/1001_payments.sql          # (part) cron + pg_net call, mark_refund_result
mobile/src/features/payments/RefundStatus.tsx
mobile/app/admin/payments/index.tsx            # (10.7) includes a refunds tab
```

### Trigger the processor (pg_cron + pg_net, both available on Supabase)
```sql
create extension if not exists pg_net with schema extensions;

-- store the function URL and secret in Vault (Dashboard → Vault) as 'process_refunds_url' and 'internal_cron_secret'
select cron.schedule('process-refunds', '*/2 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'process_refunds_url'),
    headers := jsonb_build_object('x-internal-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret')),
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.refunds where status in ('pending', 'failed') and attempts < 5)
$$);
```

### `process-refunds/index.ts`
```ts
// deployed --no-verify-jwt; authenticated by the shared secret header
if (req.headers.get('x-internal-secret') !== Deno.env.get('INTERNAL_CRON_SECRET')) return new Response('no', { status: 401 });

const { data: due } = await admin.from('refunds')
  .select('id, amount, attempts, payments!inner(provider_payment_id)')
  .in('status', ['pending', 'failed']).lt('attempts', 5).order('created_at').limit(20);

for (const r of due ?? []) {
  // claim it (prevents two runs refunding the same row)
  const { data: claimed } = await admin.from('refunds')
    .update({ status: 'processing', attempts: r.attempts + 1 })
    .eq('id', r.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
  if (!claimed) continue;

  try {
    const res = await rzp<{ id: string; status: string }>(`/payments/${r.payments.provider_payment_id}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Math.round(Number(r.amount) * 100),   // paise; partial refunds allowed
        speed: 'normal',                               // 'optimum' = instant where possible, extra fee ⚠️
        receipt: r.id,                                 // our refund id, for matching later
        notes: { refund_id: r.id },
      }),
    });
    await admin.from('refunds').update({ provider_refund_id: res.id }).eq('id', r.id);
    if (res.status === 'processed') {
      await admin.rpc('mark_refund_result', { p_provider_refund_id: res.id, p_status: 'processed', p_error: null });
    }
    // otherwise stays 'processing' until the refund.processed / refund.failed webhook
  } catch (e) {
    await admin.from('refunds').update({ status: 'failed', last_error: String(e) }).eq('id', r.id);
  }
}
```
- **Timeouts:** if the call times out, the refund may have been created at Razorpay anyway. Before retrying a `failed` row that has no `provider_refund_id`, list the payment's refunds (`GET /v1/payments/:id/refunds`) and look for one whose `receipt` equals our refund id. Only call refund again if none exists.
- After 5 failed attempts the refund shows up in Admin → Payments → **Needs attention**, with a manual "Retry" and "Mark refunded manually (cash/UPI)" action (`admin_resolve_refund(refund_id, note)`).
- Razorpay rejects a refund larger than what's left on the payment, which acts as a second guard against double refunds.

### Customer view
The `RefundStatus` card on order detail subscribes to `refunds` via the existing order channel (Realtime on `refunds` filtered by `order_id`):
- **Processing** (pending/processing): "Refund of ₹42 started on 16 Oct. Usually 5–7 working days. Ref: rfnd_…"
- **Refunded**: "₹42 refunded on 18 Oct to your UPI account."
- **Delayed** (failed, retrying): "Your refund is taking longer than usual. We're on it." plus Call store.

The invoice (Phase 5.5) shows a credit line for refunded items.

### Tests (`70_payments.test.sql`)
- `place_order(…,'upi')` → status `awaiting_payment`, stock decremented, `payment_expires_at` set. Staff board query excludes it.
- `confirm_payment` with the right amount → `placed`/`paid`, `placed_at` reset, one status event. Called again → `already_confirmed`, nothing changes.
- Wrong amount → `amount_mismatch`, order still `awaiting_payment`, a mismatch row.
- Hold expired: `release_expired_payment_holds()` cancels and **restocks**. A later `confirm_payment` → `refund_late` with a full refund row.
- Second captured payment on a paid order → `refund_duplicate`.
- Paid order cancelled → one refund for the full amount. Cancel event fired twice → still one refund.
- Item unavailable on a paid ₹412 order (line ₹42) → refund ₹42. Then the last item unavailable → order cancelled → refund of the remaining ₹370 (total refunds = ₹412).
- `mark_refund_result(processed)` updates `amount_refunded` and `payment_status` (`partially_refunded`, then `refunded`).
- Customers can't execute `confirm_payment`, `fail_payment`, `mark_refund_result` or `release_expired_payment_holds` (`42501`), and can't read others' `payments`/`refunds`.

---

## 10.7 Reconciliation report

**Goal:** every rupee Razorpay says it took is matched to an order in our database, and the owner can see online money in, refunds out and what's due in settlements.

**Files**
```
supabase/functions/reconcile-payments/index.ts
supabase/migrations/1001_payments.sql      # (part) report views, cron
mobile/app/admin/payments/index.tsx        # tabs: Today · Refunds · Needs attention · Settlements
```

### Daily job
```sql
select cron.schedule('reconcile-payments', '30 0 * * *', $$      -- 06:00 IST
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_payments_url'),
    headers := jsonb_build_object('x-internal-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret')),
    body    := '{}'::jsonb)
$$);
```
`reconcile-payments` (same shared-secret auth):
1. Fetch yesterday's payments from Razorpay: `GET /v1/payments?from=<unix>&to=<unix>&count=100&skip=<n>` (page until empty).
2. For each **captured** Razorpay payment:
   - not in `payments.provider_payment_id` → if its `order_id` matches one of our `provider_order_id`s, call `confirm_payment()` (a lost webhook; this heals it, possibly into a late/duplicate refund). Otherwise insert `payment_mismatches(kind='captured_without_order')`.
   - amount differs from ours → `amount_differs`.
3. For each of our `captured` payments not found at Razorpay → `status_differs`.
4. Refunds in `processing` for more than 2 days → fetch `GET /v1/refunds/:id` and update via `mark_refund_result()`.
5. Optional: `GET /v1/settlements?from=&to=` to record what was settled to the bank, so the owner can match bank credits.
6. If any new mismatch rows were created, notify admins (in-app + push) and the Telegram alert from Phase 9.4.

### Report views (admin only, read through `admin_report(name)` as in Phase 9.6)
```sql
create or replace view public.v_payments_daily with (security_invoker = true) as
select
  (p.created_at at time zone 'Asia/Kolkata')::date                as day,
  count(*) filter (where p.status = 'captured')                     as payments_captured,
  coalesce(sum(p.amount) filter (where p.status = 'captured'), 0)   as amount_captured,
  count(*) filter (where p.status = 'failed')                       as payments_failed,
  (select coalesce(sum(r.amount), 0) from public.refunds r
    where r.status = 'processed'
      and (r.updated_at at time zone 'Asia/Kolkata')::date = (p.created_at at time zone 'Asia/Kolkata')::date) as amount_refunded
from public.payments p
group by 1;
revoke all on public.v_payments_daily from anon, authenticated;
```
Plus the existing `v_sales_daily` (Phase 7) gains a split: **COD collected** vs **online captured** vs **refunded**, so the closing checklist ("cash collected = delivered COD orders", Phase 9 runbook) stays correct.

### Admin → Payments screen
| Tab | Shows |
|---|---|
| **Today** | Online captured ₹, failed attempts (top reasons from `error_description`), conversion (UPI orders placed vs paid), COD vs online share |
| **Refunds** | All refunds with status, order number, reason; filter "processing > 2 days" |
| **Needs attention** | `payment_mismatches` unresolved + refunds failed 5 times, each with actions (open order, retry, mark resolved with a note) |
| **Settlements** | Last 14 days from the reconcile job (amount, date, UTR) to match with the bank statement |

**Monthly (owner):** download Razorpay's settlement report from the dashboard and compare its total with `v_payments_daily` − refunds − fees. Give both to the CA for GST filing; Razorpay's fee invoice carries GST you may be able to claim as input credit (ask the CA).

---

## Testing for Phase 10

| Layer | What |
|---|---|
| pgTAP | The 10.6 list: hold, confirm, idempotency, late/duplicate refunds, refund maths, permissions |
| Edge Functions | Deno tests for `hmacHex`/`safeEqual` with Razorpay's documented signature format, webhook duplicate handling, `create-payment` ownership and reuse |
| RNTL | `PaymentMethodPicker` (disabled COD with reason), `PayNowBanner` countdown, `RefundStatus` states |
| Maestro (test mode) | `checkout-upi.yaml`: cart → UPI → Razorpay test UPI `success@razorpay` → order Placed. `checkout-upi-fail.yaml`: `failure@razorpay` → retry → switch to pay on delivery. Two-device: staff cancels a paid order → customer sees refund "Processing". |
| Manual (test mode) | Close Checkout mid-way; kill the app during payment; let the hold expire then pay (late payment → auto refund); airplane mode right after paying (webhook still confirms) |
| Live smoke test | After activation: one real ₹1–10 order paid with a real UPI app, then cancelled → refund arrives. Do this before announcing online payments. |

## Phase 10 wrap-up

| Area | Delivered |
|---|---|
| SQL | `1000_payments_enums.sql` (`awaiting_payment`, `partially_refunded`, `payment_attempt_status`, `refund_status`), `1001_payments.sql` (`payments`, `refunds`, `payment_webhook_events`, `payment_mismatches`, store/order columns, RLS, `place_order` + `get_cart_quote` + `cancel_order` updates, `confirm_payment`, `fail_payment`, `mark_refund_result`, `switch_order_to_cod`, `release_expired_payment_holds` cron, `queue_refund_if_needed` trigger, refund/reconcile crons, `v_payments_daily`) |
| Edge Functions | `create-payment`, `verify-payment`, `razorpay-webhook`, `process-refunds`, `reconcile-payments` + `_shared/razorpay.ts` |
| App | Payment method picker, Razorpay Checkout, pay-now/failed/pending states, switch to pay on delivery, refund status, staff "PAID ONLINE" badges, admin Payments screen |
| Ops | Test → live key switch without a release, webhook monitoring, daily reconciliation, monthly settlement check |

**Next:** release v1.1 with a staged rollout (Phase 9.10 process), then pick from the [Later list](00_PHASES_OVERVIEW.md#later-not-planned-in-detail-yet). Riders and live delivery tracking are the natural next step, now that paid orders make "Out for delivery" matter even more.
