# NearKart: status & next steps

Last updated: 2026-10-17. The original plan lives in [`docs/not-required/`](../not-required/REACT_NATIVE_PLAN.md) (phases in `docs/not-required/phases/`). Start with [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md).

## Done

| Area | State | Verified by |
|---|---|---|
| **Phase 0 app** (`mobile/`) | Expo SDK 58 / RN 0.88 / TS. Theme (light/dark, large text), EN/MR/HI + `localize()`, UI kit in `src/ui/`, Supabase client with encrypted session, TanStack Query with persisted cache, language onboarding, 4 tabs (Home, Categories, Orders, Account). | `npx tsc --noEmit` ✓, `npx expo lint` ✓, `npm test` (38 tests) ✓, `expo-doctor` ✓, web + Android bundles export ✓ |
| **Database** (`supabase/migrations/`) | All 13 migrations for Phases 0–10 + `seed.sql` (store, categories, products, variants, stock, synonyms, test users). Cross-phase conflicts resolved. | `tools/sqlcheck`: all migrations + seed apply on PGlite (real Postgres + PostGIS), **49/49 end-to-end checks pass** (cart → order → idempotency → cancel/restock → staff flow → item unavailable → back-in-stock → search → admin → reviews → auto-cancel → UPI/refunds → rate limit → store closed) |
| **Phase 1 app** (catalog & home) | Home (store status, banners, category grid, product rails, collections), Categories tab, category screen with sub-category rail + infinite grid + sort, product card with ADD/stepper, product detail (variants, highlights, legal info), collections, guest cart + floating cart bar + simple cart screen, live stock/price via Realtime. Search screen is a stub (Phase 2). Product images are placeholders until uploaded. | tsc ✓, lint ✓, 47 tests ✓, iOS bundle ✓; data shapes checked read-only against the live project. Not yet run on a device. |
| **Phase 2 app** (search & discovery) | Search screen (instant results EN/MR/HI + synonyms, suggestions, recent + trending, logging, "tell us what you want"), voice search (expo-speech-recognition, needs a rebuild), schema-driven filters & sort sheet with active chips, "Notify me" (stored locally until login; `flushPendingStockAlerts()` for Phase 3), similar / often-bought-together rails. No sort or brand filter on search results (RPC has no sort param). | tsc ✓, lint ✓, 55 tests ✓, iOS bundle ✓; shapes checked read-only. |
| **Phase 3 app** (accounts, addresses, serviceability) | Supabase Auth with **email OTP** (6-digit code, resend timer) and **Google** (shown only once client IDs are set and the app is rebuilt); `useRequireLogin()` gate (login modal returns to where you were); after login: pending "Notify me" alerts sent, profile refreshed, language synced to `profiles.language`. Account tab: login card / profile, edit name + phone, address book, help & seller info, logout, delete account (handles `ACTIVE_ORDERS_EXIST`). "Delivering to" bar on Home with a location sheet (current location via GPS or a saved address → `check_serviceability`, "Not delivering here yet"), kept on the phone for guests. Address form: GPS + reverse geocode fills fields, live serviceability before saving, label, default. No map pin (see deviations). | tsc ✓, lint ✓, 59 tests ✓, iOS bundle ✓; `check_serviceability` checked read-only (inside: 2.84 km ✓, Mumbai: OUTSIDE_AREA ✓). Login not tested end-to-end (needs your Auth setup). |
| **Phase 4 app** (cart & checkout, COD) | One cart facade for guests and logged-in users: local cart for instant steppers; logged in → debounced `set_cart_quantity`, `merge_guest_cart` on login, local copy rebuilt from the server quote, cleared on logout; live sync across devices over the private Broadcast topic `cart:<uid>`. Cart screen priced by the server (`quote_guest_cart` / `get_cart_quote`): per-line flags (out of stock, only N left, over limit, price changed) + "Update cart" (`fix_cart`), bill details (item total, delivery / small-cart / packaging fees, savings), "Add ₹X for free delivery", store-closed / min-order / not-serviceable blockers; re-quoted on open, focus, stock/price Realtime events and every change. Checkout: login gate, address pick/add, Cash on delivery (UPI shown "coming soon"), note, `place_order` with one idempotency key per attempt + double-tap guard + `p_expected_total`; every error code has EN/MR/HI copy and a recovery action. Order-placed screen; `order/[id]` is a basic header until Phase 5. | tsc ✓, lint ✓, 67 tests ✓, web + iOS bundles ✓; guest quote checked read-only against the live project. Ordering not tested end-to-end (needs a login). |
| **Phase 5 app** (orders, live tracking, notifications) | Orders tab (active orders on top, paginated past orders, login/empty states). `order/[id]`: live status timeline (`order_status_events` + Realtime channel `my-orders:<uid>` on `orders` + `notifications`, refetch on focus/foreground/reconnect), items with unavailable lines struck, bill, address, note, call store; cancel sheet with reasons (`cancel_order`, only while placed/confirmed); reorder (`reorder_to_cart`, reports missing items, opens cart); report an issue within 48 h (`order/[id]/issue`: type, item, message, up to 3 photos compressed and uploaded to the private `issues` bucket, `report_order_issue`); GST invoice (HTML → print/share PDF on phones, browser print window on web). Notifications: bell with unread badge (Home + Orders), inbox `account/notifications`, mark read, tap → order/product, in-app toast on new notification. Push (phones only): channels orders/store_orders/stock/offers/reminders, token registration after login (`register_push_token`), unregister before logout, tap routing; skipped quietly until an EAS project id is set. `supabase/functions/send-push` written (not deployed). | tsc ✓, lint ✓, 78 tests ✓, web + iOS bundles ✓; inbox/issue query shapes checked read-only. Not tested end-to-end (needs a login and a placed order). |
| **Phase 6 app** (Store mode) | `store/` routes, guarded to staff/admin (Account → Store mode). Live orders board: New · Accepted · Packing · Ready · Out · Done, with tabs on phones and side-by-side columns on wide screens. Realtime `store-orders:<id>`, refetch on focus/reconnect plus a 30 s safety poll, and today's summary strip. New-order alarm: a looping sound while any order waits (expo-audio; on web, "Tap to enable sound" unlocks the browser), vibration, screen kept awake, auto-cancel countdown. Staff order screen: call customer, Open in Maps, customer note, pick checklist (the first tick starts packing), "Not available" with 4 reasons, next-status buttons driven by `order_status_transitions`, cancel with reason, staff note. Prints a pick list and invoice on A4, 80 mm or 58 mm paper. Stock: search by name/SKU/barcode (USB scanners work on web), Low/Out/Hidden filters, adjust with reason, set an exact count, selling on/off, "Receive delivery" in bulk, camera barcode scan on phones. Store switch: accepting/paused, busy message, ETA. Customer issues: view photos, resolve or close with a reply. EN/MR/HI. | tsc ✓, lint ✓, 83 tests ✓, web + Android bundles ✓. Not tested end-to-end (needs a staff login and a real order). |
| **Phase 7 app** (Admin) | `admin/` routes, admin only (Account → Admin), web-first layout (laptop) that also works on a tablet. Dashboard (today's orders, revenue, AOV, cancellations, low stock, open issues, zero-result searches, top products) + 5 report tables from the `v_*` views. Categories: tree with reorder, create/edit category & sub-category (EN/MR/HI, slug, icon, colour, image, visible), **attribute builder** (fields with type, unit, min/max, options, required/filterable/badge; saved fields are retired, never deleted; "N products missing this" check), filters editor (brand, price steps, veg, in stock, attribute; quick filters) and a live preview. Products: list with search, category, visible/hidden and "missing details" filters; editor with names/descriptions, category, brand (+ new brand), veg, tags, legal fields (manufacturer + address, origin, shelf life, HSN, GST), attributes form generated from the schema with runtime zod, sizes (SKU, barcode, label, qty, unit, MRP, price, max per order, default, selling, opening stock, low-stock level), photos (full 1080 + thumb 300 + 600×600 share JPEG for the first one) saved via `admin_upsert_product`. CSV export/import (web): dry-run check with per-row errors, then import in chunks of ≤300 rows. Home & offers: banners, home sections, collections (+ products), search synonyms, all with scheduling/reorder where relevant. Store settings & fees, opening hours. Users & roles: search, role, block, COD on/off. EN/MR/HI. | tsc ✓, lint ✓, 93 tests ✓ (10 new), web bundle ✓; list/export query shapes checked read-only. Not run end-to-end (needs an admin login). |
| **Phase 8 app** (engagement & growth) | Wishlist (♡ on cards and product page, login gate, optimistic; `account/wishlist`); Buy again (Home rail + `buy-again` screen from `buy_again`); ratings & reviews (★ summary on product page from `rating_avg/rating_count`, top reviews + `product/[slug]/reviews`, "Rate items" on delivered orders → `order/[id]/review` via `order_review_items` + `submit_review`; admin `admin/reviews` hide/unhide with reason); share product (OS share sheet / Web Share API / copy link → `${EXPO_PUBLIC_WEB_URL}/p/<slug>`); `p/[slug]` and `c/[slug]` routes redirect inside the app (so `nearkart://p/<slug>` works); Android App Link intent filters added automatically once `EXPO_PUBLIC_WEB_URL` is an https host; notification settings (`account/notification-settings`: offers, rating reminders; order updates always on); notification taps now follow `route` and campaign/price-drop `link`s (numeric product ids resolve to slugs); admin `admin/campaigns`: compose EN/MR/HI, 6 segments, preview audience (caps, quiet hours), send test to me, send now, schedule (IST), history. `web/`: Cloudflare Pages project with server-rendered `/p/<slug>` and `/c/<slug>` pages (Open Graph, JSON-LD, Open in app, Call/WhatsApp), `assetlinks.json` placeholder, `_headers`. EN/MR/HI. No share-card image (would need `react-native-view-shot` + rebuild); ratings not on product cards (catalog card RPC has no rating fields). | tsc ✓, lint ✓, 99 tests ✓ (6 new), web bundle ✓; `web/` pages rendered locally against the live project (product, 404, category). Not run end-to-end on a device. |
| **Phase 9** (hardening & release prep) | Launch gate from `app_config`: blocking "Update required" below `min_app_version`, dismissible "Update available" below `latest_app_version` (native only), full-app maintenance screen (staff/admin bypass) or ordering-only pause (checkout disabled); root error boundary (EN/MR/HI, retry); pluggable crash hook `src/lib/crash.ts` (no SDK yet); offline cache whitelist (`catalog`, `orders`, `me`, `notifications`, `appConfig`; staff/admin and quotes never persisted) + checkout disabled offline; Policies & seller info screen (`account/legal`: seller name/address/GSTIN/FSSAI from `stores`, grievance officer, privacy/terms/refund summaries, links from `app_config.legal_urls`); static legal page templates in `web/public` (`/privacy`, `/terms`, `/refunds`, `/contact`); `app.config.ts` version from `APP_VERSION` (default 1.0.0) + `ANDROID_VERSION_CODE`, background location blocked; `eas.json` (development/preview/production); CI `database` job; image cells fixed for list recycling; `RELEASE_CHECKLIST.md`. | tsc ✓, lint ✓, format ✓, 106 tests ✓ (7 new), web + Android bundles ✓, sqlcheck 49/49 ✓, pgTAP shim 56/56 (3 files skipped: need `supabase test db`). |
| Project files | Root `README.md`, `.gitignore`, `.github/workflows/ci.yml` (mobile job) | — |

Nothing is committed to git yet.

## What you need to do (accounts are yours to create)

1. Create a **Supabase** project (free, region Mumbai). Copy the **Project URL** and **anon key**.
2. In your terminal:
   ```bash
   cd "~/Desktop/React Native Projects/nearkart"
   npx supabase login                     # opens your browser
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push                   # applies supabase/migrations
   # Sample data on the real project: paste supabase/seed_catalog.sql into the SQL Editor
   # (seed.sql also creates test users with password123: local use only)
   ```
   In the dashboard, check that **pg_cron**, **pg_net** and **Vault** are enabled (Database → Extensions).
3. App env:
   ```bash
   cd mobile
   cp .env.example .env       # set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
   npm run gen:types:cloud    # regenerates src/types/database.ts from the linked project (done 2026-10-17)
   ```
4. Run the app:
   ```bash
   npx expo run:ios           # or: npx expo run:android  (one-time dev build)
   npx expo start --dev-client
   npx expo start --web       # quick browser preview
   ```

## Phase 3 setup you must do (login)

Rebuild once after pulling Phase 3, because `expo-location` and Google Sign-In add native code:
```bash
cd mobile && npx expo run:ios      # or: npx expo run:android
```
Until you rebuild, "Use current location" shows a message asking to pick an address instead, and the Google button stays hidden. Email login works without a rebuild.

### 1. Email code login (works with Supabase's built-in email for testing)
1. Supabase dashboard → **Authentication → Sign In / Providers → Email**: enabled. Set **Email OTP length = 6**.
2. **Authentication → Emails → Templates → Magic Link**: put the code in the email, for example:
   ```html
   <h2>Your NearKart code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```
   (Without `{{ .Token }}` the email only has a link, and the app needs the 6-digit code.)
3. The built-in sender allows only a few emails per hour. For real users, add a free SMTP provider under **Authentication → Emails → SMTP Settings**. For example, **Brevo** (free tier, about 300 emails/day): host `smtp-relay.brevo.com`, port `587`, your Brevo SMTP login and key, and a sender address on a domain you verified there.
4. **Authentication → Rate Limits**: raise "emails per hour" once SMTP is set.

### 2. Google login (optional)
1. In **Google Cloud Console** (your account), create a project → **APIs & Services → OAuth consent screen** (External, app name NearKart, support email).
2. **Credentials → Create OAuth client ID**, three times:
   - **Web application**: no redirect URIs needed for the native flow. Copy its **Client ID** and **Client secret**.
   - **iOS**: bundle ID `in.nearkart.app.development` (and `in.nearkart.app` for production). Copy its **Client ID**.
   - **Android**: package `in.nearkart.app.development` (and `in.nearkart.app`), plus the **SHA-1** of your signing key. For the debug build:
     ```bash
     cd mobile/android && ./gradlew signingReport      # after `npx expo run:android`
     # or: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
     ```
3. Supabase → **Authentication → Sign In / Providers → Google**:
   - Turn it on and paste the **Web** client ID and secret.
   - Under **Authorized Client IDs**, add the Web, iOS and Android client IDs, comma-separated.
   - Turn on **Skip nonce check**: the iOS Google SDK adds its own nonce that the app can't pass on.
4. In `mobile/.env`:
   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id>.apps.googleusercontent.com
   ```
5. Rebuild (`npx expo run:ios` / `run:android`). The iOS URL scheme is added automatically from the iOS client ID. The "Continue with Google" button appears only when these are set.

### 3. Make yourself admin (after your first login)
In the SQL Editor:
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

## Phase 5 setup you must do (push notifications, optional)

The in-app notification inbox, live order status and toasts already work everywhere (web too) with no setup. These steps only add **push notifications when the app is closed**, on phones:

1. **Realtime check:** Supabase dashboard → Database → Publications → `supabase_realtime` should include `orders` and `notifications` (the migration adds them).
2. **Expo project id** (needs your Expo account): in `mobile/` run `npx eas-cli login` then `npx eas-cli init`, and put the printed project id in `mobile/.env` as `EAS_PROJECT_ID=...`.
3. **Android (FCM, free):** create a Firebase project → add an Android app with package `in.nearkart.app.development` (and `in.nearkart.app` for production) → download `google-services.json` into `mobile/` (git-ignored) and add `android.googleServicesFile: './google-services.json'` in `app.config.ts`. Upload the FCM V1 service-account key with `npx eas-cli credentials` → Android → Push Notifications. iOS push needs the paid Apple Developer Program.
4. **Rebuild once** (new native modules: notifications, image picker, print, sharing): `npx expo run:ios` / `npx expo run:android`.
5. **Deploy the function and secrets** (from the project root):
   ```bash
   npx supabase functions deploy send-push --no-verify-jwt
   npx supabase secrets set PUSH_WEBHOOK_SECRET=<long-random-string>
   # optional, if you enable "enhanced push security" in Expo:
   npx supabase secrets set EXPO_ACCESS_TOKEN=<expo access token>
   ```
6. **Tell the database where to send pushes** (SQL Editor, same secret as above):
   ```sql
   select vault.create_secret('https://tclflrlrzoyuaoswkpwb.supabase.co/functions/v1/send-push', 'send_push_url');
   select vault.create_secret('<the same long-random-string>', 'send_push_secret');
   ```
   Until these two Vault secrets exist, the trigger simply skips push (the inbox still fills).
7. Test: log in on a phone, allow notifications, then change one of your orders' status in the Table Editor. A push should arrive within a few seconds when the app is in the background.

## Phase 6: MVP complete. Test a full order with two browsers

The customer and store flows are now both built. To try a real order end to end:

1. **Make a staff (or admin) account.** Log in once in the app with the email you'll use at the counter, then in Supabase → SQL Editor:
   ```sql
   update public.profiles set role = 'staff'   -- or 'admin'
   where id = (select id from auth.users where email = 'counter@example.com');
   ```
   Log out and in again (or reload) so the app sees the new role. **Account → Store mode** appears.
2. **Open two browser windows** (one normal, one private/incognito so the logins don't mix):
   - Window A: `http://localhost:8081`, logged in as a **customer**. Add items, save an address inside the delivery area, place a COD order.
   - Window B: `http://localhost:8081/store`, logged in as **staff**. Tap **Tap to enable sound** once. The order appears in **New** within a second and the alarm loops.
3. In window B: **Accept order**, tick items (packing starts), try **Not available** on one line, **Mark packed**, then **Out for delivery** and **Mark delivered**. Print the pick list or invoice.
4. Window A shows each step live on the order page, plus a notification.
5. Also try: pausing the store from **Store** (window A's Home shows closed and checkout is blocked), stock changes from **Stock** (window A's product updates live), and leaving an order unaccepted to watch it auto-cancel.

On phones: rebuild once (`npx expo run:android` / `run:ios`), because the alarm sound (expo-audio), keep-awake and the camera barcode scanner are new native modules. Until then the board works without sound, and the stock screen offers typed search only.

## Phase 7: admin, real product photos

1. Make yourself admin (SQL in "Make yourself admin" above), then open **Account → Admin**. Best on a laptop: `npx expo start --web` → `http://localhost:8081/admin`.
2. **Products → Edit → Photos → Add image**: pick one or more photos. Each is resized in the browser and uploaded to the `catalog` bucket (`products/<uuid>_full.jpg` + `_thumb.jpg`; on phones `.webp`), then **Save**. Customers see them right away.
3. Category tiles, banners and collection images: use the image field on those editors (uploads to `categories/`, `banners/`, `collections/`). Banner images from the seed that don't exist yet can simply be replaced here.
4. Many products at once: **Products → Import / export → Download CSV**, edit in Excel/Sheets, then **Choose CSV → Check → Import**.

Phones: no new native modules in Phase 7. Photo upload uses expo-image-picker/manipulator (added in Phase 5), so phones need that rebuild; CSV import/export is web only.

## Phase 8: share links, wishlist, reviews, campaigns

- **Nothing to rebuild** for Phase 8 itself: no new native modules. Rebuild the phone app only after you set an https `EXPO_PUBLIC_WEB_URL` (that adds the Android App Link intent filters).
- **Share links**: until `web/` is deployed, shared links point to `EXPO_PUBLIC_WEB_URL` (`http://localhost:8081` in dev, which opens the web app's `/p/<slug>` route).
- **Deploy the web pages** (your Cloudflare account; free): steps in [`web/README.md`](../../web/README.md). In short: Pages → connect the repo, root `web`, output `public`, env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `APP_PACKAGE`, `PLAY_URL`; then set `EXPO_PUBLIC_WEB_URL=https://nearkart-web.pages.dev` in `mobile/.env` and rebuild.
- **App Links verification**: put the release signing SHA-256 into `web/public/.well-known/assetlinks.json` (Play Console → App integrity) and redeploy.
- **Domain (optional)**: add a custom domain in Pages, update `EXPO_PUBLIC_WEB_URL`, rebuild.
- **Try it**: as admin, open `/admin/campaigns` → write a title/message → **Send test to me** → check the 🔔 inbox. Reviews need a delivered order: deliver one from Store mode, then open the order → **Rate items**. Review prompts are queued by `pg_cron` daily at 11:00 IST for orders delivered 20–48 h earlier.

## Deferred work (not needed for a working app right now)

> The current, complete to-do list is [`REMAINING_WORK.md`](REMAINING_WORK.md). Items below are kept for history; ✅ = done since.

### Needed before the matching phase ships
- [x] ~~**Edge Functions** for Phase 10 not yet extracted into `supabase/functions/` (code is in the docs): `create-payment`, `verify-payment`, `razorpay-webhook`, `process-refunds`, `reconcile-payments`. (`send-push` is done.)~~ ✅ done: functions are in `supabase/functions/`
- [ ] **`supabase/README.md`**: how to link, push, set secrets (`supabase secrets set`), deploy functions, configure Google + email (Brevo SMTP) auth, and the Vault secrets for push.
- [x] ~~**Build the UI for Phase 10** (UPI payments). Phases 0–9 are done; the database for Phase 10 is already deployed.~~ ✅ done: Phase 10 UI built, switched off until keys

### Quality / verification
- [ ] **To place a test order (Phase 4)**: log in, save an address inside the delivery area, and make sure the store is open (`stores.opening_hours` / `is_accepting_orders`). If live cart sync between two devices doesn't work, check that Realtime in the dashboard allows private channels (the policy on `realtime.messages` is in the p4 migration).
- [ ] **Product images**: upload WebP files to the `catalog` bucket at the seed paths (e.g. `banners/fresh-veggies.webp`, `categories/milk.webp`); add `product_images` rows (or wait for the Phase 7 admin).
- [ ] Confirm Realtime is enabled for `inventory`, `product_variants`, `stores` in the dashboard (Database → Publications).
- [ ] **pgTAP tests**: `node tools/sqlcheck/run_tests.mjs` passes 56/56 in 6 files; `0500`, `0600` and `20_rls_customer_data` use psql meta-commands and only run with `supabase test db` (needs Docker).
- [ ] Things the local checker **only stubs**, so they're untested until a real Supabase project: Realtime delivery, `pg_cron` actually running jobs, `pg_net` + Vault (push webhook), Storage bucket policies, Auth (Google / email OTP).
- [ ] Run the app on a **real device / simulator** (the encrypted session storage on a phone is untested).
- [ ] `expo-doctor` wants Jest 30 (project has 29); tests pass, upgrade when convenient.
- [ ] Husky + lint-staged (pre-commit hooks) not added.

- [ ] **Share-card image** (photo + price card for WhatsApp) needs `react-native-view-shot` and a rebuild; links + Open Graph previews from `web/` cover it for now.
- [x] ~~Ratings on product cards: `catalog_product_cards` doesn't return `rating_avg/rating_count` (would need a migration).~~ ✅ done: migration `20261101121000_card_ratings.sql`

### Phase 9 leftovers
- [ ] **Crash reporting**: no SDK bundled. To add Sentry: `npx expo install @sentry/react-native`, add its plugin + Metro wrapper, `Sentry.init` with `EXPO_PUBLIC_SENTRY_DSN`, then `setCrashReporter(...)` in `src/lib/crash.ts`. **Needs a rebuild.**
- [ ] **Legal pages**: fill every `[FILL]` in `web/public/*.html`, deploy `web/`, then set `app_config.legal_urls` (SQL in `web/README.md`).
- [ ] **Version numbers**: this build now reports **1.0.0** (was 0.1.0); `app_config.min_app_version` (0.1.0) and `latest_app_version` (1.0.0) already match, so no banner shows. Bump `APP_VERSION` / `ANDROID_VERSION_CODE` per release.
- [ ] Rebuild the phone app once to pick up the new version/permissions (`npx expo run:android --device`). No new native modules were added in Phase 9.
- Release steps: see [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

### Docs drift (the code is now the source of truth)
- [ ] `docs/not-required/REACT_NATIVE_PLAN.md` and `docs/not-required/phases/00_PHASES_OVERVIEW.md` still use the original names in places. Update them for:
  - Cart sync uses a **private Broadcast channel** `cart:<uid>`.
  - Order notifications share the `my-orders` channel.
  - Image paths are `products/<uuid>_full.webp` / `_thumb.webp` / `_share.jpg`.
  - Phase 10 has **two** migrations and new statuses `awaiting_payment` / `partially_refunded`.
  - Marking an item unavailable changes stock by reason.
  - Extra tables: `refunds`, `payment_webhook_events`, `payment_mismatches`, `rate_limits`, `admin_audit_log`, `campaigns`, `notification_preferences`, `order_status_transitions`.
  - `mobile/` uses `src/app/` routes.
- [ ] The phase files still contain the full SQL inline. Replace it with links to `supabase/migrations/*`, since the migrations were fixed and the copies in the docs are older.
- [ ] Phase 3 deviation: **no map pin** in the address form. Location comes from GPS + reverse geocoding, and the text fields stay editable. A draggable pin (MapLibre on Android, Apple Maps on iOS) can be added later.
- [ ] Mobile deviations from PHASE_0 to note in the docs:
  - plain StyleSheet + theme tokens instead of NativeWind
  - `expo-sqlite` key-value store instead of MMKV
  - a Modal-based Sheet instead of `@gorhom/bottom-sheet`

## Handy commands

```bash
# Database check (no Docker needed)
cd tools/sqlcheck && npm install && node run.mjs          # migrations + seed + 49 smoke checks
node run_tests.mjs                                        # pgTAP tests (some still failing)

# App checks
cd mobile && npx tsc --noEmit && npx expo lint && npm test
```

## Test accounts without email codes (development only)

`EXPO_PUBLIC_DEV_PASSWORD_LOGIN=true` in `mobile/.env` shows an email + password login on the login screen in **development builds only** (`__DEV__`); release builds never show it.

1. Supabase dashboard → Authentication → Users → **Add user → Create new user** → email + password, tick **Auto Confirm User**.
2. Restart Metro with `--clear`, then log in with that email + password.
3. Make it staff/admin with the SQL above (use its email).

Before release: set `EXPO_PUBLIC_DEV_PASSWORD_LOGIN=` (empty) and delete the test users.

## Addresses: any location, delivery checked at checkout (2026-10-17)

- New migration `supabase/migrations/20261101110000_address_location_optional.sql`:
  - address GPS (latitude/longitude/location) is optional
  - `stores.serviceable_pincodes` (Amravati 444601–444607 set for the seeded store)
  - `private.serviceability_for_address()`: GPS point if present, otherwise the pincode list
  - the address trigger, `_quote()` and `place_order()` now use it
- **Apply it:** `npx supabase db push`, then `cd mobile && npm run gen:types:cloud`. `src/types/database.ts` was hand-edited to match until then.
- **App:** the address form saves without GPS (GPS only fills fields) and the address book no longer shows "not delivering here". Checkout and the location picker still do, and `place_order` refuses `NOT_SERVICEABLE`.
- **Edit the pincode list** in the SQL Editor until the admin store-settings screen gets a field for it:
  `update public.stores set serviceable_pincodes = array['444601','444602'] where id = 1;`
- Checked by `tools/sqlcheck` (52/52, with 3 new checks) and the mobile tests (107/107).

## ⚠️ Before launch: `supabase.co` blocked on some Indian networks

On the Android test phone, every call failed with `UnknownHostException: Unable to resolve host "<ref>.supabase.co"` while the Mac worked. Some Indian ISPs/mobile networks (Jio reported) block `*.supabase.co` at DNS.
- **Testing workaround:** phone → Private DNS → `dns.google` (or `one.one.one.one`), or use another network.
- **Real fix (customers can't change DNS):** serve Supabase from your own domain, either a Supabase custom domain (paid, Pro plan) or a free Cloudflare Worker proxy at `api.<yourdomain>` covering REST, Auth, Storage and Realtime websockets. Then set `EXPO_PUBLIC_SUPABASE_URL` to that domain. Needs a domain (~₹500–900/yr).

## Phase 10: online payments (UPI / cards via Razorpay), built but switched off

**Built, no account needed yet:**
- The database was already deployed (p10 migrations).
- Edge Functions in `supabase/functions/`: `create-payment`, `verify-payment`, `razorpay-webhook`, `process-refunds`, `reconcile-payments`, plus `_shared/razorpay*.ts`.
- HMAC tests: `node --test supabase/functions/tests/razorpay-core.test.mjs`.
- App:
  - checkout payment choice (online shows "Coming soon" until enabled)
  - pay / retry / switch-to-COD banner with countdown on the order screen
  - refund status card
  - Admin → Refunds (manual close)
  - payments daily report
- Online stays off while `stores.upi_enabled = false` (the default). The functions answer `payments_not_configured` until keys are set, and the app then shows "choose pay on delivery".

**Turning it on later:**
1. Create a Razorpay account and stay in **Test Mode** first. Dashboard → Account & Settings → API Keys → generate **Key ID** + **Key Secret**.
2. Set the function secrets:
   ```bash
   npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx \
     RAZORPAY_WEBHOOK_SECRET=<long random> INTERNAL_CRON_SECRET=<long random>
   ```
3. Deploy the functions:
   ```bash
   npx supabase functions deploy create-payment verify-payment
   npx supabase functions deploy razorpay-webhook process-refunds reconcile-payments --no-verify-jwt
   ```
4. Razorpay Dashboard → **Webhooks** → URL `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`. Use the same secret as `RAZORPAY_WEBHOOK_SECRET`. Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
5. Supabase → **Vault**: add secrets `process_refunds_url` (`https://<ref>.supabase.co/functions/v1/process-refunds`), `reconcile_payments_url` (`…/reconcile-payments`) and `internal_cron_secret` (same value as `INTERNAL_CRON_SECRET`). The cron jobs are already scheduled and wait for these.
6. Turn it on: `update public.stores set upi_enabled = true where id = 1;`
7. **Rebuild the phone app** (`npx expo run:android`), because `react-native-razorpay` is a new native module. Web works without a rebuild.
8. Test with Razorpay test UPI `success@razorpay` (and `failure@razorpay`): order → Placed within seconds. Cancel a paid order → a refund appears and is processed.
9. Go live: complete KYC, generate **live** keys, set them with step 2, add a live-mode webhook, and test on a **release** APK.

⚠️ Razorpay charges about 2% per online payment (more on some cards). Refunds don't return the fee. Instant refunds (`speed: optimum`) cost extra; the code uses `normal`.

## Round 1 fixes (2026-10-17): 2 new migrations (✅ pushed)

- **New migrations** (not on the Supabase project yet):
  - `20261101120000_store_settings_pincodes_upi.sql`: `admin_update_store_settings` now saves `serviceable_pincodes` (6-digit, deduped, ≤200), `upi_enabled`, `payment_hold_minutes` (5–60). Admin → Store settings has **Delivery pincodes** and **Online payments (UPI)** sections.
  - `20261101121000_card_ratings.sql`: product cards carry `rating_avg` / `rating_count` (stars on cards).
- **Apply them:** `npx supabase db push`, then `cd mobile && npm run gen:types:cloud`. No hand edits to `src/types/database.ts` were needed (both functions return JSON).
- **App fixes:**
  - **Confirmations on web:** confirmations work in the browser (`src/lib/confirm.ts`).
  - **Logged-out guard:** protected screens show a login prompt when logged out (`src/features/auth/LoginRequired.tsx`).
  - **Back after save:** "save then go back" works on web without history (`src/lib/navigation.ts`).
  - **Route list:** all routes are listed in `Stack.Protected`.
  - **Image placeholders:** category-icon placeholders and designed banner placeholders.
- **Checks:** `tools/sqlcheck` 56/56 (4 new: card ratings, settings save, invalid pincode, staff forbidden); mobile tests 114/114.
