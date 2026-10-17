# NearKart web (share pages)

Small Cloudflare Pages project (free) that serves:

| Path | What |
|---|---|
| `/p/<slug>` | Product page: photo, price/MRP, stock, ★ rating, **Open in app**, Call / WhatsApp store. Open Graph tags (WhatsApp/Facebook preview) + JSON-LD `Product` (Google). |
| `/c/<slug>` | Category page with the first 24 products. |
| `/.well-known/assetlinks.json` | Android App Links verification (fill in the SHA-256 first). |
| `/` | Plain landing page. |

Language: `?lang=en|mr|hi`, else the browser's language, else English.
Data is read from Supabase with the **publishable** key; RLS only exposes active catalog rows.

```
web/
  functions/p/[slug].js   ← Pages Functions (server-rendered, cached 60 s at the edge)
  functions/c/[slug].js
  lib/render.js           ← shared HTML/i18n helpers (bundled into the functions)
  public/                 ← static files (build output directory)
```

## Deploy (you do this; needs your Cloudflare account)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** (or upload with Wrangler).
2. Project name: `nearkart-web` (gives `https://nearkart-web.pages.dev`).
3. Build settings: **Root directory** `web`, **Build command** *(empty)*, **Build output directory** `public`.
4. **Settings → Environment variables** (Production and Preview):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_ANON_KEY` | the **publishable** key (never the secret key) |
   | `APP_PACKAGE` | `in.nearkart.app` |
   | `PLAY_URL` | Play Store link once the app is published (optional) |

5. Deploy, then open `https://nearkart-web.pages.dev/p/sugar-loose`.

Or from a terminal: `npx wrangler pages deploy public --project-name nearkart-web` (run inside `web/`, after `npx wrangler login`).

## Point the app at it

In `mobile/.env`:

```
EXPO_PUBLIC_WEB_URL=https://nearkart-web.pages.dev
```

Share buttons in the app then produce `https://nearkart-web.pages.dev/p/<slug>` links. Because the URL is now `https`, `app.config.ts` also adds Android App Link intent filters, so **rebuild the app** (`npx expo run:android`).

## Android App Links (open links straight in the app)

1. Get the SHA-256 of the key that signs the build users install:
   - Play Console → your app → **Setup → App integrity → App signing key certificate** (for Play builds), or
   - `keytool -list -v -keystore <your.keystore>` for your own release key, or
   - debug builds: `cd mobile/android && ./gradlew signingReport`.
2. Put it in `public/.well-known/assetlinks.json` (`sha256_cert_fingerprints`), redeploy.
3. Check: `https://<host>/.well-known/assetlinks.json` loads, and
   `adb shell pm get-app-links in.nearkart.app` shows the host as `verified`.

Until then links still work: the page's **Open in app** button uses an Android intent link.

## Custom domain (optional, ~₹500–900/year)

Pages → **Custom domains** → add e.g. `nearkart.in`; then update `EXPO_PUBLIC_WEB_URL`, rebuild the app, and the App Links host follows automatically.

## Later

Phase 9's legal pages (privacy, refunds, seller info) can live here too as static files in `public/`.

## Legal pages (Phase 9)

`public/privacy.html`, `terms.html`, `refunds.html` and `contact.html` are served at `/privacy`, `/terms`, `/refunds` and `/contact` (Cloudflare Pages drops `.html`). They are **templates**: replace every `[FILL]` and have them reviewed before launch.

After deploying, point the app at them (SQL Editor):

```sql
update public.app_config set value = jsonb_build_object(
  'privacy',   'https://<your-host>/privacy',
  'terms',     'https://<your-host>/terms',
  'refunds',   'https://<your-host>/refunds',
  'seller',    'https://<your-host>/contact',
  'grievance', 'https://<your-host>/contact')
where key = 'legal_urls';
```

Use the privacy URL in the Play Console, and `https://<your-host>/contact` (section "Delete your account") as the account-deletion URL.
