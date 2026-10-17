# NearKart

A Blinkit-style quick-commerce app for one town: customers browse categories and products in
**मराठी, हिंदी or English**, see live stock and prices, and place **Cash-on-Delivery** orders.
The store sees each order instantly, packs it, and the customer follows the status live.

- **App:** Expo + React Native + TypeScript (`mobile/`), Android, iOS and web from one codebase
- **Backend:** Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) (`supabase/`)
- **Plan:** `docs/` (main plan + Phases 0–10)

## Folder layout

```
nearkart/
  mobile/              Expo app
    src/app/           routes (Expo Router): (shop) tabs, (onboarding)
    src/features/      feature modules (config, home, settings, …)
    src/ui/            design system (Button, Text, Card, Chip, Stepper, PriceTag, VegMark, …)
    src/i18n/          EN / MR / HI strings + localize()
    src/lib/           Supabase client, storage, errors, query client, formatting
    src/theme/         colour tokens (light/dark), fonts
    src/types/         generated database types
  supabase/            migrations, seed, tests, Edge Functions
  docs/                plan and phase files
  .github/workflows/   CI
```

## Getting started

### Prerequisites

- **Node.js 20+** (22 LTS recommended) and npm
- **Android:** Android Studio with an emulator (or a USB-connected phone with USB debugging), JDK 17
- **iOS (macOS only):** Xcode with a simulator
- **Docker Desktop** and the Supabase CLI (`npx supabase`), for the local backend

### 1. Install

```bash
cd mobile
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Start the local Supabase stack from the repo root (`npx supabase start`), then copy the **anon key**
from `npx supabase status` into `mobile/.env`. Use the right URL for your device:

| Device | `EXPO_PUBLIC_SUPABASE_URL` |
| --- | --- |
| iOS simulator / web | `http://127.0.0.1:54321` |
| Android emulator | `http://10.0.2.2:54321` |
| Real phone on Wi-Fi | `http://<your Mac's LAN IP>:54321` |

Without a `.env` the app still opens and shows a "not set up yet" message on Home.

### 3. Run

The app uses native modules (SQLite storage, SecureStore, crypto), so it runs in a **development
build**, not Expo Go. Build and install it once:

```bash
npx expo run:android      # or: npx expo run:ios
```

After that, start the dev server and the installed app reloads your changes:

```bash
npx expo start --dev-client
```

Quick look in a browser (no native build needed): `npx expo start --web`.

### Checks

```bash
cd mobile
npm run lint && npm run typecheck && npm test
```

## Docs

Docs:
- **Start here:** [`docs/required/PROJECT_GUIDE.md`](docs/required/PROJECT_GUIDE.md), then [`REMAINING_WORK.md`](docs/required/REMAINING_WORK.md), [`NEXT_STEPS.md`](docs/required/NEXT_STEPS.md) and [`RELEASE_CHECKLIST.md`](docs/required/RELEASE_CHECKLIST.md).
- **History only:** [`docs/not-required/`](docs/not-required/) holds the original plan and phase specs.
