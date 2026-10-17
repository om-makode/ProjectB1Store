# Phase 9: Hardening & Release

> **Goal:** turn a feature-complete app into one that is **fast on cheap phones, usable by everyone, safe with money and stock, monitored, backed up, legally ready to sell online, and published** on the Play Store, then rolled out carefully, with a store team that knows what to do on day one.
> **Duration:** about 1 week (plus the Play closed-testing period) · **Depends on:** all previous phases (0–8) · **Next:** v1.0 in production, then [Phase 10: Online Payments](PHASE_10.md)

**Done when:**
- [ ] Browsing screens (Home, categories, product detail, cart, orders) open **offline** from cache. Checkout clearly says it needs internet.
- [ ] Cold start **< 3 s**, smooth scrolling of product grids on a 2 GB RAM Android phone, first Home load **< 300 KB** of data, download size **< 35 MB** per device
- [ ] Accessibility audit passed: TalkBack journeys in Marathi and English, 200% font scale, contrast, no unlabeled controls
- [ ] App crashes and Edge Function errors reach Sentry with readable stack traces. Supabase usage and uptime alerts reach your phone.
- [ ] **pgTAP RLS isolation tests** prove no customer can read another's data, change a price or insert an order directly. All test layers pass in CI. The two-device Maestro order flow passes on a release build.
- [ ] Supabase **Security Advisor and Performance Advisor show zero errors**. `0900_hardening.sql` applied (rate limits, indexes, timeouts).
- [ ] The free project can't silently pause, and a **nightly encrypted backup** of the database **and** Storage exists off-site, with a **tested restore**
- [ ] Seller details, refund/cancellation policy, privacy policy, terms, grievance officer and account-deletion pages are live (Cloudflare Pages) in EN/MR/HI
- [ ] **Force update** and **maintenance mode** work from `app_config` without a release
- [ ] Play Store listing in English, Marathi and Hindi. Signed release rolled out internal → closed → production in stages, with crash-free users ≥ 99.5%
- [ ] Store staff trained, the launch-day runbook rehearsed with real test orders

| # | Heading | Output |
|---|---|---|
| 9.1 | Offline & cache tuning | Persist whitelist, cache size guard, offline behaviour table, data saver |
| 9.2 | Performance pass | Budgets, measurement, app + SQL fixes, new indexes |
| 9.3 | Accessibility | Automated + manual audit, checklist |
| 9.4 | Sentry & monitoring | Sentry in app + Edge Functions, Supabase logs, usage & uptime alerts |
| 9.5 | Test suite (pgTAP, RNTL, Maestro) | Gates in CI, RLS isolation tests, two-device order E2E, manual matrix |
| 9.6 | Security review (RLS, advisors, abuse limits) | `check_rate_limit()`, advisor fixes, timeouts, checklist |
| 9.7 | Free-tier limits & keep-alive | Limits table, keep-alive job, nightly backups, restore test, when to go Pro |
| 9.8 | Legal pages & seller info | E-Commerce Rules pages, policies, grievance officer, in-app seller page |
| 9.9 | Force update & maintenance mode | `app_config` keys, gate screen |
| 9.10 | Store listing & staged rollout | Play listing ×3 languages, Data Safety, signing, builds, tracks, release checklist |
| — | Launch-day runbook | Staff training, test orders, opening checklist, first-week routine |

> **Migration for this phase:** `supabase/migrations/0900_hardening.sql`. It only adds things (a rate-limit table and function, indexes, role settings) and rewrites a few RLS policies for performance. It's safe to apply to a live project.

> **Costs in this phase:** Google Play developer account **US$25 one-time**. Everything else is free. ⚠️ Supabase Pro (~US$25/month) is optional; see 9.7 for when it becomes worth it.

---

## 9.1 Offline & cache tuning

**Goal:** the app stays useful in a basement shop, on a bus, or on a weak 2G/3G connection, without filling the phone's storage. **Money and stock are never "offline":** checkout always needs a live server answer.

**Files**
```
mobile/src/lib/queryClient.ts          # persist whitelist, buster, size guard
mobile/src/lib/persister.ts            # MMKV persister wrapper (trims infinite pages)
mobile/src/ui/OfflineBanner.tsx         # from Phase 1.12, now on every tab
mobile/src/features/settings/dataSaver.ts
```

### What's persisted (whitelist, not "everything")
Phase 0.9 persisted the whole TanStack Query cache. Restrict it now:
```ts
// src/lib/queryClient.ts
const PERSIST: Array<(key: readonly unknown[]) => boolean> = [
  (k) => k[0] === 'app-config',
  (k) => k[0] === 'store-status',                       // shown as "last known" with a stale label
  (k) => k[0] === 'home',
  (k) => k[0] === 'categories',
  (k) => k[0] === 'products' && k[1] === 'list',        // first page only (persister trims pages)
  (k) => k[0] === 'products' && k[1] === 'detail',      // pruned to the 60 most recent
  (k) => k[0] === 'cart-quote',                          // shown greyed until re-quoted online
  (k) => k[0] === 'orders',                              // my orders + order detail
  (k) => k[0] === 'addresses',
  (k) => k[0] === 'wishlist',
  (k) => k[0] === 'me',
];

export const persistOptions = {
  persister,
  maxAge: 3 * 24 * 60 * 60_000,                          // 3 days: prices go stale faster than a directory
  buster: `${Application.nativeApplicationVersion}-${DB_TYPES_HASH}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSIST.some((f) => f(q.queryKey)),
  },
};
```
- `DB_TYPES_HASH` is a hash of `src/types/database.ts` (generated by `supabase gen types`), injected at build time through `app.config.ts` `extra`. A schema change clears stale caches automatically.
- **Infinite lists:** the persister wrapper trims `pages`/`pageParams` to the first page before writing.
- **Size guard:** if the serialized cache is above **5 MB**, drop the oldest `products/detail` entries first, then list pages.
- **Never persisted:** `search` results, staff `store-orders` board, admin queries, anything from Store mode. Staff must always see live data.

### Stale prices are labelled, never trusted
- A cached cart quote opened offline is shown **greyed** with "Prices may have changed. Connect to see the latest." The **Place order** button is disabled until `get_cart_quote()` answers online (Phase 4.3).
- A cached store status shows "Last checked 2 h ago" instead of "Open now".

### Offline behaviour per screen (audit and fix any ✗ that isn't intentional)
| Screen | Offline behaviour |
|---|---|
| Home, Categories, Category grid | ✓ cached, offline banner, "Load more needs internet" footer |
| Product detail | ✓ if visited before, stock shown as "last known". Otherwise "Not saved for offline" + Retry. |
| ADD / stepper | ✓ guest cart edits are local (MMKV). Logged-in cart edits are queued and replayed (`mutationKey: ['cart']`, paused mutations persisted). |
| Cart | ✓ shows items, totals greyed, Place order disabled |
| Checkout / Place order | ✗ on purpose: "You're offline. Your cart is saved." |
| Orders tab / order detail | ✓ cached, "Live updates paused" chip until reconnect, then refetch |
| Search | Recent searches + category shortcuts + "Search needs internet" |
| Report an issue | Form and photos kept as a draft. Submit waits for internet (no silent queue). |
| Store mode | Big red **"Offline: new orders won't arrive"** banner + alarm sound (staff must notice) |
| Login | "Login needs internet" |

### Data saver
Settings → **Save mobile data** (auto-on when `NetInfo` reports `2g`/`3g` or `isConnectionExpensive`): thumbs only on product detail until tapped, no prefetch of the next grid page, Home rails below the fold load on scroll.

**Checks:** airplane mode → cold start → Home, a visited product, cart and orders all render. Place order is disabled with a clear message.

**Tests:** persisted keys match the whitelist. Pages trimmed. Buster change clears the cache. A logged-in cart edit made in airplane mode is sent after restart + reconnect (mocked NetInfo). Store-mode queries are never persisted.

---

## 9.2 Performance pass

**Goal:** most customers have a budget Android phone and a cheap data plan. Measure on one, fix what matters, keep it fast.

### Budgets (fail the release if exceeded)
| Metric | Budget | Measured on |
|---|---|---|
| Cold start → Home content visible | **< 3 s** (cached: < 1.5 s) | 2 GB RAM Android (Redmi A-series class), release build |
| Category grid scroll | **≥ 55 FPS** average, no frame > 100 ms | 200-product sub-category |
| ADD → stepper visible | **< 100 ms** (optimistic) | any |
| `get_home` / `list_products` / `search_products` | **p95 < 150 ms** DB time | `EXPLAIN ANALYZE` with 5,000 products |
| `place_order` | **p95 < 300 ms** DB time with 20 lines | same |
| First Home load (cold cache) | **< 300 KB** transferred | Chrome DevTools / Flipper network |
| JS bundle | **< 4 MB** | `npx expo export` |
| Download size per device | **< 35 MB** | Play Console (AAB split by ABI/density) |
| Memory after 5 min browsing | **< 250 MB** | Android Studio profiler |
| Web admin first load | **< 1.5 MB** JS, Lighthouse perf ≥ 80 | Cloudflare Pages build |

### Measure (all free)
- **Flashlight** (open-source Android perf scoring) over a Maestro flow: `flashlight test --bundleId in.nearkart.app --testCommand "maestro test .maestro/browse.yaml"`.
- **Expo Atlas** for bundle composition: `EXPO_UNSTABLE_ATLAS=true npx expo export` → `npx expo-atlas`.
- **React DevTools Profiler** for re-renders of `ProductCard`/`AddButton`.
- **Supabase Dashboard → Database → Query Performance** (backed by `pg_stat_statements`, on by default) for the slowest and most-called queries. **Performance Advisor** for missing FK indexes and slow RLS patterns.
- Seed a realistic volume locally: `supabase/seed_perf.sql` generates 5,000 products × 2 variants, 20,000 orders, 200 users.

### App fixes checklist
- [ ] Release build with Hermes and R8:
  ```ts
  ['expo-build-properties', { android: { enableProguardInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true } }]
  ```
- [ ] `ProductCard` memoized. `AddButton` subscribes to **its own** cart line (`useCartLine(variantId)` selector), so one tap doesn't re-render the whole grid.
- [ ] FlashList `getItemType` for mixed Home sections. `estimatedItemSize` set. No inline style objects in hot lists.
- [ ] Realtime: the inventory channel updates **only the affected query entries** (`setQueryData` on matching variant ids) instead of invalidating the whole grid. Channels close on screen blur (Phase 1.10).
- [ ] Images: lists use `thumb_path` only, `expo-image` `recyclingKey`, `cachePolicy="memory-disk"`, a placeholder colour or blurhash.
- [ ] Below-the-fold Home rails are deferred (`InteractionManager.runAfterInteractions`).
- [ ] Store mode, admin, barcode scanner, printing and charts are **lazy-imported** inside their routes, so customers never evaluate that code at startup.
- [ ] Splash hides when fonts + cached Home are ready (no layout jump).

### SQL fixes (go into `0900_hardening.sql`)
Confirm each with `EXPLAIN (ANALYZE, BUFFERS)` before adding. Typical results for this schema:
```sql
-- 0900_hardening.sql (part 1: indexes)
create index if not exists orders_user_placed_idx      on public.orders (user_id, placed_at desc);
create index if not exists orders_store_status_idx     on public.orders (store_id, status, placed_at desc);
create index if not exists order_items_order_idx       on public.order_items (order_id);
create index if not exists order_events_order_idx      on public.order_status_events (order_id, created_at);
create index if not exists inv_moves_variant_idx       on public.inventory_movements (variant_id, created_at desc);
create index if not exists notifications_unread_idx    on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists products_category_active_idx on public.products (category_id, sort_order) where is_active;
create index if not exists variants_product_idx        on public.product_variants (product_id) where is_active;
create index if not exists search_queries_zero_idx     on public.search_queries (created_at desc) where results_count = 0;
create index if not exists addresses_user_idx          on public.addresses (user_id) where deleted_at is null;
-- products.search_text trigram index exists since 0200_search.sql; verify it's used:
--   explain analyze select * from public.search_products('doodh', 'mr', '{}'::jsonb, 0);
```

**RLS performance fix (Performance Advisor: `auth_rls_initplan`).** Policies that call `auth.uid()` directly re-evaluate it **per row**. Wrap it in a sub-select so Postgres evaluates it once:
```sql
-- example: rewrite every user-owned policy like this
drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
```
Do this for `addresses`, `cart_items`, `orders`, `order_items`, `notifications`, `push_tokens`, `order_issues`, `wishlist`, `reviews`, `stock_alerts`.

**Checks:** all budgets met on the 2 GB phone. Query Performance shows no query > 200 ms mean among the top 20.

---

## 9.3 Accessibility

**Goal:** usable by older customers, low-vision users and screen-reader users in all three languages, and by staff in a hurry.

### Automated
- **`eslint-plugin-react-native-a11y`** recommended rules in `eslint.config.js`.
- **Android Accessibility Scanner** (free, Google) on every main screen: touch targets, contrast, labels.
- **Lighthouse** accessibility ≥ 95 for the web admin and the legal/product web pages.

### Manual journeys (each with TalkBack **and** in Marathi)
1. First launch → language → location → Home → category → sub-category → ADD a product → stepper to 2.
2. Search "दूध" → open a product → change variant → Notify me (out of stock).
3. Cart → bill details read as sentences ("Delivery fee, 20 rupees. Free above 199 rupees.") → login → address → **Place order**.
4. Orders → live order detail: each status change is **announced** ("Your order is packed").
5. Store mode: new-order alarm → open → tick items → Mark packed.

### Checklist
- [ ] Every interactive element has a role + **localized** label. The stepper reads "Amul Taaza 500 ml, quantity 2, increase / decrease".
- [ ] Prices are read correctly: `PriceTag` sets `accessibilityLabel` to "₹42, MRP ₹45, 7% off", not "42 45 7%".
- [ ] Touch targets ≥ **48×48 dp** (the ADD button and stepper too).
- [ ] **Font scale 200%**: product cards grow, the floating cart bar wraps, bill rows don't clip.
- [ ] Contrast ≥ 4.5:1 in both themes, including category colours, discount badges and the struck-through MRP.
- [ ] Veg/non-veg is not colour-only: the mark has a label ("Vegetarian").
- [ ] Stock states use icon + text ("Only 3 left", "Out of stock"), never colour alone.
- [ ] Toasts, errors and live order updates are announced (`AccessibilityInfo.announceForAccessibility`).
- [ ] Bottom sheets (filters, variant picker, address picker) trap focus and return it on close.
- [ ] **Reduce motion** turns off the order-placed animation and skeleton shimmer.
- [ ] Marathi/Hindi Google TTS voices installed on the test phone, labels read in the app language.
- [ ] **Two real customers aged 55+** place an order without help. Note every hesitation and fix the top 3.

---

## 9.4 Sentry & monitoring

**Goal:** know about problems (crashes, failing orders, the store tablet going offline, the project hitting a free-tier limit) before customers complain.

**Files**
```
mobile/app/_layout.tsx                    # Sentry.wrap + root ErrorBoundary
mobile/src/lib/logger.ts                  # logger.error → Sentry in release builds
supabase/functions/_shared/sentry.ts      # tiny wrapper for Edge Functions
.github/workflows/keepalive-and-health.yml  # (9.7) also runs the health checks below
```

### App: Sentry (free Developer plan)
```bash
npx expo install @sentry/react-native
```
- Add the `@sentry/react-native` Expo config plugin, wrap the root layout with `Sentry.wrap`, rebuild.
- Free plan: about **5,000 errors/month**, 1 user, short retention. Stay inside it: errors at `sampleRate: 1.0`, **tracing off** (`tracesSampleRate: 0`), ignore expected errors (offline, cancelled sign-in, `rate_limited`, `out_of_stock` from `place_order`).
- `Sentry.setUser({ id: profile.id })` after login. **Never** send name, email, phone or address (`sendDefaultPii: false`). Tags: `appEnv`, `language`, `role`, `storeMode`.
- **Breadcrumbs** for route changes and for every RPC call name + result code (not payloads), so an order failure shows "get_cart_quote ok → place_order error min_order_not_met".
- **Root error boundary** (Expo Router `ErrorBoundary` export): "Something went wrong. [Try again] [Go home]" + a short error code (the Sentry event id, first 6 chars) that staff can ask for on WhatsApp.
- Source maps uploaded during the release build (`SENTRY_AUTH_TOKEN` env, never in git).

### Edge Functions
`send-push` (Phase 5) and later the payment functions report caught errors to the same Sentry project with the Deno SDK (`npm:@sentry/deno`), tagged `fn=<name>`. Keep it to errors only to save quota.

### Supabase's own monitoring (free)
- **Logs Explorer** (API, Postgres, Auth, Realtime, Edge Functions). Free-tier retention is short (about 1 day), so investigate the same day and copy what matters into an issue.
- **Reports** page: API requests, DB CPU/RAM, Realtime connections, Storage egress.
- **Usage** page (Organization → Usage): DB size, egress, MAU, Realtime peak connections, Edge invocations. Set a calendar reminder to check it weekly (9.7 has the thresholds).

### Business health signals (SQL, checked by a scheduled job)
Technical uptime isn't enough. The store can be "up" while orders silently fail. Add a health view and alert on it:
```sql
-- 0900_hardening.sql (part 2: health)
create or replace view public.v_ops_health with (security_invoker = true) as
select
  (select count(*) from public.orders where status = 'placed'
     and placed_at < now() - interval '5 minutes')                         as unaccepted_over_5m,
  (select count(*) from public.orders where status = 'cancelled' and cancelled_by = 'system'
     and cancelled_at > now() - interval '1 hour')                         as auto_cancelled_last_hour,
  (select max(updated_at) from public.push_tokens p
     join public.profiles pr on pr.id = p.user_id and pr.role in ('staff','admin')) as last_staff_token_seen,
  (select count(*) from public.inventory where stock = 0 and is_available) as out_of_stock_variants;
revoke all on public.v_ops_health from anon, authenticated;
```
The GitHub Actions job in 9.7 reads this every 15 minutes during opening hours (with the service key stored as a **GitHub secret**, never in the app) and sends a **Telegram** message (free bot) if `unaccepted_over_5m > 0` or `auto_cancelled_last_hour >= 2`. That catches "tablet battery died" before customers notice.

### Uptime (free)
- **UptimeRobot** free: monitor `https://<project-ref>.supabase.co/rest/v1/app_config?select=key&limit=1` with the `apikey` header (anon key), plus the Cloudflare Pages site. Alerts to email + Telegram.
- Weekly: Sentry crash-free users, Play Console **ANR rate** (keep < 0.47%) and **crash rate** (< 1.09%), Google's bad-behaviour thresholds.

---

## 9.5 Test suite (pgTAP, RNTL, Maestro)

**Goal:** confidence to release often. Collect everything written in Phases 0–8, add the missing **security** tests, and gate releases on them.

### Layers & gates
| Layer | Tool | Gate in CI |
|---|---|---|
| Lint, types, format | ESLint (+a11y), `tsc --noEmit`, Prettier | must pass |
| Types in sync | `supabase gen types typescript --local > /tmp/db.ts && diff -q /tmp/db.ts src/types/database.ts` | must pass |
| SQL lint | `supabase db lint --level warning` | must pass |
| SQL & RLS | **pgTAP** via `supabase test db` | must pass |
| Unit | Jest | **≥ 80% coverage** on `src/lib`, `src/i18n`, `features/attributes`, `features/cart` (merge, quote mapping), `features/search` (filter builders) |
| Component | React Native Testing Library | ProductCard states, AddButton/stepper, BillDetails, StatusTimeline, AddressForm, store OrderCard |
| i18n | key-parity test EN/MR/HI | must pass |
| E2E | Maestro | **before every release**, on a release build |
| Performance | Flashlight on `browse.yaml` | before every release |

CI (`.github/workflows/ci.yml`) starts a local Supabase with Docker (`supabase start`), applies all migrations + `seed.sql`, runs `supabase test db`, then the JS checks. All free on GitHub Actions.

### pgTAP: RLS isolation tests (concrete examples)
```
supabase/tests/
  00_helpers.sql             # create test users, switch "who am I"
  10_rls_catalog.test.sql
  20_rls_customer_data.test.sql
  30_place_order.test.sql    # from Phase 4, extended
  40_staff.test.sql          # from Phase 6
  50_storage_policies.test.sql
  60_rate_limits.test.sql
```
Helpers (plain SQL, no extra extension needed):
```sql
-- supabase/tests/00_helpers.sql (included by each test with \ir)
create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create or replace function tests.as_postgres() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- users: insert into auth.users, profiles are created by handle_new_user()
create or replace function tests.make_user(p_email text, p_role public.app_role default 'customer')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, p_email, '{}'::jsonb, 'authenticated', 'authenticated');
  update public.profiles set role = p_role where id = v;
  return v;
end $$;
```
```sql
-- supabase/tests/20_rls_customer_data.test.sql
begin;
create schema if not exists tests;
\ir 00_helpers.sql
select plan(9);

-- arrange (as postgres): two customers, one order for Asha
select tests.make_user('asha@test.in')  as asha \gset
select tests.make_user('ravi@test.in')  as ravi \gset
-- (insert an address + an order for :'asha' via place_order, as in 30_place_order)
select tests.as_user(:'asha');
select public.place_order(
  (select id from public.addresses where user_id = :'asha' limit 1), 'cod', null, gen_random_uuid()
) ;

-- Ravi can't see Asha's order, items, address or notifications
select tests.as_user(:'ravi');
select is((select count(*) from public.orders),        0::bigint, 'ravi sees no orders of asha');
select is((select count(*) from public.order_items),   0::bigint, 'ravi sees no order items of asha');
select is((select count(*) from public.addresses),     0::bigint, 'ravi sees no addresses of asha');
select is((select count(*) from public.notifications), 0::bigint, 'ravi sees no notifications of asha');

-- Asha can't write money/stock tables directly
select tests.as_user(:'asha');
select throws_ok($$ insert into public.orders (user_id, store_id, status) values (auth.uid(), 1, 'placed') $$,
  '42501', null, 'customer cannot insert an order directly');
select throws_ok($$ update public.product_variants set price = 1 where id = 1 $$,
  null, null, 'customer cannot change a price');   -- 0 rows or 42501, assert below
select is((select price from public.product_variants where id = 1) <> 1, true, 'price unchanged');
select throws_ok($$ update public.profiles set role = 'admin' where id = auth.uid() $$,
  null, null, 'customer cannot promote self');

-- Guest sees catalog but no customer data
select tests.as_anon();
select is((select count(*) from public.orders), 0::bigint, 'anon sees no orders');

select * from finish();
rollback;
```
> RLS usually **hides** rows instead of raising errors on `update`/`delete` (they affect 0 rows). Assert the outcome (value unchanged) as above, not only `throws_ok`.

Also test in `30_place_order.test.sql` (extend Phase 4): stock race (two sessions can't be simulated in one pgTAP transaction, so test the lock logic by setting stock to 1, ordering 1, then a second `place_order` must fail with `out_of_stock`), **idempotency** (same key → same order id), min order, closed store, max COD value, blocked user, `max_per_order`, address outside service area, and **rate limit** (6th order in 10 minutes → `rate_limited`).

`50_storage_policies.test.sql`: a customer can insert into `storage.objects` for bucket `issues` only under `<own uid>/…`, can't read another user's issue photos, and can't write to `catalog`.

### RNTL
Collect component tests from earlier phases. Add: `OfflineBanner` in Store mode, `ForceUpdateGate` (9.9), cart quote greyed-out state (9.1).

### Maestro flows
```
.maestro/
  browse.yaml                    # Phase 1–2: language → Home → category → product → ADD
  search.yaml                    # Phase 2: "doodh" → result
  login-address.yaml             # Phase 3
  checkout-cod.yaml              # Phase 4: cart → address → place order → success
  order-live.yaml                # Phase 5: order detail, waits for "Confirmed"
  store-accept.yaml              # Phase 6: Store mode → accept → packed → delivered
  admin-new-category.yaml        # Phase 7
  offline.yaml                   # Phase 9.1
  flows/                         # shared login helpers (test accounts with email OTP from a local Inbucket/Mailpit)
```
**Two-device order flow (the most important test):** run `checkout-cod.yaml` + `order-live.yaml` on emulator A (customer) and `store-accept.yaml` on emulator B (staff tablet profile) **at the same time** against the staging Supabase project:
```bash
maestro --device emulator-5554 test .maestro/checkout-cod.yaml .maestro/order-live.yaml &
maestro --device emulator-5556 test .maestro/store-accept.yaml
wait
```
`order-live.yaml` asserts with `extendedWaitUntil` that "Confirmed", "Packed" and "Delivered" appear on device A within 10 s of device B tapping. That proves Realtime end to end.

Locally, email OTP for test accounts is read from the Supabase local stack's mail catcher (`http://localhost:54324`). On staging, use dedicated test accounts.

### Manual release matrix (≈ 45 minutes, checklist in the release PR)
| | EN | मराठी | हिंदी |
|---|---|---|---|
| Light / normal text | journeys 1–5 (9.3) | 1–3 | 1–3 |
| Dark / large text | 1, 3 | 1 | 1 |
| Offline | 9.1 table | | |
| 2 GB phone | 1, 3, 5 | | |
| Real thermal/A4 print | invoice + pick list | | |

---

## 9.6 Security review (RLS, advisors, abuse limits)

**Goal:** close the gaps that matter for an app holding addresses and phone numbers and taking orders, and stop abuse (fake COD orders, spam, scraping) cheaply.

### Generic rate limiter
A small table-based limiter in Postgres, usable from any RPC. It's not a replacement for Supabase's built-in Auth rate limits; it covers **our** RPCs.
```sql
-- 0900_hardening.sql (part 3: rate limits)
create table if not exists public.rate_limits (
  key          text        not null,          -- e.g. 'place_order:<uid>' or 'search:<ip>'
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;  -- no policies: only security definer code touches it
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
    -- PostgREST turns SQLSTATE 'PTxxx' into HTTP status xxx, so the app gets a real 429
    raise exception 'rate_limited' using errcode = 'PT429',
      hint = format('Try again after %s', v_start + p_window);
  end if;
end $$;
revoke execute on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;

-- client IP for guest limits (PostgREST exposes request headers to SQL)
create or replace function public.request_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1),
    'unknown')
$$;

-- cleanup hourly (pg_cron from Phase 6)
select cron.schedule('rate-limits-cleanup', '7 * * * *',
  $$ delete from public.rate_limits where window_start < now() - interval '1 day' $$);
```
> Check in the API logs which header carries the client IP on your project before relying on `request_ip()`. Treat it as best-effort for guests. Logged-in limits by `auth.uid()` are the reliable ones.

**Apply it** (edit the RPCs in the same migration with `create or replace`):

| RPC / action | Limit | Key |
|---|---|---|
| `place_order` | 5 / 10 min (replaces the inline check from Phase 4) and 20 / day | `place_order:<uid>` |
| `cancel_order` (customer) | 10 / day | `cancel:<uid>` |
| `search_products` (guest) | 60 / min | `search:<ip>` |
| `search_products` (logged in) | 120 / min | `search:<uid>` |
| `search_queries` logging | log at most 30 / hour per key (skip insert after that) | same key |
| `order_issues` insert (via RPC) | 5 / day | `issue:<uid>` |
| `stock_alerts` insert | 50 / day | `alert:<uid>` |
| reviews upsert | 20 / day | `review:<uid>` |
| `merge_guest_cart` | 20 / hour | `merge:<uid>` |

The app maps HTTP 429 / `rate_limited` to a friendly localized message ("Too many tries. Please wait a few minutes.").

### Statement timeouts
Supabase already sets defaults for API roles (anon about 3 s, authenticated about 8 s). Confirm and set explicitly so a bad query can't pile up connections on the small free instance:
```sql
-- 0900_hardening.sql (part 4: timeouts)
alter role anon          set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
-- reload PostgREST so new connections pick it up
notify pgrst, 'reload config';
```
Admin imports (`admin_import_products`) that can run longer should batch rows (Phase 7 already sends 200 rows per call).

### Advisor fixes
Run **Dashboard → Advisors → Security Advisor** and **Performance Advisor** (or `supabase db lint`). Typical findings for this schema, and the fix:

| Advisor lint | Fix |
|---|---|
| `rls_disabled_in_public` | Enable RLS. Every table in `public` must have it, including helper tables like `rate_limits`. |
| `function_search_path_mutable` | Add `set search_path = ''` to every function (and fully qualify names as `public.x`). |
| `security_definer_view` | Report views (`v_sales_daily`, `v_top_products`, `v_low_stock`, `v_zero_result_searches`, `v_ops_health`) get `with (security_invoker = true)` **and** `revoke all … from anon, authenticated`. Admin screens read them through an `admin_report(name)` RPC that checks `is_admin()`. |
| `auth_rls_initplan` | `(select auth.uid())` in policies (9.2) |
| `unindexed_foreign_keys` | Add the index (9.2 list) |
| `multiple_permissive_policies` | Merge overlapping policies per table/role/action into one with `or` |
| `extension_in_public` | Keep `pg_trgm`, `postgis` etc. in the `extensions` schema (as Phase 0 created them) |
| Auth: OTP expiry too long | Auth settings → Email OTP expiry 10 minutes |

Also check the list of functions callable by `anon`:
```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
```
Only the public read RPCs (`store_status`, `get_home`, `list_products`, `search_products`, `search_suggestions`, `related_products`, `check_serviceability`) should appear. Revoke the rest from `anon` (and from `public`, since Postgres grants execute to `public` by default).

### Security review checklist (sign off in the release PR)
**Database & RLS**
- [ ] `select tablename from pg_tables where schemaname='public' and not rowsecurity;` returns **no rows**
- [ ] Every policy reviewed in a table: who can select/insert/update/delete. Customers have **no** insert/update policy on `orders`, `order_items`, `inventory`, `inventory_movements`, `product_variants`, `stores`.
- [ ] All `security definer` functions check `auth.uid()` / `is_staff()` / `is_admin()` at the top and have `set search_path = ''`
- [ ] The trigger protecting `profiles.role / is_blocked / cod_allowed` (Phase 0) is covered by a pgTAP test
- [ ] Realtime: only the tables listed in plan Section 5 are in the `supabase_realtime` publication, and each has RLS (Realtime `postgres_changes` respects RLS)

**Keys & secrets**
- [ ] Only `EXPO_PUBLIC_SUPABASE_URL` and the **anon** key are in the app. `grep -r "service_role\|sb_secret" mobile/` returns nothing. The release bundle is grepped too.
- [ ] `service_role` key only in Edge Function secrets (`supabase secrets set`) and GitHub Actions secrets
- [ ] Database password rotated after any team member leaves. Dashboard accounts use 2FA.

**Storage**
- [ ] `catalog`: public read, write `is_admin()` only. `avatars`: write own folder. `issues`: private, own folder + staff read, served by signed URLs (short expiry).
- [ ] Bucket file-size limits (e.g. 2 MB) and allowed MIME types (`image/webp`, `image/jpeg`, `image/png`) set on each bucket

**Auth**
- [ ] Email confirmations on. OTP expiry 10 min. Auth rate limits reviewed (Dashboard → Authentication → Rate Limits).
- [ ] Google provider: only your client IDs. Redirect URLs list has only your app scheme and the web admin domain.
- [ ] Custom SMTP (Brevo) configured with SPF/DKIM on the sending domain, so OTP mails don't land in spam
- [ ] Optional: **CAPTCHA** (Cloudflare Turnstile, free) on email OTP for the web admin login

**Abuse & business rules**
- [ ] COD limits set in `stores` (max COD value, max open orders per user). The admin "block user" switch works.
- [ ] Rate limits above active. `place_order` re-validates **everything** server-side.
- [ ] Staff accounts: least privilege (`staff` cannot change prices, roles or settings; only `admin`).

**App & web**
- [ ] Deep links validate params (product slug/order id) and never perform actions on open
- [ ] Cloudflare Pages: security headers via `_headers` file (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`)
- [ ] **Dependabot** for npm and GitHub Actions. `npm audit --audit-level=high` in CI.

**Privacy (DPDP Act, 2023)**
- [ ] Consent notice at login. Purpose-limited data. `delete_my_account()` (Phase 3) anonymizes orders (keeps them for GST records, removes name/phone/address snapshot) and deletes addresses, cart, tokens, wishlist.
- [ ] Sentry and logs carry no phone numbers or addresses

---

## 9.7 Free-tier limits & keep-alive

**Goal:** run on the Supabase **Free** plan safely: know the limits, stop the project from pausing, keep real backups (Free has **no** downloadable backups or point-in-time recovery), and know when to upgrade.

### Limits to watch (check the Supabase pricing page; numbers change)
| Resource | Free plan (approx.) | What uses it here | Watch threshold |
|---|---|---|---|
| Database size | **500 MB** | orders, order_items, events, movements, search logs | 350 MB → archive `search_queries` > 90 days, prune `rate_limits` |
| File storage | **1 GB** | product images (~25 KB thumb + ~120 KB full WebP) ≈ 6,000 images | 700 MB |
| Egress | **5 GB / month** (+ cached egress quota) | API JSON + images | 3.5 GB → check image sizes, cache headers |
| Monthly active users | **50,000** | Auth users | far away |
| Realtime | **~200 concurrent connections**, **2 M messages / month** | every open app holds 1 socket | 150 peak |
| Edge Functions | **500,000 invocations / month** | `send-push` | 300k |
| Inactivity | project **pauses after 7 days** without activity | — | keep-alive below |
| Projects | 2 active free projects per org | prod + staging | — |

Egress tips that matter: lists use thumbs only, `expo-image` disk cache, and long `cacheControl` on uploads (Phase 7 uploads with `cacheControl: '31536000'` and a new file name on every change, so caches never serve old images).

### Keep-alive + health job
A scheduled GitHub Actions workflow both keeps the project active and runs the 9.4 health checks:
```yaml
# .github/workflows/keepalive-and-health.yml
name: keepalive-and-health
on:
  schedule:
    - cron: '*/15 1-17 * * *'      # every 15 min, 06:30–23:00 IST (UTC times)
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Keep-alive (anon read)
        run: |
          curl -fsS "$SUPABASE_URL/rest/v1/app_config?select=key&limit=1" \
            -H "apikey: $SUPABASE_ANON_KEY" > /dev/null
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      - name: Ops health → Telegram
        run: |
          H=$(curl -fsS "$SUPABASE_URL/rest/v1/v_ops_health?select=*" \
                -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY")
          U=$(echo "$H" | jq '.[0].unaccepted_over_5m')
          A=$(echo "$H" | jq '.[0].auto_cancelled_last_hour')
          if [ "$U" -gt 0 ] || [ "$A" -ge 2 ]; then
            curl -fsS "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
              -d chat_id="$TG_CHAT" -d text="⚠️ NearKart: $U order(s) waiting > 5 min, $A auto-cancelled in the last hour. Check the store tablet."
          fi
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          TG_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TG_CHAT: ${{ secrets.TELEGRAM_CHAT_ID }}
```
> GitHub **disables scheduled workflows in public repos after 60 days without repository activity**. Normal development keeps it alive. Also add the UptimeRobot monitor from 9.4 as a second keep-alive. Once real customers use the app daily, the project won't pause anyway.

### Nightly backups (database + Storage)
Free projects have **no automatic backups you can restore from**, so take your own. Two parts: the **database** (`pg_dump` through the Supabase CLI) and **Storage files** (not inside the database dump; only their metadata rows are).

Where to keep them: a **private** bucket on a different provider, e.g. **Cloudflare R2** (10 GB free) or **Backblaze B2** (10 GB free). Don't rely on GitHub Actions artifacts alone: they expire (max 90 days) and anyone with read access to the repo can download them, so they must at least be encrypted.

```yaml
# .github/workflows/backup.yml
name: nightly-backup
on:
  schedule: [{ cron: '30 21 * * *' }]     # 03:00 IST
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: supabase/setup-cli@v1
      - name: Install age + rclone
        run: sudo apt-get update && sudo apt-get install -y age rclone
      - name: Dump database (roles, schema, data)
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}   # Session pooler connection string (IPv4), from Dashboard → Connect
        run: |
          D=$(date -u +%F)
          mkdir -p out
          supabase db dump --db-url "$DB_URL" -f out/roles.sql --role-only
          supabase db dump --db-url "$DB_URL" -f out/schema.sql
          supabase db dump --db-url "$DB_URL" -f out/data.sql --use-copy --data-only
          tar czf "db-$D.tgz" -C out .
          age -r "${{ secrets.AGE_PUBLIC_KEY }}" -o "db-$D.tgz.age" "db-$D.tgz"
      - name: Mirror Storage buckets (S3-compatible endpoint)
        env:
          RCLONE_CONFIG_SB_TYPE: s3
          RCLONE_CONFIG_SB_PROVIDER: Other
          RCLONE_CONFIG_SB_ENDPOINT: ${{ secrets.SUPABASE_S3_ENDPOINT }}   # Storage → Settings → S3 connection
          RCLONE_CONFIG_SB_REGION: ${{ secrets.SUPABASE_S3_REGION }}
          RCLONE_CONFIG_SB_ACCESS_KEY_ID: ${{ secrets.SUPABASE_S3_KEY_ID }}
          RCLONE_CONFIG_SB_SECRET_ACCESS_KEY: ${{ secrets.SUPABASE_S3_SECRET }}
          RCLONE_CONFIG_R2_TYPE: s3
          RCLONE_CONFIG_R2_PROVIDER: Cloudflare
          RCLONE_CONFIG_R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          RCLONE_CONFIG_R2_ACCESS_KEY_ID: ${{ secrets.R2_KEY_ID }}
          RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET }}
        run: |
          D=$(date -u +%F)
          rclone copy "db-$D.tgz.age" r2:nearkart-backups/db/
          for b in catalog avatars issues; do
            rclone sync "sb:$b" "r2:nearkart-backups/storage/$b" --fast-list
          done
          # retention: keep 14 daily dumps
          rclone delete r2:nearkart-backups/db/ --min-age 15d
```
- `issues` contains customer photos. The R2 bucket is **private**. For extra safety, use `rclone`'s `crypt` remote over it so files are encrypted at rest.
- The **age private key** never goes to GitHub. Keep it in a password manager **and** an offline copy.
- **Restore test, monthly** (a backup you haven't restored isn't a backup): download → `age -d` → restore into a **local** Supabase (`supabase start`, then `psql` the roles, schema and data files in that order) → check row counts of `orders`, `products`, `inventory` against production → open the app against it.

### When to move to Pro (⚠️ ~US$25/month)
Upgrade when **any** of these is true. At that point the business is real and losing a day of orders costs more than the plan:
- Orders every day (pausing is no longer a risk, but you want **daily managed backups**, 7-day retention, and the option of PITR)
- Database > 350 MB, egress > 3.5 GB/month, or Realtime peak > 150 connections
- You need log retention longer than a day to investigate customer complaints
- You want a support channel

Even on Pro, keep the off-site backup job. It protects against account-level mistakes.

---

## 9.8 Legal pages & seller info

**Goal:** meet what Indian law and the Play Store expect from an app that **sells products**. Not legal advice: have a CA/lawyer review before launch.

**Files**
```
web/                                   # static site on Cloudflare Pages (free), same repo
  index.html                           # landing: what NearKart is, "Get the app", delivery area map image
  seller.html   privacy.html   terms.html   refunds.html   grievance.html   delete-account.html
  mr/…  hi/…                           # same pages in Marathi and Hindi
  _headers                             # security headers (9.6)
mobile/app/account/about.tsx           # in-app "Seller details & policies"
```
The web admin (Phase 7) and product web pages (Phase 8) are on the same Cloudflare Pages project, so one domain serves all of them.

### What each page must contain
| Page | Contents | Why |
|---|---|---|
| **Seller details** (`/seller`) | Legal business name, registered address, **GSTIN**, **FSSAI licence number**, customer-care phone/WhatsApp/email, working hours | Consumer Protection (E-Commerce) Rules, 2020: sellers must show these. FSSAI: licence displayed for food businesses. |
| **Refund, return & cancellation policy** (`/refunds`) | When a customer can cancel (before packing, as the app enforces), what happens if an item is unavailable (removed, total reduced), issue reporting window (e.g. 48 h after delivery, with photo), how refunds are made for COD (cash/UPI transfer by the store) and, from Phase 10, online refunds (to the original method, 5–7 working days), non-returnable items (fresh produce once accepted, unless damaged) | E-Commerce Rules require it to be shown **before** purchase. Payment gateways also require it to activate an account (Phase 10). |
| **Grievance officer** (`/grievance`) | Name, designation, phone, email. The process: acknowledge within **48 hours**, resolve within **one month** | E-Commerce Rules |
| **Privacy policy** (`/privacy`) | Data collected (name, email, phone, addresses, location when picking an address, order history, issue photos, push token, crash logs), why, retention (orders kept for GST records ~8 years in anonymized form after account deletion), processors (Supabase, Google Sign-In, Expo/FCM push, Sentry, Brevo email; Razorpay from Phase 10), no ads or data selling, rights (access, correction, deletion), grievance contact, last-updated date | DPDP Act 2023, Play policy |
| **Terms of use** (`/terms`) | Delivery area, prices may change until the order is placed, the store may cancel when out of stock, COD rules (limits, refusal at the door may block COD), acceptable use, contact | Clarity, gateway activation |
| **Delete account** (`/delete-account`) | "In the app: Account → Delete account" with a screenshot, plus an alternative (WhatsApp/email from the registered email), done within 7 days | Play Store requires a web link |

### In the app
- **Account → Seller details & policies** shows the same content (from `stores` + `app_config` keys `legal_urls`), so it's never out of date.
- **Cart → before Place order**: one line "By placing this order you agree to the [Terms] and [Refund policy]" (links).
- **Product detail**: the Legal Metrology block (MRP incl. taxes, net quantity, manufacturer/packer, country of origin, best-before/shelf life) was added in Phase 1.8 and made required in the Phase 7 product form. Re-check 10 random products before launch.
- **Invoice** (Phase 5.5/6.5) shows seller GSTIN, FSSAI, HSN and tax breakup.

**Checks:** every page reachable in 3 languages. Links in `app_config.legal_urls` open from the app. A native speaker has reviewed the Marathi and Hindi versions.

---

## 9.9 Force update & maintenance mode

**Goal:** be able to stop old, broken app versions and pause ordering (for example during a stock-taking day or a bad bug) **without** a new release.

**SQL** (`app_config` exists since Phase 0; this just documents and seeds the keys)
```sql
-- 0900_hardening.sql (part 5: app_config keys)
insert into public.app_config (key, value) values
  ('min_app_version',  '{"android": "1.0.0", "ios": "1.0.0"}'),
  ('latest_app_version','{"android": "1.0.0", "ios": "1.0.0"}'),
  ('maintenance',      '{"enabled": false, "message": {"en": "", "mr": "", "hi": ""}, "ordering_only": true}'),
  ('support',          '{"phone": "+91XXXXXXXXXX", "whatsapp": "+91XXXXXXXXXX", "email": "help@<domain>"}'),
  ('legal_urls',       '{"seller": "https://<domain>/seller", "privacy": "https://<domain>/privacy", "terms": "https://<domain>/terms", "refunds": "https://<domain>/refunds", "grievance": "https://<domain>/grievance"}')
on conflict (key) do nothing;
```
And make maintenance real on the server too, not just in the app:
```sql
-- inside place_order() (create or replace in this migration), near the top:
if coalesce((select (value ->> 'enabled')::boolean from public.app_config where key = 'maintenance'), false) then
  raise exception 'maintenance' using errcode = 'PT503';
end if;
```

**Files**
```
mobile/src/features/app-config/useAppConfig.ts       # query + Realtime on app_config (optional) / refetch on focus
mobile/src/features/app-config/ForceUpdateGate.tsx    # wraps the root layout
mobile/src/features/app-config/MaintenanceBanner.tsx
```

**Steps**
1. On launch and on every app foreground, fetch `app_config` (cached, 9.1).
2. Compare `Application.nativeApplicationVersion` with `min_app_version[Platform.OS]` (semver compare in `src/lib/semver.ts`):
   - below **min** → full-screen **"Please update NearKart"** with a button opening the Play Store (`market://details?id=in.nearkart.app`, falling back to the https URL). Browsing is blocked; the cart stays saved.
   - below **latest** → a dismissible banner once a day.
3. `maintenance.enabled`:
   - `ordering_only: true` → browsing works, a banner shows the message, and Place order is disabled (and the server rejects it anyway).
   - `ordering_only: false` → full-screen message, for real outages.
4. Admin → Settings (Phase 7.8) gets two switches for these keys, so the owner doesn't need Studio.

**Tests:** `ForceUpdateGate` with versions below/equal/above min. Maintenance banner disables Place order. pgTAP: `place_order` raises `maintenance` when enabled.

---

## 9.10 Store listing & staged rollout

**Goal:** a trustworthy Play Store presence in three languages and a repeatable, boring release process.

### Play Console setup
1. Create the developer account (**US$25 one-time**): personal or organization. A shop that is a registered business should use an **organization** account (needs a free D-U-N-S number, which takes some days). It looks more trustworthy for a shopping app and avoids the closed-testing rule below.
2. **New personal accounts must run a closed test with at least 12 testers for 14 continuous days** before production access (check the current rule in Play Console). Recruit the store's regular customers and staff early.
3. Default language **English (India)**, plus **Marathi** and **Hindi** listings.

### Listing content (draft; refine with native speakers)
| Field | English | मराठी | हिंदी |
|---|---|---|---|
| App name (≤ 30) | NearKart – Groceries in minutes | NearKart – किराणा काही मिनिटांत | NearKart – मिनटों में किराना |
| Short description (≤ 80) | Order groceries & essentials from your local store. Cash on delivery. | जवळच्या दुकानातून किराणा व गरजेच्या वस्तू मागवा. कॅश ऑन डिलिव्हरी. | पास की दुकान से किराना और ज़रूरी सामान मँगाएँ. कैश ऑन डिलीवरी. |
| Full description | What it is → live stock & prices → order in 3 languages → cash on delivery → live order status → delivery area → support | same | same |

**Graphics:** icon 512×512, feature graphic 1024×500, **4–8 phone screenshots per language** (Home, category with sub-category rail, product detail, cart with bill details, live order status, language picker). Take Marathi screenshots for the Marathi listing.

**Category:** Shopping. **Contact details:** the support phone/email from `app_config.support`.

### Policy forms
- **Data safety** (must match the privacy policy):
  | Data | Collected | Shared | Purpose | Optional |
  |---|---|---|---|---|
  | Name, email (Google/email login) | ✓ | No | Account management | Required to order |
  | Phone number (address form) | ✓ | No | App functionality (delivery contact) | Required to order |
  | Address, precise location (address pin) | ✓ | No | App functionality (delivery, serviceability) | Required to order |
  | Purchase history (orders) | ✓ | No | App functionality, analytics for the store | — |
  | Photos (issue reports) | ✓ | No | Customer support | Optional |
  | App activity (searches, incl. zero-result searches) | ✓ | No | Analytics (what to stock) | — |
  | Crash logs, diagnostics | ✓ | No | App stability (Sentry) | — |
  | Device IDs (push token) | ✓ | No | Notifications | Optional |
  Encrypted in transit ✓ · Deletion available ✓ (in-app + URL). From Phase 10 add **financial info: payment info is handled by Razorpay** (the app doesn't collect card/UPI details).
- **Content rating (IARC):** general. Declare **user-generated content** (reviews) with reporting/hiding (Phase 8).
- **Target audience:** 18+.
- **App access:** browsing needs no login. For ordering, give reviewers a **test account** (email OTP can't be read by them, so create a reviewer account with a password-based fallback, or explain Google login) and note that orders from that account are flagged as tests. Mention the delivery area so reviewers know why addresses elsewhere are "not serviceable", and provide a test address inside it.
- **Account deletion URL:** `https://<domain>/delete-account`.

### Versioning & signing
- `version` (semver) in `app.config.ts`; `android.versionCode` increases on every upload (derive from semver: `1.0.0` → `10000`).
- Tags `app-v1.0.0`; `CHANGELOG.md` in plain words (source of "What's new" ×3 languages).
- Upload key: `keytool -genkeypair -v -storetype PKCS12 -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`. Enrol in **Play App Signing**.
- ⚠️ **App Links** (Phase 8.4): `assetlinks.json` on Cloudflare Pages must contain the **SHA-256 of Play's app signing key** (Play Console → App integrity), not the upload key's. **Google Sign-In** also needs the Play signing key's **SHA-1** added to the Android OAuth client in Google Cloud, or login fails only in the Play build.
- Keystore + passwords: password manager + offline copy. Never in git.

### Build (free, on your machine)
```json
// eas.json (used with --local, no cloud quota consumed)
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "env": { "APP_ENV": "development" } },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" }, "env": { "APP_ENV": "staging" } },
    "production":  { "android": { "buildType": "app-bundle" }, "env": { "APP_ENV": "production" } }
  }
}
```
```bash
npx eas build --platform android --profile production --local       # → .aab
# or: APP_ENV=production npx expo prebuild --clean && cd android && ./gradlew bundleRelease
```
`scripts/release-android.sh`: tests → `supabase db lint` → types-in-sync check → version check → build → upload Sentry source maps → print checksum.

**Database migrations go first:** apply the release's migrations to **staging**, run Maestro there, then `supabase db push` to production **before** rolling out the app. Rule: migrations must be **backward compatible with the previous app version** (add columns/functions first; remove in a later release), because old app versions stay installed for weeks.

**OTA updates:** start without `expo-updates`. Staged store releases are enough at this scale.

### Tracks & rollout
| Step | Who | Exit criteria |
|---|---|---|
| **Internal testing** | you + store staff | Maestro two-device flow green on the release build. Push arrives on the store tablet. Google login works in the Play-signed build. Invoice prints. |
| **Closed testing** | ≥ 12 regular customers (≥ 14 days for new personal accounts) | Real COD orders delivered. No crash > 0.5% of users. Translations checked. |
| **Production 20%** | real users | 48 h: crash-free users ≥ 99.5%, ANR < 0.47%, no rise in `place_order` errors (Sentry breadcrumbs), no unaccepted-order alerts |
| **Production 50% → 100%** | | same checks, 48 h each |
Play lets you **halt** a staged rollout instantly. Fix, bump `versionCode`, resume. If the bug is in the server rules, fix the RPC with a new migration (no app release needed). That's a big advantage of keeping rules in SQL.

### Release checklist (copy into every release PR)
- [ ] CI green (lint, types, types-in-sync, `supabase db lint`, pgTAP, Jest/RNTL, i18n parity)
- [ ] Maestro flows green on the **release** build, including the two-device flow. Flashlight within budgets.
- [ ] Manual matrix (9.5) signed off. 2 GB phone checked. Real print checked.
- [ ] Migrations applied to staging, then production, **before** the rollout
- [ ] Security Advisor: 0 errors. Security checklist (9.6) reviewed for anything new.
- [ ] Last night's backup exists. Last restore test < 30 days old.
- [ ] `app_config.min_app_version` / `latest_app_version` updated if needed
- [ ] New strings reviewed by Marathi and Hindi speakers. "What's new" in 3 languages.
- [ ] Legal pages current. `assetlinks.json` and Google OAuth SHA-1 use the Play signing key.
- [ ] Version + versionCode bumped. Tag created. Keystore backed up.

### iOS (when you join the Apple Developer Program ⚠️ annual fee)
1. Upload an APNs key to Expo for push (Phase 5.8).
2. Build with `--platform ios --local` (macOS + Xcode) → TestFlight.
3. Apple requires **Sign in with Apple** when an app offers Google login (or another option meeting its privacy rules). Supabase Auth supports Apple natively (`signInWithIdToken({ provider: 'apple' })` with `expo-apple-authentication`).
4. Physical goods are paid outside Apple's in-app purchase system (COD now, Razorpay later), which is allowed for physical products.
5. App Privacy label = the same answers as Play Data safety.

---

## Launch-day runbook (the store side)

Software is half the launch. The other half is a store team that trusts the tablet. Write this as `docs/STORE_RUNBOOK.md`, printed and kept at the counter, in Marathi and English.

### One week before: staff training (2 sessions of 1 hour)
1. **Store mode basics:** log in, the orders board, what the alarm means, accepting within the auto-cancel time (`stores.auto_cancel_minutes`).
2. **Packing:** tick items as picked, **Mark unavailable** when an item is damaged/missing (and what the customer sees), print the pick list and invoice.
3. **Statuses:** Packed → Out for delivery → Delivered. Never mark Delivered before the cash is collected.
4. **Stock:** scan barcode → set count. Do it when a delivery truck arrives and at closing. Wrong stock = cancelled orders = angry customers.
5. **When things go wrong:** tablet offline (red banner) → switch to phone hotspot; customer calls about an order → search by order number; wrong price on a product → tell the owner (only admin changes prices); app not working at all → pause the store switch and call the owner.
6. **Practice:** each staff member handles 5 test orders end to end, including one with an unavailable item and one cancellation.

### Two days before: dry run
- [ ] Real stock counted and entered for every active variant (`v_low_stock` shows nothing unexpected)
- [ ] 10 random product pages checked for price, MRP, net quantity, images, Marathi/Hindi names
- [ ] Fees and limits checked in Admin → Settings: delivery fee, free-delivery threshold, small-cart fee, minimum order, max COD value, auto-cancel minutes, service radius
- [ ] **10 test orders** from 3 different phones and addresses (one outside the area, which must be rejected), delivered by the store's own delivery person, cash collected, statuses updated
- [ ] Test orders cancelled/marked as tests so the dashboard numbers start clean on launch day

### Opening checklist (every day, first 2 weeks; keep it laminated)
- [ ] Store tablet charged and on the charger, volume **max**, Do Not Disturb **off**, battery optimisation **off** for NearKart (Android settings), Wi-Fi + mobile data on
- [ ] Open Store mode, confirm the green "Connected" indicator
- [ ] Place one test order from the owner's phone → it rings within seconds → cancel it
- [ ] Switch the store to **Accepting orders**
- [ ] Printer paper loaded

### Closing checklist
- [ ] All orders Delivered or Cancelled (no order left "Packed")
- [ ] Store switch → **Paused** (or let the opening hours close it)
- [ ] Stock corrections for anything damaged today
- [ ] Cash collected = sum of today's delivered COD orders (Admin dashboard → Today)

### First week routine (owner/developer)
- **Daily:** Sentry, Play vitals, the Telegram alerts, Admin dashboard (orders, cancellations **and their reasons**, zero-result searches). Answer every store review in the reviewer's language.
- **Fix the top cancellation reason first.** In quick commerce it's almost always stock accuracy.
- **Weekly:** Supabase Usage page vs the 9.7 thresholds, backup restore spot-check, Dependabot PRs.
- **Hotfix process:** server rule bug → new migration (no release). App bug → branch from the tag → fix + test → patch version → staged rollout from 20%.

---

## Definition of Done: v1.0

- [ ] A guest in any of 3 languages can browse every category (including one created in Admin today), see live prices and stock, search with synonyms, and fill a cart
- [ ] A customer can log in, save a serviceable address, place a COD order safely (no overselling, no duplicate orders, server-computed totals), and watch it update live, cancel it while allowed, report an issue, and reorder
- [ ] The store receives orders instantly with an alarm, packs with a checklist, handles unavailable items, prints invoices, manages stock with a barcode scanner, and can pause the store
- [ ] The admin manages categories, attributes, products, banners, fees and roles without code or a release, and sees daily sales, cancellations and what customers searched for but didn't find
- [ ] Fast on a 2 GB phone, offline where it makes sense, accessible, monitored, rate-limited, RLS-tested, backed up off-site with a tested restore
- [ ] Legally ready to sell online (seller details, policies, grievance officer, Legal Metrology fields, GST invoice) and published on the Play Store in 3 languages, rolled out in stages
- [ ] Store staff trained and the runbook in use

## Phase 9 wrap-up

| Area | Delivered |
|---|---|
| SQL | `0900_hardening.sql`: `rate_limits` + `check_rate_limit()` + `request_ip()`, indexes, `(select auth.uid())` policy rewrites, statement timeouts, `v_ops_health`, `app_config` keys, maintenance check in `place_order` |
| App | Persist whitelist, offline states, data saver, Sentry, error boundary, `ForceUpdateGate`, `MaintenanceBanner`, a11y fixes |
| Web | Legal pages ×3 languages on Cloudflare Pages, security headers |
| Ops | Keep-alive + health alerts, nightly encrypted DB + Storage backups to R2/B2, monthly restore test, Telegram alerts |
| Quality | pgTAP RLS isolation tests, full CI gates, two-device Maestro flow, manual matrix |
| Release | Play listing ×3, Data Safety, signing, staged rollout, release checklist, store runbook |

**Next:** [Phase 10: Online Payments (UPI)](PHASE_10.md). The legal pages from 9.8 are also what Razorpay asks for when activating the account.
