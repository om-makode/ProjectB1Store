# NearKart: Project Guide (everything in one place)

> A Blinkit-style quick-commerce app for one town: customers browse groceries in **English / मराठी / हिंदी**, see **live stock and prices**, and place **cash-on-delivery** orders (UPI ready, switched off). The store receives orders **live** on a tablet or laptop, packs them and updates the status, and the customer sees every step live.

| Doc | Use it for |
|---|---|
| **This file** | What the app is, how it's built, how to run it, roles, data model, status |
| [`NEXT_STEPS.md`](NEXT_STEPS.md) | Detailed setup steps per phase (auth, push, UPI…) and the running to-do list |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Play Store release, Data Safety, signing, launch-day runbook |
| [`docs/not-required/REACT_NATIVE_PLAN.md`](../not-required/REACT_NATIVE_PLAN.md) + [`docs/not-required/phases/`](../not-required/phases/00_PHASES_OVERVIEW.md) | The original plan and phase specs. **The code and migrations are the source of truth** where they differ. |
| [`web/README.md`](../../web/README.md), [`supabase/`](../../supabase/) | Backend and web-pages specifics |

---

## 1. At a glance

| | |
|---|---|
| **Model** | Single store, own inventory (Blinkit-style). Schema supports more stores later. |
| **App** | Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router (`mobile/src/app`). One codebase for Android, iOS and **web** (the web build is also the admin/counter app). |
| **Backend** | **Supabase only**: Postgres (tables, RLS, RPCs, triggers), Auth, Realtime, Storage, Edge Functions, pg_cron. No custom server. |
| **Payments** | Cash on delivery live. Razorpay UPI built but **off** until keys are added. |
| **Delivery** | No rider app. Staff set "Out for delivery" / "Delivered" by hand. |
| **Languages** | EN / MR / HI for UI and catalog content (`{en, mr, hi}` JSON). |
| **Supabase project** | `tclflrlrzoyuaoswkpwb` (Mumbai). 14 of 16 migrations applied. **Pending:** `20261101120000_store_settings_pincodes_upi.sql` and `20261101121000_card_ratings.sql` (run `npx supabase db push`, then `npm run gen:types:cloud`). |

---

## 2. Folder map

```
nearkart/
  README.md               short intro + getting started (GitHub front page)
  docs/required/          PROJECT_GUIDE.md (you are here) · NEXT_STEPS.md · RELEASE_CHECKLIST.md
  docs/not-required/      original plan + phase specs (history; code is the source of truth)
  mobile/                 Expo app (customer + Store mode + Admin; web too)
    src/app/              routes (thin files only)
    src/features/<area>/  api.ts (Supabase calls) · hooks.ts (TanStack Query) · screens/components
    src/ui/               design system: Button, Text, Card, Chip, Badge, Stepper, PriceTag, VegMark, Sheet, Toast, Skeleton, EmptyState, ErrorState, TextField, Screen…
    src/i18n/locales/     en.json · mr.json · hi.json (parity test keeps them in sync)
    src/lib/              supabase client, errors, realtime, kv storage, logger, format
    src/types/database.ts generated from Supabase (npm run gen:types:cloud)
  supabase/
    migrations/           16 SQL files: one or two per phase, plus follow-ups (source of truth for the DB)
    seed.sql              LOCAL ONLY (test users with password123 + catalog)
    seed_catalog.sql      catalog only, safe for the real project
    functions/            Edge Functions: send-push, create-payment, verify-payment, razorpay-webhook, process-refunds, reconcile-payments
    tests/                pgTAP tests
  tools/sqlcheck/         runs all migrations + seed + 56 end-to-end SQL checks on PGlite (no Docker)
  web/                    Cloudflare Pages: share pages /p/<slug>, /c/<slug>, legal pages, assetlinks
  .github/workflows/ci.yml  mobile (lint, typecheck, test) + database (sqlcheck)
```

**Code rules:** screens never call Supabase directly (ESLint enforces it). Reads go through feature hooks. **Anything touching money or stock goes through a Postgres RPC**, never direct table writes.

---

## 3. Run it

```bash
cd "~/Desktop/React Native Projects/nearkart/mobile"
npm install

# Web (fastest; also the admin/counter app)
npx expo start --web --clear            # http://localhost:8081

# Android phone (dev build, not Expo Go)
npx expo run:android --device           # first time / after native changes
npx expo start --dev-client --clear     # daily

# iOS simulator
npx expo run:ios
```

**Checks**
```bash
cd mobile && npx tsc --noEmit && npx expo lint && npm test
cd tools/sqlcheck && npm install && node run.mjs      # DB: migrations + seed + 56 checks
cd mobile && npm run gen:types:cloud                  # after any migration is pushed
cd .. && npx supabase db push                         # apply new migrations to the project
```

### Environment (`mobile/.env`, git-ignored)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://tclflrlrzoyuaoswkpwb.supabase.co` (later: your own domain proxy, see §11) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | publishable key (safe in the app because of RLS) |
| `EXPO_PUBLIC_WEB_URL` | base for share links (`/p/<slug>`); https enables Android App Links |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `…_IOS_CLIENT_ID` | optional Google login |
| `EXPO_PUBLIC_DEV_PASSWORD_LOGIN` | `true` = email+password login in **dev builds only** (test accounts) |
| `EAS_PROJECT_ID` | needed for push tokens |
| `EXPO_PUBLIC_SENTRY_DSN` | optional crash reporting (not installed yet) |

Never put the `service_role`/secret key in the app.

---

## 4. Roles & what each can do

Role lives in `profiles.role` and is enforced by RLS and RPCs, not just hidden buttons. **Admin ⊇ Staff ⊇ Customer.**

| Role | Where | Can do |
|---|---|---|
| **Guest** | app | Browse, search, filters, product details, cart on the device, language |
| **Customer** | app | + addresses, COD (UPI later) checkout, live order tracking, cancel (placed/confirmed), reorder, report issue with photos, invoice, wishlist, Notify me, reviews after delivery, notification settings, delete account |
| **Staff** | Account → **Store mode** | Live orders board with alarm and auto-cancel countdown; accept → packing → packed → out → delivered; pick checklist; **"Not available"** per item (reason fixes stock, total recalculated, customer told); cancel; staff note; print pick list and invoice (A4/80/58 mm); stock (search, barcode, +/−, set exact, hide, receive delivery, low/out lists); store open/pause, busy message and ETA; customer issues |
| **Admin** | Account → **Admin** (+ Store mode) | Dashboard and reports; categories and sub-categories with custom attribute fields and filters; products (legal fields, variants, prices, stock, photos); CSV import/export; banners, home sections, collections, search synonyms; store settings and fees, **delivery pincodes, UPI switch and payment time limit**; users (roles, block, COD per user); reviews moderation; notification campaigns; refunds |

**Make the first admin** (SQL Editor):
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```
After that, use Admin → Users. **Test accounts without email codes:** Auth → Users → Add user (Auto Confirm) + `EXPO_PUBLIC_DEV_PASSWORD_LOGIN=true`.

---

## 5. Screens (routes in `mobile/src/app`)

| Area | Routes |
|---|---|
| Onboarding | `(onboarding)/language` |
| Tabs | `(shop)/index` Home · `(shop)/categories` · `(shop)/orders` · `(shop)/account` |
| Shopping | `category/[slug]` (sub-category rail + grid) · `product/[slug]` · `product/[slug]/reviews` · `collection/[slug]` · `search` · `buy-again` · `p/[slug]`, `c/[slug]` (deep-link aliases) |
| Cart & orders | `cart` · `checkout` · `order/placed` · `order/[id]` (live) · `order/[id]/issue` · `order/[id]/review` |
| Account | `auth/login` · `account/profile` · `account/addresses` (+`edit`) · `account/wishlist` · `account/notifications` · `account/notification-settings` · `account/help` · `account/legal` |
| Store mode (staff) | `store/` board · `store/order/[id]` · `store/stock` · `store/issues` · `store/settings` |
| Admin | `admin/` dashboard · `admin/categories` (+`edit`) · `admin/products` (+`edit`, `import`) · `admin/merch` · `admin/settings` · `admin/users` · `admin/reviews` · `admin/campaigns` · `admin/refunds` · `admin/reports/[report]` |

---

## 6. Data model (Supabase, `public` schema)

| Group | Tables |
|---|---|
| Users | `profiles` (role, is_blocked, cod_allowed, language), `addresses` (GPS optional; `is_serviceable` set by trigger), `notification_preferences`, `push_tokens` |
| Store & catalog | `stores` (hours, fees, limits, `serviceable_pincodes`, `upi_enabled`), `categories` (2 levels, `attribute_schema`, `filters`), `brands`, `products` (legal fields, `attributes`, `search_text`, rating), `product_variants` (SKU, barcode, MRP, price, max per order), `product_images`, `inventory` (per store × variant) |
| Merchandising | `banners`, `home_sections`, `collections`, `collection_products`, `search_synonyms`, `search_queries` (zero-result log) |
| Cart & orders | `cart_items`, `orders` (status, payment, fee snapshot, idempotency key), `order_items` (price/GST snapshot, picked, unavailable), `order_status_events`, `order_status_transitions`, `inventory_movements` (stock audit) |
| Engagement | `wishlist`, `reviews`, `stock_alerts`, `notifications`, `campaigns`, `order_issues` |
| Payments | `payments`, `refunds`, `payment_webhook_events`, `payment_mismatches` |
| Ops | `app_config` (versions, maintenance, legal URLs, trending), `rate_limits`, `admin_audit_log` |

**Storage buckets:** `catalog` (public read, admin write; paths like `products/<uuid>_full.jpg`), `avatars`, `issues` (private).

**Key RPCs** (called with `supabase.rpc`):
- **Shop:** `get_home`, `list_products`, `get_product`, `search_products`, `category_filter_options`, `store_status`, `related_products`
- **Addresses:** `check_serviceability`
- **Cart & checkout:** `get_cart_quote`, `quote_guest_cart`, `set_cart_quantity`, `merge_guest_cart`, `fix_cart`, `place_order`
- **Customer orders:** `cancel_order`, `reorder_to_cart`, `report_order_issue`, `submit_review`, `toggle_stock_alert`
- **Staff:** `staff_*`
- **Admin:** `admin_*`
- **Payments:** `confirm_payment` etc. (service role only)

### Order lifecycle
```
placed → confirmed → packing → packed → out_for_delivery → delivered
   └─ cancelled (customer while placed/confirmed · staff any time before delivered · system auto-cancel if not accepted in N min)
UPI: awaiting_payment → placed (paid) | cancelled (hold expired)
```
`place_order` locks stock rows, re-prices everything server-side, checks store open, serviceability (GPS or pincode), min order, COD limit, open-order and rate limits, and is idempotent per checkout attempt.

### Real-time
| Channel | Purpose |
|---|---|
| `catalog-live:*` | inventory, variant price, store changes → live stock/prices/open status |
| `my-orders:<uid>:*` | the customer's orders + notifications |
| `store-orders:<store>:*` | staff orders board + new-order alarm |
| `cart:<uid>` (private broadcast) | cart sync across devices |

Realtime is a hint: screens also refetch on focus, foreground and reconnect.

---

## 7. Status

| Phase | What | State |
|---|---|---|
| 0 | Foundation, theme, i18n, Supabase client | ✅ built |
| 1 | Catalog & Home, live stock | ✅ built, used on device |
| 2 | Search, filters, Notify me | ✅ built |
| 3 | Login (email code, Google-ready), profile, addresses | ✅ built (addresses: GPS optional) |
| 4 | Cart & COD checkout | ✅ built |
| 5 | Live orders, cancel, reorder, issues, invoice, notifications | ✅ built (push needs setup) |
| 6 | Store mode | ✅ built |
| 7 | Admin | ✅ built |
| 8 | Wishlist, buy again, reviews, share, campaigns, web pages | ✅ built (web not deployed) |
| 9 | Hardening: force update, maintenance, offline, legal, release config | ✅ built |
| 10 | Razorpay UPI | ✅ built, **off** until keys |

**UI polish (Oct 2026):**
- **Customer app:**
  - refined theme (soft colours, shadows, max widths)
  - Blinkit-style Home (pinned search, big ETA header, auto-sliding banners, icon category tiles, "See all")
  - green outline ADD, "⏱ N MINS" chip and ★ ratings on cards
  - responsive 2–6 column grids and two-column product pages on wide screens
  - sticky add/checkout bars
  - cart savings banner and free-delivery progress
  - radio-card payments, order status card, grouped Account
- **Store mode:**
  - stat tiles and colour-coded board columns
  - elapsed-time pills and an Accept button on new orders
  - picked-progress bar on the order screen
  - stock pills with inline ±1
  - big open/paused card with ETA and busy-message presets
- **Admin:**
  - left sidebar on laptops
  - stat tiles, zebra tables and sticky Save bars

Checks: app **114/114** tests, typecheck, lint and Prettier clean, web export builds; DB **56/56** end-to-end checks. End-to-end flows still to test by hand: full order across two windows, admin saves, campaigns, refunds.

---

## 8. Gotchas we hit (and fixes)

| Symptom | Cause / fix |
|---|---|
| "Something went wrong, check your network" everywhere | Metro cached old `.env` → `npx expo start --clear` |
| `Unable to resolve host …supabase.co` on the phone | ISP/mobile network blocks `*.supabase.co` → phone Private DNS `dns.google` for testing; **own domain proxy before launch** (§11) |
| Expo Go version mismatch | This app needs a **dev build** (`npx expo run:android --device`), not Expo Go |
| NDK `did not have a source.properties file` | broken NDK folder → delete it, `sdkmanager "ndk;27.1.12297006"` |
| Email login sends a link | set `{{ .Token }}` in **Confirm signup** and **Magic Link** templates, OTP length 6 |
| Cart write fails `cart_items_user_id_fkey` | user without profile / stale session → backfill profiles, log out/in |
| Web image upload "Failed to execute…" | `resize({height:null})` on web → fixed (width only) |
| Upload "violates row level security" | `upsert:true` needs SELECT → fixed (plain insert); user must be admin |
| `cannot add postgres_changes callbacks … after subscribe()` | channel name reuse on remount → fixed with unique topics |
| `<button>` inside `<button>` (web) | product card role → fixed (no button role on web) |
| Delete account / delete address did nothing on web | `Alert.alert` is a no-op in browsers → shared `confirmAction()` (`src/lib/confirm.ts`) uses `window.confirm` on web |
| Logged-out user opens `/account/addresses` (deep link / refresh) | protected routes wrapped with `withLogin()` / `<LoginRequired>` (`src/features/auth/LoginRequired.tsx`): login prompt, no queries |
| "Save" stays on the page on web after a refresh | `goBack(fallback)` (`src/lib/navigation.ts`) replaces with a sensible screen when there's no history |
| `ROUTE_NAMES_CHANGED` dev warning | every route is now listed inside `Stack.Protected` in `src/app/_layout.tsx` |

---

## 9. Accounts & services (yours to create)

Supabase (done) · Google Cloud OAuth (optional) · Brevo SMTP (login emails) · Expo/EAS (push, cloud builds) · Firebase (Android push channel) · Razorpay (UPI) · Cloudflare (web pages + API proxy) · domain · Google Play Console. Exact steps: `NEXT_STEPS.md`, `RELEASE_CHECKLIST.md`.

---

## 10. Must do before launch

1. **Own domain + proxy for Supabase** (some Indian networks block `supabase.co`).
2. Login emails: code templates + SMTP.
3. Real catalog: photos, prices, stock, **delivery pincodes**, fees, hours, GSTIN/FSSAI.
4. Legal pages: replace every `[FILL]`, review, deploy `web/`.
5. Turn off `EXPO_PUBLIC_DEV_PASSWORD_LOGIN`, delete test users.
6. Push notifications set up and tested on a phone.
7. Supabase Pro (no pausing, backups) once there are daily orders.
8. Play Store listing, signing, internal → closed → staged rollout.
9. First git commit and a remote backup of the repo.

---

## 11. Decisions & deviations from the plan

- Routes live in `mobile/src/app` (Expo template), not `mobile/app`.
- Plain StyleSheet + theme tokens instead of NativeWind; `expo-sqlite` KV instead of MMKV; Modal-based sheets.
- Addresses: GPS optional; delivery checked at checkout by GPS radius **or** `stores.serviceable_pincodes`.
- Cart sync via private Broadcast channel; order notifications share the orders channel.
- Item unavailable changes stock by reason (not found → 0, customer request → back in stock, damaged/expired → no change); fees never go up.
- Web uploads are JPEG (WebP encode isn't universal in browsers); phones upload WebP.
- Product cards show "★ 4.3 (12)" once a product has reviews (`catalog_product_cards` returns the rating; Buy again cards don't).
- Missing images: category icon on a tinted tile (products) and a designed banner with a "Shop now" pill; failed image URLs are remembered for the session (`src/lib/imageFailures.ts`).
- No map pin, no share-image card, no Sentry yet (see `NEXT_STEPS.md`).
