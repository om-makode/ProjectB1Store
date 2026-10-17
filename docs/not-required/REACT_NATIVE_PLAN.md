# NearKart: Real-time Quick-Commerce App (React Native + Supabase)

> A **Blinkit-style** grocery & essentials app for one town: people browse categories and products in **Marathi, Hindi or English**, see **live stock and prices**, fill a cart and place a **Cash-on-Delivery** order. The store sees the order **the second it is placed**, packs it, and the customer watches the status change **live**.
>
> *NearKart* is a working name. Change it in `app.config.ts` and the store listing.

**Decisions locked for this plan**

| Topic | Decision |
|---|---|
| Business model | **Single store, own inventory** (Blinkit-style). The schema has a `stores` table so more dark stores can be added later without a rewrite. |
| Backend | **Supabase only** (Postgres + Auth + Realtime + Storage + Edge Functions + pg_cron). **No custom server.** All business rules live in SQL: tables, Row Level Security (RLS), and Postgres functions (RPCs). |
| Payments | **Cash on Delivery** in v1. **UPI/online** is a later phase (Phase 10). |
| Delivery | **Out of scope for now.** The app ends at "order received → packed → handed over → delivered", with statuses set by store staff. No rider app, no live map tracking yet. The data model leaves room for it. |
| Languages | **EN / मराठी / हिंदी** for UI and content (`{en, mr, hi}` JSON). |
| Categories | **Admin-defined, no-code.** Categories, sub-categories, product attributes and filters are data. A new category needs no app release. |
| Order of work | **UI first**, with each phase shipping the **Supabase SQL it needs** alongside it. |
| Cost | Free tiers only until real traffic. Every place money can appear is marked ⚠️. |

---

## Table of Contents

1. [What "real" means for this app](#1-what-real-means-for-this-app)
2. [Who uses it](#2-who-uses-it)
3. [Customer experience (Blinkit-style)](#3-customer-experience-blinkit-style)
4. [Store operations experience](#4-store-operations-experience)
5. [Real-time design](#5-real-time-design)
6. [Tech stack](#6-tech-stack)
7. [App architecture & folders](#7-app-architecture--folders)
8. [Supabase data model](#8-supabase-data-model)
9. [Business rules in Postgres (RPCs, triggers, jobs)](#9-business-rules-in-postgres-rpcs-triggers-jobs)
10. [Security](#10-security)
11. [Legal & compliance for selling online in India](#11-legal--compliance-for-selling-online-in-india)
12. [Performance, offline & low-end phones](#12-performance-offline--low-end-phones)
13. [Testing](#13-testing)
14. [Roadmap](#14-roadmap)
15. [Out of scope for now](#15-out-of-scope-for-now)
16. [What was removed from the old plan](#16-what-was-removed-from-the-old-plan)

---

## 1. What "real" means for this app

A demo shows products and a cart. A real quick-commerce app has to survive the things that go wrong on a busy evening. This plan is built around them:

| Real-world problem | How the plan handles it |
|---|---|
| Two people buy the last packet of milk at the same time | `place_order()` locks stock rows (`SELECT … FOR UPDATE`) and decrements in one transaction. Only one order wins; the other sees "Only 0 left" **before** paying anything. |
| Price changed while the item sat in the cart | The cart is re-priced by the server (`get_cart_quote()`) every time it opens and on every Realtime price/stock change. The total on screen is never computed on the phone. |
| Customer double-taps "Place order" on a slow network | Each checkout carries an `idempotency_key`. The second call returns the same order instead of creating a duplicate. |
| Store is closed, or too busy | `stores.is_accepting_orders` + opening hours. The app shows a live "Store closed. Opens at 7:00 AM" banner and checkout is blocked on the server too. |
| Address outside the delivery area | `check_serviceability(lat, lng)` (PostGIS distance or polygon). Checked when the address is saved **and** again in `place_order()`. |
| Staff miss a new order | New orders arrive on the store tablet over Realtime with a loud repeating alert, a badge, and the screen kept awake. Orders not accepted within N minutes are **auto-cancelled** by `pg_cron`, and the customer is told. |
| An item is damaged or missing while packing | Staff mark that line "unavailable". The total is recalculated, stock is corrected, and the customer gets a live update ("1 item unavailable, new total ₹412"). |
| Fake COD orders | COD only for logged-in users, a max COD order value, a per-user limit on open orders, and an admin "block user" switch. |
| "I searched for *doodh* and found nothing" | Search matches EN/MR/HI names plus admin-managed synonyms (`doodh → milk`, `दूध`). Every zero-result search is logged so the owner knows **what to stock next**. |
| Out of stock, customer leaves | "Notify me" on out-of-stock items. When stock comes back, a trigger sends the notification. |
| Free tier limits | Images are resized on the phone before upload (Supabase image transforms are paid ⚠️). Realtime channels are kept few and filtered. The free project pauses after 7 days of inactivity, so a free uptime ping is set up. |
| Need to prove what happened | Every order status change and every stock change is written to an audit table (`order_status_events`, `inventory_movements`). |
| GST invoice, MRP, FSSAI | Product pages show MRP, net quantity, country of origin and manufacturer details (required by the E-Commerce Rules). Orders store an immutable snapshot of prices and GST, and a printable invoice is generated (Section 11). |

---

## 2. Who uses it

| Role | Where | Can do |
|---|---|---|
| **Guest** | Customer app | Browse, search, see prices & live stock, add to cart (stored on the phone), change language |
| **Customer** (logged in) | Customer app | Plus: addresses, place COD orders, live order status, cancel (before packing), reorder, report an issue, wishlist, "Notify me", reviews |
| **Staff** | Same app, **Store mode** (phone/tablet), or the **web admin** on a laptop | Live orders board, accept/pack/hand over/deliver, mark items unavailable, print pick list & invoice, update stock, open/close store |
| **Admin** (owner) | Same as staff + admin screens | Everything above, plus: categories & attribute builder, products/variants/prices, banners & home layout, collections, fees & store settings, users & roles, reports |

One codebase. Store mode and admin screens are role-guarded routes. The same Expo app is also built for **web** and hosted free (Cloudflare Pages), so the counter laptop can run the admin in a browser.

---

## 3. Customer experience (Blinkit-style)

### 3.1 Navigation

```
Bottom tabs
  🏠 Home        location + ETA header, search bar, banners, category grid, product rails, "Buy again"
  🗂 Categories  all categories → category screen
  🧾 Orders      active order on top (live), past orders
  👤 Account     profile, addresses, language, wishlist, notifications, help, (staff) Store mode, (admin) Admin

Floating cart bar (on every browsing screen): "3 items · ₹245  View cart ›"
```

### 3.2 Key screens

| Screen | What makes it feel real |
|---|---|
| **Home** | Header "Delivering to 📍 Home, Rajapeth" + "Store open · ~20 min" (from `stores`). Admin-arranged sections (`home_sections`): banner carousel, category grid, product rails ("Bestsellers", "Fresh fruits", "Diwali specials"), "Buy again" (from past orders). Store-closed banner when closed. |
| **Category** | Blinkit layout: **sub-category rail on the left**, product grid on the right, sticky filter chips (from the category's `filters`) and sort. Infinite scroll. |
| **Product card** | Image, veg/non-veg mark, name, variant label ("500 g"), price with struck-through MRP and "12% OFF", **ADD** button that turns into a `− 2 +` stepper. "Only 3 left" when stock is low; greyed "Out of stock · Notify me" when 0. Updates live. |
| **Product detail** | Gallery, variant picker (500 g / 1 kg), price/MRP/discount, live stock, highlights (from attributes), description, **mandatory info** (MRP incl. taxes, net qty, manufacturer, country of origin, shelf life, FSSAI), "Similar products", "Often bought together". |
| **Search** | Instant results while typing (debounced), recent and trending searches, voice search (on-device, free), results in any of the 3 languages, synonyms. Zero results show "Tell us what you want" (logged). |
| **Cart** | Line items with steppers. **Live re-quote**: price changes and stock problems are highlighted ("Price changed ₹40 → ₹42", "Only 1 left, quantity reduced"). Bill details: item total, discount on MRP, delivery fee, small-cart fee, packaging fee, grand total, savings line. Progress hint "Add ₹55 more for free delivery". Address picker, COD, note to store. |
| **Order placed** | Success animation, order number, ETA, "Track order". |
| **Order detail (live)** | Status timeline (Placed → Confirmed → Packing → Packed → Out for delivery → Delivered) updating live; changed items shown; cancel button while allowed; "Call store"; "Report an issue" after delivery (photo + reason); invoice download; reorder. |
| **Addresses** | Use current location (expo-location) → pin on map → house/flat, landmark, label. Serviceability checked before saving. |
| **Login** | Only when needed (checkout, wishlist). One-tap Google or email code. Phone number is collected on the address form for the delivery contact. |

### 3.3 UX principles kept from the old plan

Language picker first, large touch targets, works with system font scaling, Noto Sans + Noto Sans Devanagari, ₹1,00,000 Indian grouping, skeleton loaders, cached data when offline, a retry button on every error, and screen-reader labels.

---

## 4. Store operations experience

This is what makes the business run. It is a first-class part of the app, not an afterthought.

| Screen | Details |
|---|---|
| **Live orders board** | Columns/tabs: **New · Accepted · Packing · Ready · Out · Done**. New orders appear instantly (Realtime) with a repeating sound until accepted, a vibration, and a countdown to auto-cancel. The screen stays awake (`expo-keep-awake`). |
| **Order (staff view)** | Customer name & phone (tap to call), address with a "Open in Maps" link, items with **pick checklist** (tick as you pick), "Mark unavailable" per line, next-status button, internal note. |
| **Pick list & invoice** | `expo-print` creates a PDF/print (works with A4 and most 58/80 mm Bluetooth/USB thermal printers through the OS print dialog). The invoice shows GSTIN, FSSAI, HSN and the tax breakup. |
| **Stock** | Search or **scan a barcode** (camera, `expo-camera`), then +/− stock, set "available" on/off, low-stock list, "searched but not found" list. Every change is logged with who did it. |
| **Store switch** | One big toggle: **Accepting orders / Paused**, plus opening hours and a "busy, ETA 40 min" override. |
| **Dashboard (admin)** | Today's orders, revenue, average order value, cancellations and their reasons, top products, low stock, zero-result searches. Plain SQL views, no paid analytics. |
| **Catalog (admin)** | Category builder (name in 3 languages, icon, image, sub-categories, **attribute fields** and filters), products with variants (SKU, barcode, MRP, price, max per order), images, bulk CSV import/export, banners, home sections, collections, search synonyms. |
| **Settings (admin)** | Delivery fee, free-delivery threshold, small-cart fee, packaging fee, minimum order, max COD value, auto-cancel minutes, service radius/area, FSSAI/GSTIN, staff roles, blocked users, minimum app version. |

---

## 5. Real-time design

Supabase Realtime (free tier ⚠️: about 200 concurrent connections and 2 million messages/month) carries the live parts. Rules: **few channels, always filtered, and Realtime is a hint to refetch, not the source of truth.** On every event the app invalidates the matching TanStack Query key and refetches through RLS-protected queries. Missed events (app in background, bad network) are covered by refetch-on-focus and refetch-on-reconnect.

| Channel | Source | Subscribed by | Effect |
|---|---|---|---|
| `inventory:store=<id>` | `postgres_changes` on `inventory` (UPDATE) | Customer app while a catalog or cart screen is open | Update stock badges / ADD buttons and re-quote the cart |
| `variants:prices` | `postgres_changes` on `product_variants` (UPDATE) | Customer app while the cart is open | Re-quote the cart, update visible prices |
| `my-orders:user=<uid>` | `postgres_changes` on `orders` filtered by `user_id` | Customer app while logged in | Live status timeline, toast "Your order is packed" |
| `my-notifications:user=<uid>` | `postgres_changes` on `notifications` (INSERT) | Customer & staff | Bell badge, in-app toast |
| `store:<id>` | `postgres_changes` on `stores` (UPDATE) | Everyone | Open/closed banner, ETA, fees |
| `store-orders:store=<id>` | `postgres_changes` on `orders` (INSERT, UPDATE) | Staff only (RLS) | Live orders board + new-order alarm |
| `my-cart:user=<uid>` | `postgres_changes` on `cart_items` | Customer, logged in | Same cart on phone and tablet |

**Push notifications** (when the app is closed): a trigger writes to `notifications` → a **Database Webhook** calls the `send-push` **Edge Function** → **Expo Push API** (free). Android uses FCM underneath; that needs a free Firebase project used **only** as the push channel (no Firebase SDK in the app). iOS needs the paid Apple Developer Program ⚠️.

**Background staff alerts:** if the store tablet is in the background, the push notification uses a high-priority Android channel with a custom sound.

---

## 6. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| App | **Expo SDK (latest) + React Native (New Architecture) + TypeScript strict** | Android, iOS and web (admin) from one codebase |
| Navigation | **Expo Router** (typed routes) | Deep links: `nearkart://product/amul-milk-500ml` and `https://<domain>/p/<slug>` |
| Backend | **Supabase** (`@supabase/supabase-js`) | Postgres 15+, Auth, Realtime, Storage, Edge Functions (Deno), `pg_cron`, `pg_trgm`, `postgis`, `unaccent` |
| DB workflow | **Supabase CLI** (`supabase init`, `supabase start` with Docker locally, `supabase db push`, `supabase gen types`) | All SQL in `supabase/migrations/*.sql`, in git, reviewed like code |
| Server state | **TanStack Query** | Cache, retries, pagination, optimistic cart, offline persistence |
| Client state | **Zustand** | Language, theme, guest cart, selected address, store-mode settings |
| Storage | **react-native-mmkv** | Query cache persister, guest cart, settings. Supabase session in `expo-secure-store` (via a small adapter). |
| Forms | **react-hook-form + zod** | Address form, product form, and the runtime schema for admin-defined attributes |
| Styling | **NativeWind** + design tokens | Dark mode, category colours |
| Lists | **@shopify/flash-list** | Product grids with thousands of items on 2 GB phones |
| Images | **expo-image** (+ blurhash) and **expo-image-manipulator** | Two WebP sizes made on upload (thumb 300 px, full 1080 px) |
| i18n | **i18next + react-i18next + expo-localization** | UI in EN/MR/HI. Content from `{en,mr,hi}` with fallback. |
| Auth | **Supabase Auth**: Google (native `@react-native-google-signin/google-signin` → `signInWithIdToken`) and **email OTP** | ⚠️ Phone OTP needs a paid SMS provider, so it is skipped. Supabase's built-in email sender is heavily rate-limited, so use a free SMTP (e.g. Brevo, ~300/day). |
| Location & maps | **expo-location**; pin picker with **react-native-maps** on iOS or **MapLibre** + free OSM tiles on Android | ⚠️ Google Maps SDK on Android needs a billing-enabled key. MapLibre avoids it. |
| Camera / barcode | **expo-camera** (built-in barcode scanning) | Staff stock screen |
| Printing | **expo-print** + **expo-sharing** | Pick list, invoice PDF |
| Push | **expo-notifications** + Expo Push API via Edge Function | Free |
| Keep awake / sound | **expo-keep-awake**, **expo-audio** | Store mode alarm |
| Crash reports | **Sentry** free Developer plan | |
| Testing | **Jest + React Native Testing Library**, **Maestro** E2E, **pgTAP** (`supabase test db`) for SQL & RLS | |
| CI | **GitHub Actions** | Lint, typecheck, unit tests, `supabase db lint`, pgTAP on a local Supabase |
| Builds | Local builds or EAS free quota | ⚠️ EAS cloud builds beyond the free quota cost money |
| Web admin hosting | **Cloudflare Pages** (free) | `npx expo export -p web` |

---

## 7. App architecture & folders

```
nearkart/
  mobile/                              # Expo app (customer + store mode + admin; also builds for web)
    app/                               # Expo Router: thin route files only
      _layout.tsx                      # providers: Query, i18n, theme, Supabase auth listener, Realtime manager
      (onboarding)/language.tsx
      (onboarding)/location.tsx
      (shop)/_layout.tsx               # bottom tabs + floating cart bar
      (shop)/index.tsx                 # Home
      (shop)/categories.tsx
      (shop)/orders.tsx
      (shop)/account.tsx
      category/[slug].tsx              # ONE screen for every category (sub-category rail)
      product/[slug].tsx               # ONE product detail
      search.tsx
      cart.tsx
      checkout/address.tsx
      order/[id].tsx                   # live order detail
      order/[id]/issue.tsx
      account/addresses/…  account/profile.tsx  account/wishlist.tsx  account/notifications.tsx
      auth/login.tsx
      store/_layout.tsx                # role guard: staff
      store/index.tsx                  # live orders board
      store/order/[id].tsx
      store/stock.tsx
      admin/_layout.tsx                # role guard: admin
      admin/index.tsx                  # dashboard
      admin/categories/…  admin/products/…  admin/home/…  admin/settings.tsx  admin/users.tsx
    src/
      lib/supabase.ts                  # createClient + SecureStore session adapter
      lib/realtime.ts                  # channel manager: subscribe/unsubscribe by screen, reconnect
      lib/format.ts                    # ₹, dates, quantities
      types/database.ts                # generated: supabase gen types typescript
      features/
        catalog/     { api.ts, hooks.ts, components/ProductCard.tsx, VariantPicker.tsx, AddButton.tsx, … }
        attributes/  { registry.tsx (field type → Display/Input/zod), buildZod.ts }
        search/
        cart/        { store.ts (guest), api.ts, useCartQuote.ts, CartBar.tsx, BillDetails.tsx }
        checkout/
        orders/      { api.ts, useLiveOrder.ts, StatusTimeline.tsx }
        addresses/
        auth/
        notifications/
        store-ops/   { useOrdersBoard.ts, NewOrderAlarm.tsx, PickList.tsx, printInvoice.ts }
        admin/
      ui/                              # Button, Text, Card, Chip, Stepper, Sheet, Skeleton, EmptyState, ErrorState, PriceTag, VegMark
      i18n/  { index.ts, en.json, mr.json, hi.json, localize.ts }
      theme/ { tokens.ts }
  supabase/
    config.toml
    migrations/                        # one or more files per phase (Section 14)
    seed.sql                           # demo store, categories, ~60 products
    functions/                         # Edge Functions (Deno): send-push, (later) payments
    tests/                             # pgTAP: RLS and RPC tests
  docs/                                # this plan + phases/
  .github/workflows/
```

**Rules**
- Route files compose feature components only. No Supabase calls in screens.
- All reads go through feature hooks (TanStack Query). **All writes that touch money or stock go through RPCs**, never direct table inserts from the app.
- Types come from `supabase gen types`, so the app breaks at compile time if the schema changes.
- `localize(value)` falls back `current language → en → first non-empty`.

---

## 8. Supabase data model

Conventions: `snake_case`; localized text is `jsonb` shaped `{"en": "...", "mr": "...", "hi": "..."}`; money is `numeric(10,2)` in rupees; every table has `created_at timestamptz default now()` and, where rows change, `updated_at` maintained by the shared `set_updated_at()` trigger. **RLS is enabled on every table.** Images are stored as Storage **paths**, not full URLs.

### 8.1 Enums

```sql
app_role          : 'customer' | 'staff' | 'admin'
order_status      : 'placed' | 'confirmed' | 'packing' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled'
payment_method    : 'cod' | 'upi'                       -- 'upi' used from Phase 10
payment_status    : 'pending' | 'paid' | 'failed' | 'refunded'
cancel_actor      : 'customer' | 'store' | 'system'
order_item_status : 'active' | 'unavailable'
stock_reason      : 'order' | 'order_cancel' | 'item_unavailable' | 'restock' | 'adjustment' | 'damage' | 'initial'
issue_type        : 'missing_item' | 'damaged' | 'wrong_item' | 'quality' | 'other'
issue_status      : 'open' | 'resolved' | 'rejected'
section_type      : 'banner_carousel' | 'category_grid' | 'product_rail' | 'collection_rail' | 'buy_again'
```

### 8.2 Tables (by phase)

| Table | Key columns | Phase |
|---|---|---|
| `profiles` | `id uuid PK → auth.users`, `full_name`, `email`, `phone`, `avatar_path`, `language text ('en','mr','hi')`, `role app_role default 'customer'`, `is_blocked bool`, `cod_allowed bool default true` | 0 |
| `app_config` | `key text PK`, `value jsonb` (min app version, maintenance mode, support phone) | 0 |
| `stores` | `id`, `name jsonb`, `address jsonb`, `location geography(Point)`, `service_radius_km numeric`, `service_area geography(Polygon) null`, `phone`, `whatsapp`, `gstin`, `fssai_license`, `opening_hours jsonb` (per weekday `[{open,close}]`), `is_accepting_orders bool`, `busy_message jsonb null`, `eta_minutes int`, `min_order_value`, `delivery_fee`, `free_delivery_above`, `small_cart_threshold`, `small_cart_fee`, `packaging_fee`, `max_cod_order_value`, `max_open_orders_per_user int`, `auto_cancel_minutes int`, `timezone text default 'Asia/Kolkata'` | 1 (fees used in 4) |
| `categories` | `id bigint`, `parent_id → categories null` (2 levels: category → sub-category), `slug unique`, `name jsonb`, `icon`, `image_path`, `color`, `sort_order`, `is_active`, `attribute_schema jsonb` (fields[]), `filters jsonb`, `schema_version int` | 1 |
| `brands` | `id`, `slug`, `name jsonb`, `logo_path` | 1 |
| `products` | `id bigint`, `category_id → categories` (a sub-category), `brand_id null`, `slug unique`, `name jsonb`, `description jsonb`, `attributes jsonb` (validated against the category schema), `is_veg bool null`, `tags text[]`, `hsn_code`, `gst_rate numeric(4,2)`, `country_of_origin`, `manufacturer jsonb`, `shelf_life text`, `is_active`, `sort_order`, `search_text text` (maintained by trigger from names/brand/tags/synonyms) | 1 |
| `product_variants` | `id bigint`, `product_id`, `sku unique`, `barcode`, `label jsonb` ("500 g"), `net_quantity numeric`, `unit text ('g','kg','ml','l','pc','pack')`, `mrp`, `price` (`check price <= mrp`), `max_per_order int default 10`, `is_default bool`, `is_active`, `sort_order` | 1 |
| `product_images` | `id`, `product_id`, `variant_id null`, `path`, `thumb_path`, `sort_order` | 1 |
| `inventory` | `store_id`, `variant_id`, `PK(store_id, variant_id)`, `stock int check >= 0`, `low_stock_threshold int default 5`, `is_available bool default true` (manual switch), `updated_at` | 1 |
| `banners` | `id`, `store_id`, `image_path`, `title jsonb`, `link jsonb` (`{type:'category'|'product'|'collection'|'search', value}`), `sort_order`, `starts_at`, `ends_at`, `is_active` | 1 |
| `collections` + `collection_products` | `id`, `slug`, `title jsonb`, `image_path`, `is_active` / `(collection_id, product_id, sort_order)` | 1 |
| `home_sections` | `id`, `store_id`, `type section_type`, `title jsonb`, `config jsonb` (e.g. `{collection_id}` or `{category_ids}`), `sort_order`, `starts_at`, `ends_at`, `is_active` | 1 |
| `search_synonyms` | `id`, `term text` (e.g. `doodh`, `दूध`), `maps_to text` (e.g. `milk`) | 2 |
| `search_queries` | `id`, `query`, `language`, `results_count`, `user_id null`, `created_at` | 2 |
| `stock_alerts` | `user_id`, `variant_id`, `PK`, `created_at`, `notified_at null` | 2 |
| `addresses` | `id uuid`, `user_id`, `label ('home','work','other')`, `receiver_name`, `receiver_phone`, `house`, `area`, `landmark`, `city`, `pincode`, `location geography(Point)`, `is_default`, `deleted_at null` | 3 |
| `cart_items` | `user_id`, `variant_id`, `quantity int check 1..50`, `PK(user_id, variant_id)`, `updated_at` | 4 |
| `orders` | `id uuid`, `order_number text unique` (`NK-261016-0042`), `user_id`, `store_id`, `address_id`, `address_snapshot jsonb`, `status order_status`, `payment_method`, `payment_status`, `item_total`, `mrp_total`, `delivery_fee`, `small_cart_fee`, `packaging_fee`, `grand_total`, `customer_note`, `staff_note`, `cancel_reason`, `cancelled_by cancel_actor`, `idempotency_key uuid` (`unique(user_id, idempotency_key)`), `placed_at`, `confirmed_at`, `packed_at`, `out_for_delivery_at`, `delivered_at`, `cancelled_at`, `updated_at` | 4 |
| `order_items` | `id`, `order_id`, `variant_id`, `product_id`, `name_snapshot jsonb`, `variant_label_snapshot jsonb`, `image_path`, `mrp`, `price`, `gst_rate`, `hsn_code`, `quantity`, `line_total`, `status order_item_status`, `picked bool` | 4 |
| `order_status_events` | `id`, `order_id`, `status`, `note`, `actor_id null`, `created_at` (audit + customer timeline) | 4 |
| `inventory_movements` | `id`, `store_id`, `variant_id`, `delta int`, `reason stock_reason`, `order_id null`, `note`, `actor_id null`, `created_at` | 4 (written from 4, UI in 6) |
| `notifications` | `id`, `user_id`, `type`, `title jsonb`, `body jsonb`, `data jsonb`, `read_at`, `created_at` | 5 |
| `push_tokens` | `token PK`, `user_id`, `platform`, `updated_at` | 5 |
| `order_issues` | `id`, `order_id`, `user_id`, `order_item_id null`, `type issue_type`, `message`, `photo_paths text[]`, `status issue_status`, `resolution_note`, `created_at`, `resolved_at` | 5 |
| `wishlist` | `user_id`, `product_id`, `PK`, `created_at` | 8 |
| `reviews` | `product_id`, `user_id`, `PK`, `order_id` (must be a delivered order containing the product), `rating 1..5`, `comment`, `is_hidden`, timestamps | 8 |
| `payments` | `id`, `order_id`, `provider`, `provider_order_id`, `provider_payment_id`, `amount`, `status`, `raw jsonb` | 10 |

### 8.3 Storage buckets

| Bucket | Public? | Contents | Write access |
|---|---|---|---|
| `catalog` | public read | `categories/`, `products/<id>/<uuid>_full.webp` + `_thumb.webp`, `banners/`, `brands/` | admin |
| `avatars` | public read | `<user_id>/<uuid>.webp` | own folder |
| `issues` | private (signed URLs) | `<user_id>/<order_id>/<uuid>.webp` | own folder; staff read |

### 8.4 Admin-defined attributes (the no-code engine, kept from the old plan)

Each category carries an `attribute_schema` that drives the product form, the "Highlights" section on product detail and the filter chips. Sub-categories inherit their parent's schema and can add fields.

```jsonc
// categories.attribute_schema for "Dairy, Bread & Eggs"
{
  "fields": [
    { "key": "fat_percent", "type": "number", "unit": "%", "label": {"en":"Fat","mr":"फॅट","hi":"वसा"}, "filterable": true },
    { "key": "milk_type",   "type": "select", "options": [
        {"value":"cow","label":{"en":"Cow","mr":"गाय","hi":"गाय"}},
        {"value":"buffalo","label":{"en":"Buffalo","mr":"म्हैस","hi":"भैंस"}} ],
      "label": {"en":"Milk type","mr":"दुधाचा प्रकार","hi":"दूध का प्रकार"}, "filterable": true },
    { "key": "organic",     "type": "boolean", "label": {"en":"Organic","mr":"सेंद्रिय","hi":"जैविक"}, "filterable": true, "badge": true }
  ]
}
// categories.filters
[ {"type":"brand"}, {"type":"price","buckets":[0,50,100,200]}, {"type":"attribute","key":"milk_type"},
  {"type":"attribute","key":"organic"}, {"type":"veg"} ]
```

Field types: `text`, `localizedText`, `number` (+unit), `boolean`, `select`, `multiSelect`, `localizedList`, `date`. The same `validate_product_attributes()` rule runs in Postgres (trigger) and in the app (zod built at runtime), so bad data can't get in from either side.

---

## 9. Business rules in Postgres (RPCs, triggers, jobs)

All functions are `security definer` with `set search_path = ''` and check `auth.uid()` and roles themselves. The app calls them with `supabase.rpc(...)`.

| Function | Who | What it does | Phase |
|---|---|---|---|
| `is_staff()`, `is_admin()` | internal | Role checks used by RLS policies | 0 |
| `handle_new_user()` (trigger on `auth.users`) | system | Creates the `profiles` row | 0 |
| `store_status(store_id)` | anyone | `{is_open, accepting, opens_at, closes_at, eta_minutes, message}` from hours + switch | 1 |
| `get_home(store_id, lang)` | anyone | Active sections with their banners/categories/products in one round-trip | 1 |
| `list_products(category_id, filters jsonb, sort, page, size)` | anyone | Category grid with price, MRP, default variant and live stock | 1 |
| `search_products(q, lang, filters, page)` | anyone | `pg_trgm` + synonyms over `search_text`; logs the query | 2 |
| `search_suggestions(q)` | anyone | Top 8 product/category names for autocomplete | 2 |
| `check_serviceability(lat, lng)` | anyone | `{serviceable, store_id, distance_km, eta_minutes}` | 3 |
| `merge_guest_cart(items jsonb)` | customer | Moves the phone's guest cart into `cart_items` after login | 4 |
| `get_cart_quote(address_id null)` | customer | Prices each line from current data, flags `price_changed / low_stock / out_of_stock / over_limit`, computes fees and totals, and says if checkout is allowed and why not | 4 |
| `place_order(address_id, payment_method, customer_note, idempotency_key)` | customer | Validates everything again, locks `inventory` rows, decrements stock, writes `orders`, `order_items`, `inventory_movements` and the first status event, clears the cart, returns the order. All or nothing. | 4 |
| `cancel_order(order_id, reason)` | customer (status `placed`/`confirmed`) / staff (any non-final) | Cancels, restocks active lines, logs | 5 |
| `staff_set_order_status(order_id, status, note)` | staff | Allowed transitions only (`placed→confirmed→packing→packed→out_for_delivery→delivered`), stamps timestamps, logs event | 6 |
| `staff_mark_item_unavailable(order_item_id, note)` | staff | Marks the line, restocks, recalculates totals, notifies the customer; cancels the order if nothing is left | 6 |
| `staff_adjust_stock(variant_id, delta, reason, note)` / `staff_set_stock(variant_id, stock)` | staff | Changes stock and logs a movement; fires "back in stock" alerts | 6 |
| `auto_cancel_stale_orders()` (`pg_cron`, every minute) | system | Cancels `placed` orders older than `stores.auto_cancel_minutes` | 6 |
| `notify_order_status()` (trigger on `orders`) | system | Inserts a localized `notifications` row for the customer; staff get one for new orders | 5 |
| `notify_back_in_stock()` (trigger on `inventory`) | system | When stock goes 0 → >0, notifies everyone in `stock_alerts` | 2 (trigger), 5 (delivery via push) |
| `admin_upsert_product(payload jsonb)` | admin | Product + variants + images + inventory in one transaction | 7 |
| `admin_import_products(rows jsonb)` | admin | Bulk CSV import with a per-row error report | 7 |
| Reporting views (`v_sales_daily`, `v_top_products`, `v_low_stock`, `v_zero_result_searches`) | admin | Dashboard numbers | 7 |

---

## 10. Security

1. **RLS on every table.** Catalog tables: public `select` of active rows only; writes for admin. Customer tables (`addresses`, `cart_items`, `orders`, `order_items`, `notifications`, …): rows where `user_id = auth.uid()`. Staff: read/update orders for their store through policies that use `is_staff()`.
2. **No direct writes to money or stock.** `orders`, `order_items`, `inventory` and `inventory_movements` have **no insert/update policy for customers**. Only RPCs change them.
3. **Prices are always computed on the server.** The client sends `variant_id + quantity`, never a price.
4. **Role changes** only by an admin through an RPC. A trigger stops users from changing their own `role`, `is_blocked` or `cod_allowed`.
5. **Only the `anon` key is in the app.** The `service_role` key lives only in Edge Function secrets and CI secrets, never in the app or git.
6. **Abuse limits:** a max number of open orders per user, a max COD value, a per-line `max_per_order`, and a rate limit inside `place_order()` (for example, no more than 5 orders in 10 minutes).
7. **Uploads:** bucket policies restrict paths per user; the app compresses and strips EXIF before upload; size limits are set on the bucket.
8. **Tests:** pgTAP tests prove that a customer can't read another customer's orders, can't change a price and can't insert an order directly (Phase 9).
9. **Supabase Security Advisor and `supabase db lint`** run before every release.

---

## 11. Legal & compliance for selling online in India

Not legal advice. Confirm with a local CA. This is what the product needs to support.

| Requirement | What the app does |
|---|---|
| **Consumer Protection (E-Commerce) Rules, 2020** | Seller name, address, GSTIN and customer-care contact on an "About / Seller details" page. Return/refund/cancellation policy visible before checkout. A grievance officer contact. |
| **Legal Metrology (Packaged Commodities) Rules** | Each product page shows **MRP (incl. all taxes)**, **net quantity**, **manufacturer/packer name and address**, **country of origin**, and best-before/shelf life where relevant. The fields are required in the admin product form. |
| **FSSAI** | Store FSSAI licence number on the seller page and on invoices; veg/non-veg mark on food products. |
| **GST invoice** | The order stores HSN, GST rate and prices at the moment of purchase. The invoice PDF shows the tax breakup. |
| **DPDP Act, 2023** | Plain-language privacy policy, location asked only when needed, **delete my account** in the app, data kept to what's needed. |
| **Play Store** | Data Safety form, account deletion link, privacy policy URL. |

---

## 12. Performance, offline & low-end phones

- Home is **one RPC** (`get_home`), and the category grid is **one RPC per page**, so screens load in a single round-trip.
- Lists load `thumb_path` images only (≈ 15–30 KB WebP). Full-size images only on product detail.
- TanStack Query cache persisted to MMKV: Home, categories, last-seen products, orders and the cart open instantly and work offline (read-only). Checkout requires a network and says so.
- FlashList everywhere, memoized product cards, a stepper that updates optimistically.
- Realtime channels are opened per screen and closed when leaving it.
- Budgets checked before each release: cold start < 3 s on a 2 GB Android phone, Home under 300 KB of data on first load, APK < 35 MB per ABI.

---

## 13. Testing

| Layer | Tools | What |
|---|---|---|
| SQL & RLS | **pgTAP** via `supabase test db` | `place_order` (stock race, idempotency, min order, closed store, COD limit), `cancel_order` restock, status transitions, RLS isolation |
| Unit | Jest | `localize()`, ₹ formatting, attribute zod builder, filter builders, cart merge |
| Component | React Native Testing Library | ProductCard states (in stock / low / out), AddButton stepper, BillDetails, StatusTimeline |
| E2E | Maestro | Guest browse → add → login → address → place COD order → staff accepts on a 2nd device → customer sees "Confirmed" live |
| Manual | 2 GB Android, iPhone, 3 languages, large text, TalkBack, slow 3G | Before each release |

**Definition of done** for every feature: works in EN/MR/HI, dark mode, large text, offline where relevant, with screen-reader labels, its SQL migration has pgTAP tests, and `supabase gen types` is re-run.

---

## 14. Roadmap

Each phase ships **UI + its Supabase migration(s) + tests**. Details per phase in [`phases/`](phases/00_PHASES_OVERVIEW.md).

| Phase | Name | Ships | Migration file(s) |
|---|---|---|---|
| 0 | Foundation & Supabase setup | App skeleton, design system, i18n, Supabase project & CLI, profiles & roles, CI | `0000_foundation.sql` |
| 1 | Catalog & Home | Home (dynamic sections), categories with sub-category rail, product cards & detail, variants, **live stock** | `0100_catalog.sql`, `0110_home.sql` |
| 2 | Search & Discovery | Multilingual search, synonyms, suggestions, filters & sort, zero-result log, "Notify me" | `0200_search.sql` |
| 3 | Accounts, Addresses & Serviceability | Google/email login, profile, address book with map pin, serviceability, store open/closed | `0300_accounts_addresses.sql` |
| 4 | Cart & Checkout (COD) | Guest + synced cart, live re-quote, bill details & fees, `place_order` | `0400_cart_orders.sql` |
| 5 | Orders: Live Tracking & Notifications | Live order status, cancel, reorder, report issue, invoice, in-app + push notifications | `0500_order_tracking_notifications.sql` |
| 6 | Store Operations (Store mode) | Live orders board + alarm, packing, item unavailable, pick list/invoice print, stock & barcode, store switch, auto-cancel | `0600_store_ops.sql` |
| 7 | Admin: Catalog, Merchandising & Reports | Category & attribute builder, product/variant editor, images, CSV import, banners/sections/collections, settings, dashboard | `0700_admin.sql` |
| 8 | Engagement & Growth | Wishlist, buy again, reviews, share links & web product pages, deep links, notification preferences | `0800_engagement.sql` |
| 9 | Hardening & Release | Offline, performance, accessibility, Sentry, full test suite, security review, legal pages, Play Store release | `0900_hardening.sql` |
| 10 | Online Payments (UPI) | Razorpay UPI/cards via Edge Functions, webhooks, refunds on cancel | `1000_payments.sql` |

**MVP (first real orders) = Phases 0–6.** After Phase 6 a real customer can order and the store can fulfil it end to end.

---

## 15. Out of scope for now

- **Delivery partners / rider app, live map tracking, delivery OTP, route assignment.** Staff set "Out for delivery" and "Delivered" by hand. The data model (`orders.out_for_delivery_at`, statuses) is ready for a rider phase later.
- Multiple stores / multi-seller marketplace (the `stores` table makes this possible later).
- Coupons, wallet, loyalty points, subscriptions (daily milk), scheduled delivery slots.
- In-app chat (call/WhatsApp the store instead).
- Phone OTP login (SMS is paid ⚠️).

---

## 16. What was removed from the old plan

The previous plan (a local business directory with Spring Boot) is archived in [`_archive_directory_plan/`](_archive_directory_plan/). Removed because they don't fit a quick-commerce app or because Supabase replaces them:

| Removed | Why |
|---|---|
| Spring Boot backend, Flyway, JWT/refresh token code, OpenAPI type generation | Replaced by Supabase (Auth, PostgREST, RPCs, `supabase gen types`) |
| `DEPLOYMENT_FREE_SETUP.md` (Oracle VM, Caddy, DuckDNS, Backblaze) | No server to host. Supabase is managed. Only the web admin is hosted (Cloudflare Pages). |
| Halls/bouquets data migration | No old data to move |
| Availability calendar, bookings, enquiries | Not part of buying products |
| Plan My Function (old Phase 8) | Event planning, not commerce |
| Requests Board (old Phase 9) | Service marketplace, not commerce |
| Everyday services (opening hours per provider, "available now", service areas per vendor) | Replaced by **store** hours, store switch and store service area |
| Vendor onboarding, claims, QR posters | Single-store model. Can come back with a marketplace phase. |

**Kept and adapted:** EN/MR/HI everywhere, the schema-driven no-code category engine (now for product attributes and filters), the design system and UX principles, TanStack Query + MMKV + FlashList + expo-image, sharing & deep links, accessibility and low-end-device budgets, and the release process.
