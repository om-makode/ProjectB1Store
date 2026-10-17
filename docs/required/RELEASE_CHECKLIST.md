# NearKart release checklist (Android first)

Work top to bottom. Copy the "Every release" section into each release note. Accounts below are yours to create; nothing here is automated for you.

## 0. One-time accounts

- [ ] **Google Play Console** developer account (US$25 one-time) at play.google.com/console. Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before production access, so start early.
- [ ] **Expo account**, only if you use EAS cloud builds or push notifications: `npx eas-cli@latest login`, then `npx eas-cli init` writes the project id. Put it in `mobile/.env` as `EAS_PROJECT_ID`.
- [ ] **Cloudflare** account for `web/` (product pages and legal pages).

## 1. Pre-release cleanup (must do)

- [ ] `mobile/.env`: `EXPO_PUBLIC_DEV_PASSWORD_LOGIN=` (empty). Release builds ignore it anyway (`__DEV__` guard), but keep it off.
- [ ] Supabase → Authentication → Users: **delete test users** (`*@nearkart.test`, etc.).
- [ ] Replace demo catalog data: real store row (name, address, phone, GSTIN, FSSAI, opening hours, service radius, fees), real products, prices and photos (Admin → Products).
- [ ] Remove or edit demo `app_config.support` phone/email.
- [ ] Email login: custom SMTP (e.g. Brevo free tier) configured; email templates show `{{ .Token }}`; the built-in Supabase sender is far too limited for real users.
- [ ] Legal pages: every `[FILL]` replaced in `web/public/*.html`, `web/` deployed, `app_config.legal_urls` set (SQL in `web/README.md`). Have a CA/lawyer review.
- [ ] **Supabase plan decision**: Free pauses after 7 days without activity and has no daily backups. Once you take real orders, move to **Pro** (⚠️ ~US$25/month), or at minimum keep a keep-alive ping and run your own nightly `pg_dump` (Phase 9 doc §9.7).
- [ ] Realtime: Database → Publications → `supabase_realtime` contains `inventory`, `product_variants`, `stores`, `orders`, `notifications`.
- [ ] Push (optional for v1.0): FCM credentials uploaded to Expo, `send-push` deployed, Vault secrets set (`NEXT_STEPS.md`).
- [ ] Run Supabase **Security Advisor** and **Performance Advisor** (Dashboard → Advisors) and fix anything red.

## 2. Versioning

`mobile/app.config.ts` reads:

| Env var | Meaning | Rule |
|---|---|---|
| `APP_VERSION` | User-visible version (default `1.0.0`) | Bump for each store release (1.0.0 → 1.0.1 → 1.1.0) |
| `ANDROID_VERSION_CODE` | Integer Play uses to order uploads (default `1`) | **+1 on every upload**, never reuse |
| `APP_ENV` | `development` / `preview` / `production` | `production` drops the package suffix → `in.nearkart.app` |

After a release is live, update `app_config.latest_app_version` (soft prompt) and, only when old builds must stop working, `min_app_version` (hard block).

## 3. Signing & building

**Option A: EAS (cloud, easiest).** EAS creates and stores the upload keystore for you.
```bash
cd mobile
APP_VERSION=1.0.0 ANDROID_VERSION_CODE=1 npx eas-cli@latest build -p android --profile production   # .aab
npx eas-cli@latest build -p android --profile preview      # .apk to share with testers
```
⚠️ EAS free tier has a monthly build quota.

**Option B: local (free).**
```bash
cd mobile
keytool -genkeypair -v -storetype PKCS12 -keystore nearkart-upload.keystore -alias nearkart -keyalg RSA -keysize 2048 -validity 10000
# keep the keystore + passwords OUTSIDE git, backed up in two places
APP_ENV=production APP_VERSION=1.0.0 ANDROID_VERSION_CODE=1 npx expo prebuild -p android --clean
# configure signing in android/app/build.gradle (release signingConfig) or ~/.gradle/gradle.properties
cd android && ./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
```
Use **Play App Signing** (default): Google holds the app signing key; you upload with the upload key.

For Android App Links, put the **app signing key** SHA-256 (Play Console → Setup → App integrity) into `web/public/.well-known/assetlinks.json` and redeploy `web/`.

## 4. Play Console setup

- [ ] Create app: name **NearKart** (or your final name), default language, App, Free.
- [ ] **Store listing** in English + Marathi (mr-IN) + Hindi (hi-IN): short description (80 chars), full description, icon 512×512, feature graphic 1024×500, at least 4 phone screenshots per language (Home, Category, Cart, Order tracking).
- [ ] **Privacy policy URL**: `https://<your-host>/privacy`.
- [ ] **App access**: login is optional for browsing; give reviewers a test email + password (create a fresh one, delete after review) or note that email OTP works.
- [ ] **Ads**: No.
- [ ] **Content rating** questionnaire: shopping app, no user-to-user content except product reviews (moderated) → typically "Everyone".
- [ ] **Target audience**: 18+ (not designed for children).
- [ ] **Data safety**, answer from what the app does:
  - Collected: **Name, Email, Phone number** (account, order delivery); **Approximate & precise location** (only when "Use current location" is tapped; app functionality; not shared); **Purchase history** (orders); **Photos** (only issue reports); **App interactions/crash logs** (if crash reporting is enabled); **Device IDs** (push token).
  - Shared with third parties: **No** (Supabase/Expo are service providers processing on your behalf).
  - Encrypted in transit: **Yes**. Users can request deletion: **Yes**.
- [ ] **Account deletion URL**: `https://<your-host>/contact` (has the "Delete your account" section); in-app path: Account → Profile → Delete account.
- [ ] **Government apps / financial features**: No. **Health**: No.
- [ ] Countries: India.

## 5. Testing tracks → rollout

1. **Internal testing** (up to 100 testers, minutes to review): upload the `.aab`, install from the opt-in link, run the release matrix below.
2. **Closed testing**: at least 12 testers for 14 days (required for new personal accounts). Fix crashes and feedback.
3. **Production** with **staged rollout**: 10% → 25% → 50% → 100% over a few days. Halt the rollout if crashes or bad reviews spike.

### Release matrix (≈ 45 min, on a real 2–3 GB RAM Android phone)
- [ ] Fresh install → language picker → Home loads in each of EN / मराठी / हिंदी
- [ ] Browse category → product → add → cart bill correct → checkout → **COD order placed**
- [ ] Store mode on a second device: order rings, accept → pack → out → delivered; customer sees each step live
- [ ] Cancel before packing restocks; item "Not available" lowers the total
- [ ] Offline: Home/orders show saved data; checkout blocked with message
- [ ] Large text (system font size max) and TalkBack on the order flow
- [ ] Dark mode
- [ ] Update gate: set `min_app_version` above the build → "Update required"; set back
- [ ] Delete account flow

## 6. Launch day at the store (runbook)

- **Before opening**: store tablet charged and on Wi-Fi, logged in as staff, Store mode open, sound enabled, volume max, screen-on; printer paired; stock counts checked for top 50 items.
- **Opening**: switch "Accepting orders" on; place one real test order yourself and fulfil it end to end.
- **During the day**: accept every new order within 2 minutes (auto-cancel is on); mark items unavailable rather than substituting silently; keep stock updated when supplies arrive (Stock → Receive).
- **Closing**: switch to paused, check Done column, note cancellations and their reasons on the Admin dashboard.
- **If something breaks**: pause ordering (Store switch), or set `app_config.maintenance.enabled = true` (ordering-only by default) from the SQL editor; customers can still browse.

## 7. Every release

- [ ] `APP_VERSION` / `ANDROID_VERSION_CODE` bumped
- [ ] `npm run lint && npm run typecheck && npm test` in `mobile/`; `node run.mjs` in `tools/sqlcheck/`
- [ ] New migrations pushed (`npx supabase db push`) **before** the app that needs them ships
- [ ] `npm run gen:types:cloud` and commit the types
- [ ] Release matrix done on a real phone
- [ ] `latest_app_version` updated after rollout reaches 100%
