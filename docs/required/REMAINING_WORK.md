# NearKart: Remaining Work

The **single, up-to-date list of what's left**. Last reviewed: 2026-10-17.
Details and step-by-step instructions live in [`NEXT_STEPS.md`](NEXT_STEPS.md) (setup per phase) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) (Play Store). The big picture is in [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md).

**Where things stand:**
- All phases 0–10 are coded.
- All 16 migrations are applied on the Supabase project.
- App: 114/114 tests, typecheck, lint and Prettier clean.
- DB: 56/56 end-to-end checks.

What's left is mostly **accounts and setup (yours)**, **testing by hand**, and a few **small code items**.

Legend: 🔴 must do before launch · 🟡 should do · ⚪ later / nice to have · 👤 needs your account or decision · 🛠 code work

---

## 1. 🔴 Must do before launch

| # | Item | Who | How |
|---|---|---|---|
| 1 | **Own domain + proxy in front of Supabase.** Some Indian networks (Jio reported) block `*.supabase.co`; your test phone hit this. Customers can't change their DNS. | 👤 + 🛠 | Buy a domain (~₹500–900/yr). Then either a Cloudflare Worker proxy at `api.<domain>` (free; must forward REST, Auth, Storage **and Realtime websockets**) or a Supabase custom domain (Pro plan). Set `EXPO_PUBLIC_SUPABASE_URL` to it and rebuild. The Worker can be written once the domain exists. |
| 2 | **Login emails that work for real users** | 👤 | Supabase → Auth → Email: OTP length 6; templates **Confirm signup** and **Magic Link** show `{{ .Token }}`; custom SMTP (e.g. Brevo free ~300/day). |
| 3 | **Real store data** | 👤 | Admin → Store settings: name, address, phone, **GSTIN, FSSAI**, opening hours, fees, min order, COD limit, **delivery pincodes**, service radius. Real categories and products with **prices, stock and photos** (Admin → Products, or CSV import). |
| 4 | **Legal pages** | 👤 | Replace every `[FILL]` in `web/public/*.html` (privacy, terms, refunds, contact, grievance officer), have a CA/lawyer review, deploy `web/`, set `app_config.legal_urls`. |
| 5 | **Remove test setup** | 👤 | `EXPO_PUBLIC_DEV_PASSWORD_LOGIN=` (empty) in `mobile/.env`; delete test users (`*@nearkart.test`) in Supabase → Auth → Users; edit demo `app_config.support` phone/email. |
| 6 | **Supabase plan** | 👤 | Free pauses after 7 days idle and has no daily backups. Move to **Pro (~US$25/mo)** once you take daily orders, or at least keep the keep-alive and nightly backup workflows on. |
| 7 | **Full manual test on a real phone** (see §3) | 👤 | Release matrix in `RELEASE_CHECKLIST.md`. |
| 8 | **Play Store release** | 👤 | Developer account (US$25), listing in EN/MR/HI, Data Safety, content rating, privacy and account-deletion URLs, signing, internal → **closed test (12 testers for 14 days for new personal accounts)** → production. |
| 9 | **Git + backup of the code** | 👤 | First commit and push to a **private** GitHub repo (commands in `PROJECT_GUIDE.md` / the last session notes). |

## 2. 👤 Setup that needs your accounts (optional or by feature)

| Feature | What to do | Until then |
|---|---|---|
| **Push notifications** | Expo account → `npx eas-cli init` (`EAS_PROJECT_ID`), Firebase project for Android (FCM key uploaded to Expo), deploy `send-push`, set Vault secrets + webhook secret, rebuild | In-app notifications work; no phone pushes |
| **Google login** | Google Cloud OAuth clients (Web, Android with SHA-1, iOS), add to Supabase Google provider ("Skip nonce check"), fill `EXPO_PUBLIC_GOOGLE_*`, rebuild | Email code login only |
| **UPI / online payments** | Razorpay account (Test Mode first), `supabase secrets set RAZORPAY_*`, deploy the 5 payment functions, webhook in Razorpay, Admin → Store settings → UPI on, rebuild, test with `success@razorpay`, then KYC + live keys | Cash on delivery only |
| **Share links / web pages** | Cloudflare Pages: deploy `web/`, set `EXPO_PUBLIC_WEB_URL` to its https URL, put the release signing SHA-256 in `web/public/.well-known/assetlinks.json`, rebuild (enables Android App Links) | Shared links point to localhost |
| **Crash reporting** (optional) | Sentry account → `npx expo install @sentry/react-native`, plugin + `Sentry.init` with `EXPO_PUBLIC_SENTRY_DSN`, rebuild | Errors only in device logs |
| **Realtime check** | Dashboard → Database → Publications → `supabase_realtime` has `inventory`, `product_variants`, `stores`, `orders`, `notifications` | Live updates may not arrive |
| **Security review** | Dashboard → Advisors (Security + Performance): fix anything red | — |

## 3. 🟡 Testing still to do (never run end to end)

Use two browser windows (customer + staff) or the phone + laptop.

- [ ] **Full order:** login → address → cart → COD order → rings on the Store mode board → accept → pick → pack → out → delivered; customer sees each step live.
- [ ] Cancel before packing (stock restored); item **"Not available"** (total recalculated, customer notified); auto-cancel when not accepted in time.
- [ ] **Admin saves:** category with custom fields, product with photos, banner, home section, store settings incl. pincodes; CSV import (dry run then real).
- [ ] Reviews after delivery; wishlist; Notify me (out of stock → restock → notification); campaigns (send test to yourself).
- [ ] Offline behaviour, dark mode, large text, TalkBack, all three languages.
- [ ] Update gate (`min_app_version`) and maintenance mode.
- [ ] Delete account.
- [ ] After any of the setups in §2: push on a real phone, Google login, UPI test payment and refund.
- [ ] Things the local DB checker only **stubs**: Realtime delivery, `pg_cron` jobs (auto-cancel, payment hold release, review prompts, campaigns), `pg_net` + Vault (push), Storage policies, Auth.

## 4. 🛠 Code work remaining

| Priority | Item | Notes |
|---|---|---|
| 🟡 | **Regenerate DB types** | Run `cd mobile && npm run gen:types:cloud` (migrations are pushed; `src/types/database.ts` was partly hand-edited) and commit. |
| 🟡 | **UI polish for the remaining screens** | Orders list cards, Search screen, Wishlist and Buy again screens didn't get the new look yet. |
| 🟡 | **`supabase/README.md`** | Referenced in docs but never written: link/push, secrets, deploy functions, auth providers, Vault secrets for push, harness usage. |
| 🟡 | **Edge Functions type-check** | Never type-checked (Deno not installed): `brew install deno` then `deno check supabase/functions/*/index.ts`. |
| 🟡 | **Domain proxy Worker** | Cloudflare Worker for §1.1 once you have the domain. |
| ⚪ | Draggable **map pin** in the address form | Today: GPS + reverse geocode + editable fields. Needs MapLibre (Android, no Google billing) / Apple Maps (iOS) and a rebuild. |
| ⚪ | **Share-image card** for WhatsApp | Needs `react-native-view-shot` + rebuild; text links + web Open Graph previews work today. |
| ⚪ | ★ ratings on **Buy again** cards | That list is built by a different query (`buy_again`). |
| ⚪ | pgTAP files `0500`, `0600`, `20_rls_customer_data` | Use psql meta-commands; run with `npx supabase test db` (needs Docker), not the PGlite harness. |
| ⚪ | Jest 29 → 30 (`expo-doctor` notice) | Tests pass today. |
| ⚪ | Husky + lint-staged pre-commit hooks | CI already runs lint, typecheck, tests and DB checks. |
| ⚪ | Update `docs/not-required/` plan docs | History only; code is the source of truth. |

## 5. ⚪ Future features (not planned in detail)

| Feature | Notes |
|---|---|
| **Delivery partners / rider app** | Rider role and mode, order assignment, live GPS on a map (Realtime broadcast), delivery OTP, COD cash collection report. Statuses and timestamps already exist. |
| Coupons & offers | `coupons` table + validation in `get_cart_quote` / `place_order`. |
| Scheduled slots & subscriptions | "Milk every morning at 7". |
| Multiple dark stores | Nearest serviceable store per address; inventory is already per store. |
| Wallet / loyalty | After online payments are live. |
| iOS App Store release | Apple Developer Program (annual fee); iOS push needs it too. |

## 6. Known risks to keep in mind

- **`supabase.co` DNS blocking** on some Indian networks: §1.1.
- **Free tier limits:** project pauses after 7 days idle; ~200 Realtime connections; 1 GB storage (photos are compressed on upload).
- **Phone dev builds:** native changes need `npx expo run:android --device` again; Metro must be restarted with `--clear` after `.env` changes.
- **Razorpay fees** (~2% per online payment) and KYC before live payments.
- **No delivery tracking:** staff must update "Out for delivery" / "Delivered" by hand.
