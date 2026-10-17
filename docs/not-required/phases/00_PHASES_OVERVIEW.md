# Phases Overview: Implementation Chart

Companion to [`REACT_NATIVE_PLAN.md`](../REACT_NATIVE_PLAN.md). Each phase has its own file (`PHASE_0.md` … `PHASE_10.md`). Every phase ships **three things together**:

1. **UI** (Expo / React Native screens and components)
2. **Supabase SQL** (a migration in `supabase/migrations/`: tables, RLS policies, RPCs, triggers, Realtime publication)
3. **Tests** (Jest/RNTL for the app, pgTAP for the SQL)

There is no custom backend server. Supabase *is* the backend.

## Flow

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ══► MVP: FIRST REAL ORDERS
Foundation  Catalog &   Search &    Accounts &  Cart &      Live orders  Store
+ Supabase  Home (live  Discovery   Addresses   Checkout    & notifs     operations
            stock)                              (COD)
                                                                              │
                                                                              ├──► Phase 7  Admin: catalog, merchandising, reports
                                                                              ├──► Phase 8  Engagement & growth
                                                                              ▼
                                                                         Phase 9  Hardening & release ══► v1.0 on Play Store
                                                                              │
                                                                              ▼
                                                                         Phase 10 Online payments (UPI) ══► v1.1
                                                                              ┊
                                                                         Later: riders & live delivery tracking, coupons, multi-store
```

> **Seed data first, admin screens later.** Phases 1–6 use `supabase/seed.sql` (and Supabase Studio) to load categories and products, so the customer flow and store flow can be built and tested before the admin catalog editor (Phase 7). If you want to go live before Phase 7, products can be managed in Supabase Studio's table editor.

## Chart

| Phase | Goal | Implementation headings | Supabase SQL | Done when… | Depends on | Est. |
|---|---|---|---|---|---|---|
| **0. Foundation & Supabase setup** | A themed, multilingual skeleton talking to Supabase | 0.1 Repo layout<br>0.2 Expo + TS strict + Expo Router<br>0.3 Lint/format/hooks<br>0.4 Env config<br>0.5 Theme, NativeWind, fonts<br>0.6 Design-system primitives<br>0.7 i18n + `localize()`<br>0.8 Supabase project, CLI & local stack<br>0.9 Supabase client, TanStack Query, MMKV<br>0.10 Generated DB types<br>0.11 CI | `0000_foundation.sql`: extensions, enums, `set_updated_at()`, `profiles`, `handle_new_user`, `is_staff/is_admin`, role-protection trigger, `app_config` | App runs on Android & iOS with placeholder tabs, switches language/theme, reads `app_config` from Supabase, CI green | — | 1 wk |
| **1. Catalog & Home** | Browse every category and product with live stock | 1.1 Catalog schema & seed<br>1.2 Storage bucket & image helpers<br>1.3 Navigation shell + floating cart bar slot<br>1.4 Home (dynamic sections, banners)<br>1.5 Categories tab<br>1.6 Category screen (sub-category rail + grid)<br>1.7 Product card & ADD stepper<br>1.8 Product detail & variants<br>1.9 Attribute display registry<br>1.10 Live stock & price via Realtime<br>1.11 Store status header<br>1.12 Loading/empty/error/offline | `0100_catalog.sql` (stores, categories, brands, products, variants, images, inventory, `list_products`, `store_status`), `0110_home.sql` (banners, collections, home_sections, `get_home`), `seed.sql` | A guest browses Home → category → product in 3 languages and sees stock change live when it's edited in Studio | 0 | 1.5–2 wk |
| **2. Search & Discovery** | Find anything in any language | 2.1 Search schema (trigram, synonyms, logging)<br>2.2 Search screen (instant, recent, trending)<br>2.3 Suggestions & voice search<br>2.4 Filters & sort sheet (schema-driven)<br>2.5 Zero-result capture<br>2.6 "Notify me" for out-of-stock<br>2.7 Similar & often-bought-together | `0200_search.sql` (`search_synonyms`, `search_queries`, `stock_alerts`, `search_products`, `search_suggestions`, `related_products`, `notify_back_in_stock` trigger) | Searching "doodh", "दूध" or "milk" finds milk; zero-result searches are logged; "Notify me" is saved | 1 | 1 wk |
| **3. Accounts, Addresses & Serviceability** | Know who and where | 3.1 Supabase Auth: Google + email OTP<br>3.2 Session & login gate<br>3.3 Profile & settings<br>3.4 Location onboarding<br>3.5 Address book & map pin<br>3.6 Serviceability check<br>3.7 Store open/closed rules<br>3.8 Delete account | `0300_accounts_addresses.sql` (`addresses`, `check_serviceability`, `delete_my_account`) | A user logs in, saves an address that's checked against the delivery area, and sees "Not delivering here yet" outside it | 1 | 1 wk |
| **4. Cart & Checkout (COD)** | Turn a cart into a real order safely | 4.1 Cart & order schema<br>4.2 Guest cart (MMKV) + server cart + merge<br>4.3 Live cart quote<br>4.4 Cart screen & bill details<br>4.5 Checkout: address, COD, note<br>4.6 `place_order` (locks, idempotency, limits)<br>4.7 Order placed screen<br>4.8 Edge cases & error copy | `0400_cart_orders.sql` (`cart_items`, `orders`, `order_items`, `order_status_events`, `inventory_movements`, `merge_guest_cart`, `get_cart_quote`, `place_order`, order number sequence) | Two phones racing for the last item: exactly one order succeeds; prices/fees always match the server; double-tap creates one order | 3 | 1.5 wk |
| **5. Orders: Live Tracking & Notifications** | Customer sees everything live | 5.1 Orders tab (active + past)<br>5.2 Live order detail & timeline<br>5.3 Cancel order<br>5.4 Reorder<br>5.5 Invoice PDF<br>5.6 Report an issue (photos)<br>5.7 In-app notifications inbox<br>5.8 Push: tokens, Edge Function, webhook | `0500_order_tracking_notifications.sql` (`notifications`, `push_tokens`, `order_issues`, `cancel_order`, `notify_order_status` trigger, `issues` bucket, Realtime on orders/notifications) | Status changed in Studio shows on the customer phone within ~1 s; push arrives when the app is closed | 4 | 1 wk |
| **6. Store Operations** | The store can run the day from a tablet | 6.1 Store mode shell & role guard<br>6.2 Live orders board + new-order alarm<br>6.3 Staff order screen & pick checklist<br>6.4 Status flow & item unavailable<br>6.5 Pick list & invoice printing<br>6.6 Stock screen & barcode scan<br>6.7 Store switch & busy mode<br>6.8 Auto-cancel job<br>6.9 Staff notifications | `0600_store_ops.sql` (`staff_set_order_status`, `staff_mark_item_unavailable`, `staff_adjust_stock`, `staff_set_stock`, `staff_set_store_open`, `auto_cancel_stale_orders` + `pg_cron`, staff RLS) | **MVP:** a real order placed on one phone rings on the store tablet, is packed and delivered, and the customer sees each step live | 5 | 1.5 wk |
| **7. Admin: Catalog, Merchandising & Reports** | No-code management | 7.1 Admin shell & web build<br>7.2 Category & sub-category editor<br>7.3 Attribute schema builder + live preview<br>7.4 Product & variant editor (runtime zod)<br>7.5 Image upload (2 sizes)<br>7.6 CSV import/export<br>7.7 Banners, home sections, collections<br>7.8 Store settings & fees<br>7.9 Users & roles<br>7.10 Dashboard & reports | `0700_admin.sql` (`admin_upsert_product`, `admin_import_products`, `admin_set_role`, `validate_product_attributes` trigger, report views, `catalog` bucket write policies) | Admin creates a new category with custom attributes and a product in it from the app/web, and it appears for customers with no release | 6 | 1.5–2 wk |
| **8. Engagement & Growth** | Bring people back | 8.1 Wishlist<br>8.2 Buy again<br>8.3 Ratings & reviews (verified buyers)<br>8.4 Share product + deep links<br>8.5 Web product pages (Cloudflare Pages)<br>8.6 Notification preferences & campaigns<br>8.7 Launch playbook | `0800_engagement.sql` (`wishlist`, `reviews`, rating aggregates, `buy_again`, notification prefs) | Users can save, rate (only after delivery), and share a product link that opens the app or a web page | 6 | 1 wk |
| **9. Hardening & Release** | Store-ready and stable | 9.1 Offline & cache tuning<br>9.2 Performance pass<br>9.3 Accessibility<br>9.4 Sentry & monitoring<br>9.5 Test suite (pgTAP, RNTL, Maestro)<br>9.6 Security review (RLS, advisors, abuse limits)<br>9.7 Free-tier limits & keep-alive<br>9.8 Legal pages & seller info<br>9.9 Force update & maintenance mode<br>9.10 Store listing & staged rollout | `0900_hardening.sql` (rate-limit helpers, indexes from `EXPLAIN`, advisor fixes) | v1.0 live on the Play Store | all | 1 wk |
| **10. Online Payments (UPI)** | Pay before delivery | 10.1 Razorpay account & keys<br>10.2 Payments schema<br>10.3 `create-payment` Edge Function<br>10.4 Checkout payment step<br>10.5 Webhook verification<br>10.6 Refunds on cancel / item unavailable<br>10.7 Reconciliation report | `1000_payments.sql` (`payments`, payment status flow, pending-payment stock hold) | A UPI order is marked paid only after a verified webhook; cancelled paid orders are refunded | 9 | 1–1.5 wk |

**Total:** about 11–13 weeks to v1.0 (Phases 0–9). **MVP = Phases 0–6** (about 8–9 weeks): real COD orders, end to end.

## Phase files

| Phase | File |
|---|---|
| 0. Foundation & Supabase setup | [PHASE_0.md](PHASE_0.md) |
| 1. Catalog & Home | [PHASE_1.md](PHASE_1.md) |
| 2. Search & Discovery | [PHASE_2.md](PHASE_2.md) |
| 3. Accounts, Addresses & Serviceability | [PHASE_3.md](PHASE_3.md) |
| 4. Cart & Checkout (COD) | [PHASE_4.md](PHASE_4.md) |
| 5. Orders: Live Tracking & Notifications | [PHASE_5.md](PHASE_5.md) |
| 6. Store Operations | [PHASE_6.md](PHASE_6.md) |
| 7. Admin: Catalog, Merchandising & Reports | [PHASE_7.md](PHASE_7.md) |
| 8. Engagement & Growth | [PHASE_8.md](PHASE_8.md) |
| 9. Hardening & Release | [PHASE_9.md](PHASE_9.md) |
| 10. Online Payments (UPI) | [PHASE_10.md](PHASE_10.md) |

## Later (not planned in detail yet)

| Idea | Notes |
|---|---|
| **Delivery partners & live tracking** | Rider mode in the same app, order assignment, live GPS on a map (Realtime broadcast), delivery OTP, COD cash collection report. The `out_for_delivery` status and timestamps already exist. |
| Coupons & offers | `coupons` table + validation inside `get_cart_quote` / `place_order` |
| Scheduled slots & subscriptions | "Milk every morning at 7" |
| Multiple dark stores | Nearest serviceable `stores` row per address; inventory is already per store |
| Wallet / loyalty | Needs payments first |

## Costs

| Item | Cost | Needed? |
|---|---|---|
| Supabase Free | ₹0 (500 MB DB, 1 GB storage, 5 GB egress, 50k MAU, ~200 Realtime connections). Pauses after 7 days of no activity. | Yes. Move to Pro (⚠️ ~US$25/month) when you have daily orders, for no pausing, daily backups and more room. |
| Google Play developer account | US$25, one-time | To publish on the Play Store |
| Apple Developer Program | ⚠️ annual fee | Only for the App Store and iOS push |
| Login | ₹0 | Google + email OTP (free SMTP such as Brevo). Phone OTP is skipped (SMS is paid). |
| Push notifications | ₹0 | Expo Push + FCM |
| Web admin & product pages | ₹0 | Cloudflare Pages |
| Domain | ~₹500–900/year | Optional, needed for nice share links (Phase 8) |
| Razorpay (Phase 10) | ⚠️ ~2% per online transaction, no setup fee | Only when online payments start |

## What each phase file contains

For every heading (e.g. `4.6 place_order`):
- **Goal:** what this step achieves
- **Files:** exact paths in `mobile/` and `supabase/`
- **SQL:** the migration part, with RLS policies
- **Steps:** ordered tasks with code sketches
- **Checks:** how to verify it works
- **Tests:** what to test
