# Phase 0: Foundation & Supabase Setup

> **Goal:** a clean, typed, themed, multilingual app skeleton that already talks to Supabase, with the database foundations (extensions, enums, profiles, roles) in a versioned migration.
> **Duration:** about 1 week · **Depends on:** nothing · **Next:** [Phase 1: Catalog & Home](PHASE_1.md)

**Done when:**
- [ ] The app runs on an Android device/emulator **and** an iOS simulator from one codebase (dev build, not Expo Go)
- [ ] 4 placeholder tabs (**Home, Categories, Orders, Account**) render using design-system components
- [ ] Account has working **language** (EN/मराठी/हिंदी), **theme** (light/dark/system) and **large text** switches that survive an app restart
- [ ] `supabase start` runs the full local stack; `supabase db reset` applies `0000_foundation.sql` + `seed.sql` with no errors
- [ ] The Home placeholder reads `app_config` from Supabase through TanStack Query, and still shows it offline from the persisted cache
- [ ] `supabase gen types` writes `mobile/src/types/database.ts`, and the app compiles against it
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `supabase test db` pass locally **and** in GitHub Actions

| # | Heading | Output |
|---|---|---|
| 0.1 | Repo layout | `nearkart/` with `mobile/`, `supabase/`, `docs/` + README |
| 0.2 | Expo + TypeScript strict + Expo Router | Running dev build with 4 tabs |
| 0.3 | Lint / format / hooks | ESLint, Prettier, Husky, lint-staged |
| 0.4 | Env config | `env.ts`, `app.config.ts`, `.env.*` |
| 0.5 | Theme, NativeWind, fonts | Tokens + Tailwind + Noto fonts |
| 0.6 | Design-system primitives | `src/ui/*` incl. `Stepper`, `PriceTag`, `VegMark` |
| 0.7 | i18n + `localize()` | EN/MR/HI, Indian formats |
| 0.8 | Supabase project, CLI & local stack | `supabase/`, `0000_foundation.sql`, `seed.sql`, pgTAP test |
| 0.9 | Supabase client, TanStack Query, MMKV | `src/lib/supabase.ts`, persisted cache, settings store |
| 0.10 | Generated DB types | `src/types/database.ts` + helper types |
| 0.11 | CI | `.github/workflows/ci.yml` (app + database jobs) |

> **Package versions:** install anything Expo/React Native related with `npx expo install <pkg>` so it matches your SDK. Pure JS tools (ESLint, Prettier, zod, Zustand, TanStack Query, supabase-js) can use `npm install`.

---

## 0.1 Repo layout

**Goal:** one repository for the app, the database and the docs.

**Steps**
1. Create the project folder:
   ```
   ~/Desktop/Om_Projects/
     nearkart/
       mobile/              ← Expo app (0.2): customer app + store mode + admin, also builds for web
       supabase/            ← Supabase CLI project (0.8): migrations, seed, functions, tests
       docs/                ← REACT_NATIVE_PLAN.md + phases/*
       .github/workflows/   ← CI (0.11)
       package.json         ← root scripts for the database (0.8)
       .gitignore
       README.md
   ```
2. `git init -b main`, create a GitHub repository (free; public repos get unlimited CI minutes).
3. Root `.gitignore`:
   ```gitignore
   node_modules/
   .expo/
   dist/
   web-build/
   mobile/ios/
   mobile/android/
   *.keystore
   .env
   .env.*.local
   mobile/.env.development
   mobile/.env.production
   google-services.json
   GoogleService-Info.plist
   supabase/.branches/
   supabase/.temp/
   supabase/.env
   .DS_Store
   ```
   `ios/` and `android/` are ignored because we use **Continuous Native Generation**: `expo prebuild` generates them and they are never edited by hand.
4. `README.md`: what the app is (one paragraph), "Getting started" (filled in by 0.2, 0.4 and 0.8), links to `docs/`.

**Checks**
- `git status` is clean after the first commit and no `.env` file is tracked.

---

## 0.2 Expo + TypeScript strict + Expo Router scaffold

**Goal:** a runnable app with file-based navigation and the 4 customer tabs.

**Commands**
```bash
cd ~/Desktop/Om_Projects/nearkart
npx create-expo-app@latest mobile --template default
cd mobile
npm run reset-project               # removes the demo screens, leaves an empty app/
npx expo install expo-dev-client
```

> **Why a dev build?** MMKV (0.9), SecureStore, Google Sign-In (Phase 3) and the camera (Phase 6) need native code, so **Expo Go won't work**. Build once on your machine (free):
> ```bash
> npx expo run:android      # Android Studio + emulator, or a USB device
> npx expo run:ios          # Xcode (macOS)
> ```
> After that, `npx expo start --dev-client` hot-reloads JS into that build.

**Files**
```
mobile/
  app/
    _layout.tsx                # root: fonts, i18n, providers (0.5–0.9)
    (shop)/_layout.tsx         # bottom tabs (+ floating cart bar slot in Phase 1)
    (shop)/index.tsx           # Home
    (shop)/categories.tsx
    (shop)/orders.tsx
    (shop)/account.tsx
    +not-found.tsx
  src/                         # all non-route code
  tsconfig.json
  app.config.ts                # (0.4) replaces app.json
```

**`tsconfig.json`**
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts", "nativewind-env.d.ts"]
}
```
`noUncheckedIndexedAccess` makes `items[0]` typed as possibly `undefined`, which catches a whole class of crashes at compile time.

**`app/(shop)/_layout.tsx`**
```tsx
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/useTheme';

const icon = (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: string; size: number }) =>
    <MaterialCommunityIcons name={name} color={color} size={size} />;

export default function ShopTabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, height: 64, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 13, fontFamily: 'NotoSans_600SemiBold' },
      }}
    >
      <Tabs.Screen name="index"      options={{ title: t('tabs.home'),       tabBarIcon: icon('home-variant') }} />
      <Tabs.Screen name="categories" options={{ title: t('tabs.categories'), tabBarIcon: icon('view-grid') }} />
      <Tabs.Screen name="orders"     options={{ title: t('tabs.orders'),     tabBarIcon: icon('receipt-text') }} />
      <Tabs.Screen name="account"    options={{ title: t('tabs.account'),    tabBarIcon: icon('account-circle') }} />
    </Tabs>
  );
}
```
A 64 dp tab bar and 13 sp labels follow the "big & simple" UX rule. In Phase 1 a `<CartBar />` is rendered above the tab bar from this layout.

**Checks**
- The app launches on Android and iOS with 4 tabs; tapping each switches screens.
- `npx tsc --noEmit` passes.

---

## 0.3 Code quality: ESLint, Prettier, Husky, lint-staged

**Goal:** consistent style, enforced before every commit.

**Commands** (in `mobile/`)
```bash
npx expo lint                       # creates eslint.config.js with eslint-config-expo
npm i -D prettier eslint-config-prettier eslint-plugin-prettier \
        prettier-plugin-tailwindcss husky lint-staged @tanstack/eslint-plugin-query
cd .. && npx husky init             # hooks live at the repo root
```

**`mobile/eslint.config.js`**
```js
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-plugin-prettier/recommended');
const query = require('@tanstack/eslint-plugin-query');

module.exports = [
  ...expoConfig,
  ...query.configs['flat/recommended'],
  prettier,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'src/types/database.ts'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],   // use src/lib/logger.ts
      'no-restricted-imports': ['error', {
        paths: [{ name: '@/lib/supabase', message: 'Call Supabase from src/features/*/api.ts only, never from screens.' }],
      }],
    },
  },
  // the rule above is relaxed for feature API files
  { files: ['src/features/**/api.ts', 'src/lib/**', 'src/providers/**'], rules: { 'no-restricted-imports': 'off' } },
];
```
The restricted-import rule enforces the plan's architecture rule: **no Supabase calls in screens**.

**`mobile/.prettierrc`**
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 100, "plugins": ["prettier-plugin-tailwindcss"] }
```

**`mobile/package.json` scripts**
```json
{
  "scripts": {
    "start": "expo start --dev-client",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "lint": "expo lint",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "doctor": "npx expo-doctor"
  },
  "lint-staged": {
    "*.{ts,tsx,js}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

**`.husky/pre-commit`** (repo root)
```sh
cd mobile && npx lint-staged && npm run typecheck
```

**`mobile/src/lib/logger.ts`**
```ts
const enabled = __DEV__;
export const logger = {
  debug: (...a: unknown[]) => enabled && console.log('[nk]', ...a),
  warn:  (...a: unknown[]) => console.warn('[nk]', ...a),
  error: (...a: unknown[]) => console.error('[nk]', ...a),   // Phase 9 forwards this to Sentry
};
```

**Checks**
- Committing a badly formatted file fixes it automatically; a type error blocks the commit.
- Importing `@/lib/supabase` inside `app/(shop)/index.tsx` is a lint error.

---

## 0.4 Environment config

**Goal:** one validated place for the Supabase URL and key per environment. No hard-coded URLs.

**Files**
```
mobile/
  app.config.ts
  .env.example            # committed
  .env.development        # not committed: local Supabase
  .env.production         # not committed: cloud Supabase
  src/config/env.ts
```

**`.env.example`**
```bash
APP_ENV=development
# Local stack from `supabase start` (0.8).
#   iOS simulator:        http://127.0.0.1:54321
#   Android emulator:     http://10.0.2.2:54321
#   Real phone on Wi-Fi:  http://<your Mac's LAN IP>:54321
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# The anon / publishable key printed by `supabase status`. It is safe in the app ONLY because RLS is on everywhere.
EXPO_PUBLIC_SUPABASE_ANON_KEY=replace-me
# Used for share links and web product pages (Phase 8)
EXPO_PUBLIC_WEB_URL=http://localhost:8081
```
Only `EXPO_PUBLIC_*` variables reach the JS bundle, and **everything in the bundle is public**. The `service_role` / secret key must **never** appear here (plan §10.5).

**`app.config.ts`**
```ts
import type { ExpoConfig } from 'expo/config';

const APP_ENV = process.env.APP_ENV ?? 'development';
const suffix = APP_ENV === 'production' ? '' : `.${APP_ENV}`;

const config: ExpoConfig = {
  name: APP_ENV === 'production' ? 'NearKart' : `NearKart (${APP_ENV})`,
  slug: 'nearkart',
  scheme: 'nearkart',                          // nearkart://product/amul-milk-500ml
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',             // needed for dark mode
  icon: './assets/images/icon.png',
  ios: { bundleIdentifier: `in.nearkart.app${suffix}`, supportsTablet: true },   // tablets run Store mode
  android: {
    package: `in.nearkart.app${suffix}`,
    adaptiveIcon: { foregroundImage: './assets/images/adaptive-icon.png', backgroundColor: '#FFFFFF' },
  },
  web: { bundler: 'metro', output: 'single' },   // web admin (Phase 7)
  plugins: ['expo-router', 'expo-localization', 'expo-font', 'expo-secure-store'],
  experiments: { typedRoutes: true },
  extra: { appEnv: APP_ENV },
};
export default config;
```
Separate bundle IDs per environment let dev and prod builds sit side by side on one phone.

**`src/config/env.ts`**
```ts
import { z } from 'zod';

const schema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  EXPO_PUBLIC_WEB_URL: z.string().url(),
});

// Expo inlines these at build time: reference each one explicitly (no dynamic process.env[key])
const parsed = schema.safeParse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
});

if (!parsed.success) {
  throw new Error(`Invalid env config: ${parsed.error.message}. Copy .env.example to .env.development`);
}

export const env = {
  supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: parsed.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  webUrl: parsed.data.EXPO_PUBLIC_WEB_URL,
} as const;
```

**Commands**
```bash
npm i zod
cp .env.example .env.development     # then paste the key from `supabase status` (0.8)
```

**Checks**
- Removing `EXPO_PUBLIC_SUPABASE_URL` makes the app fail at startup with a clear message.
- `APP_ENV=staging npx expo start` shows "NearKart (staging)".

---

## 0.5 Theme tokens, NativeWind, dark mode, Noto fonts

**Goal:** one source of design tokens used by Tailwind classes **and** JS (navigation, icons, category colours), light + dark, and fonts that render Devanagari well.

**Commands**
```bash
npx expo install nativewind react-native-reanimated react-native-safe-area-context
npm i -D tailwindcss@^3                 # NativeWind v4 uses Tailwind v3
npx expo install expo-font expo-splash-screen \
  @expo-google-fonts/noto-sans @expo-google-fonts/noto-sans-devanagari
npx tailwindcss init
```

**Files**
```
mobile/
  tailwind.config.js  global.css  babel.config.js  metro.config.js  nativewind-env.d.ts
  src/theme/  tokens.ts  useTheme.ts  fonts.ts
```

**`src/theme/tokens.ts`**: a quick-commerce palette (green for "go/add", yellow for highlights, blue for discounts):
```ts
export const palette = {
  light: {
    primary: '#0C831F', primaryText: '#FFFFFF',        // ADD buttons, cart bar, active tab
    accent: '#F8CB46',  accentText: '#1A1A1A',         // banners, "Store open" pill
    background: '#F5F6F8', surface: '#FFFFFF', surfaceAlt: '#EEF0F3',
    text: '#1A1C1E', textMuted: '#5C6166', border: '#E2E5E9',
    success: '#16A34A', danger: '#DC2626', warning: '#B45309', info: '#2563EB',
    discount: '#256FEF',                               // "12% OFF" tag
    veg: '#0F8A3C', nonVeg: '#B3261E',                 // FSSAI marks (always with the square/triangle shape)
    outOfStock: '#9AA0A6',
  },
  dark: {
    primary: '#34C759', primaryText: '#0B1A0F',
    accent: '#F8CB46',  accentText: '#1A1A1A',
    background: '#0E1012', surface: '#181B1E', surfaceAlt: '#22262A',
    text: '#F2F4F5', textMuted: '#A3A9AE', border: '#2C3136',
    success: '#4ADE80', danger: '#F87171', warning: '#FBBF24', info: '#60A5FA',
    discount: '#7AA7FF',
    veg: '#3DD07A', nonVeg: '#FF6B61',
    outOfStock: '#5F656B',
  },
} as const;

export type ColorName = keyof typeof palette.light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius  = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;

// Base sizes in sp. Multiplied by the "large text" setting (1.0 or 1.2) and the OS font scale.
export const fontSize = { caption: 12, body: 15, bodyLg: 17, title: 19, h2: 22, h1: 26 } as const;

export const minTouch = 48;   // dp: minimum tap target everywhere
```

**`tailwind.config.js`**: tokens as CSS variables so `dark:` switching happens in one place:
```js
/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: v('primary'), 'primary-text': v('primary-text'),
        accent: v('accent'), background: v('background'), surface: v('surface'),
        'surface-alt': v('surface-alt'), text: v('text'), muted: v('text-muted'),
        border: v('border'), success: v('success'), danger: v('danger'),
        discount: v('discount'), veg: v('veg'), 'non-veg': v('non-veg'),
      },
      fontFamily: {
        sans: ['NotoSans_400Regular'], medium: ['NotoSans_500Medium'],
        semibold: ['NotoSans_600SemiBold'], bold: ['NotoSans_700Bold'],
      },
    },
  },
};
```

**`global.css`**: the same values as RGB triplets (a unit test keeps them in sync with `tokens.ts`):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --c-primary: 12 131 31;     --c-primary-text: 255 255 255;  --c-accent: 248 203 70;
  --c-background: 245 246 248; --c-surface: 255 255 255;     --c-surface-alt: 238 240 243;
  --c-text: 26 28 30;         --c-text-muted: 92 97 102;      --c-border: 226 229 233;
  --c-success: 22 163 74;     --c-danger: 220 38 38;          --c-discount: 37 111 239;
  --c-veg: 15 138 60;         --c-non-veg: 179 38 30;
}
.dark:root {
  --c-primary: 52 199 89;     --c-primary-text: 11 26 15;     --c-accent: 248 203 70;
  --c-background: 14 16 18;   --c-surface: 24 27 30;          --c-surface-alt: 34 38 42;
  --c-text: 242 244 245;      --c-text-muted: 163 169 174;    --c-border: 44 49 54;
  --c-success: 74 222 128;    --c-danger: 248 113 113;        --c-discount: 122 167 255;
  --c-veg: 61 208 122;        --c-non-veg: 255 107 97;
}
```

**`babel.config.js`**
```js
module.exports = function (api) {
  api.cache(true);
  return { presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'] };
};
```

**`metro.config.js`**
```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
module.exports = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
```

**`nativewind-env.d.ts`**: `/// <reference types="nativewind/types" />`

**`src/theme/useTheme.ts`**
```ts
import { useEffect } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';
import { useColorScheme as useNativewindScheme } from 'nativewind';
import { palette } from './tokens';
import { useSettings } from '@/stores/settings';

export function useTheme() {
  const pref = useSettings((s) => s.theme);
  const system = useSystemScheme() ?? 'light';
  const scheme = pref === 'system' ? system : pref;
  return { scheme, colors: palette[scheme], isDark: scheme === 'dark' };
}

/** Mount once in Providers: keeps NativeWind's `dark` class in sync with the user preference */
export function useSyncNativewindScheme() {
  const pref = useSettings((s) => s.theme);
  const { setColorScheme } = useNativewindScheme();
  useEffect(() => setColorScheme(pref), [pref, setColorScheme]);
}
```

**`src/theme/fonts.ts`**
```ts
import { NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold } from '@expo-google-fonts/noto-sans';
import { NotoSansDevanagari_400Regular, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari';
import type { Lang } from '@/i18n';

export const appFonts = {
  NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold,
  NotoSansDevanagari_400Regular, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold,
};

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
const latin: Record<Weight, string> = { regular: 'NotoSans_400Regular', medium: 'NotoSans_500Medium', semibold: 'NotoSans_600SemiBold', bold: 'NotoSans_700Bold' };
const deva: Record<Weight, string>  = { regular: 'NotoSansDevanagari_400Regular', medium: 'NotoSansDevanagari_400Regular', semibold: 'NotoSansDevanagari_600SemiBold', bold: 'NotoSansDevanagari_700Bold' };

/** mr/hi use the Devanagari family so matras render at matching weight */
export const fontFor = (weight: Weight, lang: Lang) => (lang === 'en' ? latin : deva)[weight];
```
> Product names are often mixed ("Amul ताजा दूध 500 ml"). Noto Sans Devanagari includes Latin glyphs, so mixed strings render correctly in mr/hi mode.

**Root layout (fonts + splash)**, `app/_layout.tsx` (full provider tree in 0.9):
```tsx
import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { appFonts } from '@/theme/fonts';
import { initI18n } from '@/i18n';
import { useSettings } from '@/stores/settings';
import { Providers } from '@/providers/Providers';

SplashScreen.preventAutoHideAsync();
initI18n(useSettings.getState().language);       // MMKV is synchronous: correct language on first frame

export default function RootLayout() {
  const [loaded] = useFonts(appFonts);
  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return null;
  return (
    <Providers>
      <Stack screenOptions={{ headerShown: false }} />
    </Providers>
  );
}
```

**Checks**
- Phone in dark mode (theme = system) flips colours; choosing "Light" in Account overrides it.
- Marathi text such as "दूध, ब्रेड आणि अंडी" renders with no boxes or clipped matras at every weight.

**Tests**
- `tokens.test.ts`: every colour in `palette` matches its triplet in `global.css` (both themes).
- `contrast.test.ts`: `text`/`textMuted` on `background`/`surface`, and `primaryText` on `primary`, are ≥ 4.5:1 in both themes (`src/lib/contrast.ts`, a tiny WCAG helper).

---

## 0.6 Design-system primitives

**Goal:** a small set of accessible components so screens never style raw `View`/`Text` ad hoc. The commerce-specific ones (`Stepper`, `PriceTag`, `VegMark`) are built now because every catalog screen in Phase 1 uses them.

**Commands**
```bash
npx expo install @gorhom/bottom-sheet react-native-gesture-handler expo-haptics
```

**Files**: `src/ui/`
```
Text.tsx  Button.tsx  IconButton.tsx  Card.tsx  Chip.tsx  Screen.tsx
Stepper.tsx  PriceTag.tsx  VegMark.tsx  Badge.tsx
Skeleton.tsx  EmptyState.tsx  ErrorState.tsx  Sheet.tsx  Toast.tsx
index.ts
```

**Component contracts**

| Component | Props | Rules |
|---|---|---|
| `Text` | `variant: 'h1'\|'h2'\|'title'\|'bodyLg'\|'body'\|'caption'`, `weight`, `color: ColorName`, `numberOfLines` | Uses `fontFor(weight, lang)` and `fontSize[variant] × textScale`. Keeps `allowFontScaling` on with `maxFontSizeMultiplier={1.6}`. |
| `Button` | `title`, `onPress`, `variant: 'primary'\|'secondary'\|'ghost'\|'danger'`, `size: 'md'\|'lg'`, `icon?`, `loading?`, `disabled?`, `fullWidth?` | Min height 48. `accessibilityRole="button"`, `accessibilityState={{ disabled, busy }}`. Light haptic. |
| `IconButton` | `icon`, `onPress`, **`accessibilityLabel` (required)** | 48×48 hit area. No unlabeled icons. |
| `Card` | `onPress?`, `padded?` | `surface` background, `radius.lg`, subtle elevation. |
| `Chip` | `label`, `selected?`, `onPress?`, `icon?`, `tint?` | Filters, sub-categories. `accessibilityState={{ selected }}`. |
| `Screen` | `scroll?`, `padded?`, `edges?` | Safe-area aware, keyboard-avoiding when `scroll`. |
| **`Stepper`** | `quantity`, `onAdd`, `onIncrement`, `onDecrement`, `max`, `disabled?`, `size: 'sm'\|'md'` | `quantity === 0` → green **ADD** button; `> 0` → `− 2 +`. `+` disabled at `max` with a toast "Max 10 per order". Each button 48 dp hit area even when drawn smaller. Announces "2 in cart" to screen readers (`accessibilityLiveRegion="polite"`). |
| **`PriceTag`** | `price`, `mrp`, `size` | Shows ₹price; if `mrp > price`, struck-through MRP and a `discount`-coloured "12% OFF" (rounded down). Never shows 0% off. |
| **`VegMark`** | `isVeg: boolean \| null` | FSSAI-style square: green dot for veg, brown triangle for non-veg (shape **and** colour, never colour alone). Renders nothing for `null` (non-food). Label "Vegetarian"/"Non-vegetarian" for screen readers. |
| `Badge` | `label`, `tone: 'info'\|'warning'\|'danger'\|'neutral'` | "Only 3 left", "Out of stock", order status pills. |
| `Skeleton` | `width`, `height`, `radius?` | Shimmer; static when "Reduce motion" is on. |
| `EmptyState` | `icon`, `title`, `message?`, `action?` | Friendly copy, never a blank screen. |
| `ErrorState` | `error: AppError`, `onRetry` | Maps `AppError.kind` (0.9) to offline / server / not-found copy. Always offers **Retry**. |
| `Sheet` | wrapper over `@gorhom/bottom-sheet` | Filters, variant picker, address picker. |
| `Toast` | `showToast(message, tone)` | Small, non-blocking, auto-dismiss; announced to screen readers. |

**`src/ui/Stepper.tsx`** (reference implementation; others follow the same pattern)
```tsx
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Text } from './Text';
import { showToast } from './Toast';

type Props = {
  quantity: number;
  max: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;          // out of stock / store closed
  size?: 'sm' | 'md';
};

export function Stepper({ quantity, max, onAdd, onIncrement, onDecrement, disabled, size = 'sm' }: Props) {
  const { t } = useTranslation();
  const h = size === 'sm' ? 34 : 44;
  const hit = { top: 7, bottom: 7, left: 7, right: 7 };   // 48 dp effective target

  if (quantity === 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('cart.add')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={hit}
        onPress={() => { Haptics.selectionAsync(); onAdd(); }}
        style={{ height: h, minWidth: 72 }}
        className={`items-center justify-center rounded-md border border-primary bg-surface px-4 ${disabled ? 'opacity-40' : ''}`}
      >
        <Text weight="bold" color="primary">{t('cart.add')}</Text>
      </Pressable>
    );
  }

  const atMax = quantity >= max;
  return (
    <View style={{ height: h, minWidth: 72 }} className="flex-row items-center justify-between rounded-md bg-primary"
          accessibilityLiveRegion="polite" accessibilityLabel={t('cart.inCart', { count: quantity })}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cart.decrease')} hitSlop={hit}
                 onPress={() => { Haptics.selectionAsync(); onDecrement(); }} className="px-3">
        <Text weight="bold" color="primaryText">−</Text>
      </Pressable>
      <Text weight="bold" color="primaryText">{quantity}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cart.increase')} hitSlop={hit}
                 accessibilityState={{ disabled: atMax }}
                 onPress={() => atMax ? showToast(t('cart.maxPerOrder', { max }), 'warning') : (Haptics.selectionAsync(), onIncrement())}
                 className={`px-3 ${atMax ? 'opacity-50' : ''}`}>
        <Text weight="bold" color="primaryText">+</Text>
      </Pressable>
    </View>
  );
}
```

**Root wrappers needed** (added to `Providers` in 0.9): `GestureHandlerRootView`, `SafeAreaProvider`, `BottomSheetModalProvider`, `ToastHost`.

**Dev showcase** `app/dev/ui.tsx` (only in `__DEV__`): every primitive in every state (Stepper at 0 / 3 / max / disabled; PriceTag with and without discount; VegMark veg / non-veg / null), in both themes and all 3 languages. This is the visual QA page for the whole project.

**Checks**
- With TalkBack/VoiceOver on, every button reads a meaningful label; the Stepper announces the new quantity.
- At the maximum OS font size nothing overlaps or clips (product cards in Phase 1 depend on this).

**Tests** (`src/ui/__tests__/`)
- `Stepper`: shows ADD at 0; ADD calls `onAdd`; `+` at `max` does not call `onIncrement` and shows the toast; disabled ADD does nothing.
- `PriceTag`: `price 45, mrp 50` → "₹45", "₹50" struck, "10% OFF"; `price === mrp` → no MRP, no tag.
- `VegMark`: renders nothing for `null`; accessible label for veg / non-veg.
- `IconButton`: `// @ts-expect-error` without `accessibilityLabel`.

---

## 0.7 i18n (EN / MR / HI) + `localize()` helper

**Goal:** two kinds of text handled one way:
1. **UI strings** come from bundled JSON (`t('cart.add')`).
2. **Content strings** come from Supabase as `{en, mr, hi}` jsonb (`localize(product.name)`).

**Commands**
```bash
npm i i18next react-i18next
npx expo install expo-localization
```

**Files**
```
src/i18n/  index.ts  localize.ts  format.ts  i18next.d.ts  locales/{en,mr,hi}.json
```

**`locales/en.json`** (namespaced; `mr.json` / `hi.json` have identical keys)
```json
{
  "tabs": { "home": "Home", "categories": "Categories", "orders": "Orders", "account": "Account" },
  "common": { "retry": "Try again", "cancel": "Cancel", "save": "Save", "loading": "Loading…", "seeAll": "See all" },
  "cart": {
    "add": "ADD", "increase": "Add one more", "decrease": "Remove one",
    "inCart_one": "{{count}} in cart", "inCart_other": "{{count}} in cart",
    "maxPerOrder": "You can add up to {{max}} of this item"
  },
  "errors": {
    "offline": "You are offline. Showing saved data.",
    "server": "Something went wrong. Please try again.",
    "notFound": "This item is no longer available.",
    "forbidden": "You don't have access to this."
  },
  "settings": {
    "language": "Language", "theme": "Theme", "themeSystem": "Same as phone",
    "themeLight": "Light", "themeDark": "Dark", "largeText": "Large text"
  }
}
```
**`mr.json`** (excerpt): `"tabs": { "home": "होम", "categories": "विभाग", "orders": "ऑर्डर", "account": "खाते" }`, `"cart": { "add": "जोडा", … }`
**`hi.json`** (excerpt): `"tabs": { "home": "होम", "categories": "श्रेणियाँ", "orders": "ऑर्डर", "account": "खाता" }`, `"cart": { "add": "जोड़ें", … }`

> Have a native speaker review. Prefer everyday words people use in shops ("ऑर्डर", "कार्ट") over formal ones.

**`src/i18n/index.ts`**
```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import mr from './locales/mr.json';
import hi from './locales/hi.json';

export const LANGUAGES = [
  { code: 'mr', native: 'मराठी',   english: 'Marathi' },
  { code: 'hi', native: 'हिंदी',    english: 'Hindi' },
  { code: 'en', native: 'English', english: 'English' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

export function deviceLanguage(): Lang {
  const code = getLocales()[0]?.languageCode;
  return code === 'mr' || code === 'hi' ? code : 'en';
}

export function initI18n(lang: Lang) {
  if (i18n.isInitialized) return;
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, mr: { translation: mr }, hi: { translation: hi } },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}
export default i18n;
```

**Type-safe keys**, `src/i18n/i18next.d.ts`:
```ts
import 'i18next';
import en from './locales/en.json';
declare module 'i18next' {
  interface CustomTypeOptions { resources: { translation: typeof en } }
}
```

**`src/i18n/localize.ts`**
```ts
import type { Lang } from './index';
import { useSettings } from '@/stores/settings';

export type LocalizedString = Partial<Record<Lang, string | null>>;

/** current language → English → first non-empty value → '' */
export function localize(value: LocalizedString | null | undefined, lang: Lang): string {
  if (!value) return '';
  const pick = (v?: string | null) => (v && v.trim() ? v : undefined);
  return pick(value[lang]) ?? pick(value.en) ?? Object.values(value).map(pick).find(Boolean) ?? '';
}

export function useLocalize() {
  const lang = useSettings((s) => s.language);
  return (v: LocalizedString | null | undefined) => localize(v, lang);
}
```
Supabase returns `jsonb` as `Json` in the generated types; `asLocalized(json)` in `src/types/helpers.ts` (0.10) narrows it safely.

**`src/lib/format.ts`**: Indian formats:
```ts
import type { Lang } from '@/i18n';
const localeOf = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' } as const;

/** ₹1,00,000 ; paise shown only when non-zero (₹42.50) */
export const formatPrice = (n: number, lang: Lang) =>
  new Intl.NumberFormat(localeOf[lang], {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
    numberingSystem: 'latn',                        // Latin digits, as on price stickers
  }).format(n);

export const discountPercent = (price: number, mrp: number) =>
  mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0;

/** 500 g, 1 kg, 1.5 l, 6 pc */
export const formatQuantity = (q: number, unit: string) => `${q} ${unit}`;

export const formatDateTime = (d: Date | string, lang: Lang) =>
  new Intl.DateTimeFormat(localeOf[lang], {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata', numberingSystem: 'latn',
  }).format(new Date(d));
```
> Hermes ships `Intl`. Test `mr-IN` month names on a real old Android in this step; if they look wrong, fall back to `en-IN` for that formatter.

**Checks**
- Changing the language in Account relabels the tabs immediately, no restart.
- A fresh install on a phone set to Marathi starts in Marathi.

**Tests**
- `localize`: current language → `en` → any value; ignores blank strings; handles `null`.
- `formatPrice(100000, 'en') === '₹1,00,000'`, `formatPrice(42.5, 'en') === '₹42.50'`; `discountPercent(45, 50) === 10`.
- **Key parity:** `mr.json` and `hi.json` have exactly the key set of `en.json` (fails CI on a missing translation).

---

## 0.8 Supabase project, CLI & local stack

**Goal:** a local Supabase stack for development, a cloud project for real use, and the first migration (`0000_foundation.sql`) that every later phase builds on.

### Accounts & cloud project (one-time, free)

1. Sign up at supabase.com → **New project** → name `nearkart-prod`, region **South Asia (Mumbai)**, a strong DB password (save it in a password manager).
2. Optional but recommended: a second free project `nearkart-staging` (the free plan allows 2 active projects).
3. From **Project Settings → API**, note the **Project URL** and the **anon / publishable key**. They go into `mobile/.env.production`. The `service_role` / secret key is **never** copied into the app.

> ⚠️ Free projects **pause after 7 days with no activity**. During development you'll use it daily; a keep-alive ping is set up in Phase 9.7.

### CLI & local stack

Requires Docker Desktop (or OrbStack/Colima) running.

```bash
cd ~/Desktop/Om_Projects/nearkart
npm init -y
npm i -D supabase                       # CLI pinned per repo, run with npx
npx supabase init                       # creates supabase/config.toml
npx supabase start                      # Postgres, Auth, Realtime, Storage, Studio on localhost
npx supabase status                     # prints API URL, anon key, Studio URL (http://127.0.0.1:54323)
```

**Root `package.json` scripts**
```json
{
  "scripts": {
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:new": "supabase migration new",
    "db:lint": "supabase db lint --level warning",
    "db:test": "supabase test db",
    "db:types": "supabase gen types typescript --local --schema public > mobile/src/types/database.ts",
    "db:push": "supabase db push",
    "db:diff": "supabase db diff --schema public"
  }
}
```

**Migration workflow (all phases)**
- One file per phase as named in the plan: `supabase/migrations/0000_foundation.sql`, `0100_catalog.sql`, `0110_home.sql`, … The CLI accepts any `<digits>_<name>.sql` and applies them in numeric order. (If you create files with `supabase migration new`, it uses a timestamp prefix instead. Either works; just never mix the two styles or reorder applied files.)
- Edit SQL → `npm run db:reset` (rebuilds local DB from all migrations + `seed.sql`) → `npm run db:types` → app compiles.
- **Never edit a migration that has been pushed to the cloud.** Add a new one (`0105_fix_….sql`).
- Ship to cloud: `npx supabase link --project-ref <ref>` once, then `npm run db:push`.
- Prefer writing SQL by hand over Studio clicks. If you do change something in local Studio, capture it with `npm run db:diff` into a migration.

**`supabase/config.toml`** (edits to the generated file)
```toml
[api]
max_rows = 200              # hard cap per request; lists paginate anyway

[auth]
site_url = "nearkart://"
additional_redirect_urls = ["nearkart://**", "http://localhost:8081/**"]
# Google + email OTP are configured in Phase 3

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

### SQL: `supabase/migrations/0000_foundation.sql`

```sql
-- =====================================================================
-- 0000_foundation.sql: extensions, enums, shared helpers, profiles,
-- roles, app_config. Every later migration depends on this file.
-- =====================================================================

-- ---------- Extensions ------------------------------------------------
-- Supabase convention: extensions live in the `extensions` schema.
create extension if not exists pg_trgm  with schema extensions;   -- fuzzy search (Phase 2)
create extension if not exists unaccent with schema extensions;   -- accent-insensitive search (Phase 2)
create extension if not exists postgis  with schema extensions;   -- store location, service area (Phases 1, 3)
-- pg_cron is enabled in 0600_store_ops.sql (auto-cancel job). On the hosted project you
-- can also switch it on under Database → Extensions; the migration uses
-- `create extension if not exists pg_cron;` so both paths are safe.

-- ---------- Enums (plan §8.1, all created here) ------------------------
create type public.app_role          as enum ('customer', 'staff', 'admin');
create type public.order_status      as enum ('placed', 'confirmed', 'packing', 'packed',
                                              'out_for_delivery', 'delivered', 'cancelled');
create type public.payment_method    as enum ('cod', 'upi');
create type public.payment_status    as enum ('pending', 'paid', 'failed', 'refunded');
create type public.cancel_actor      as enum ('customer', 'store', 'system');
create type public.order_item_status as enum ('active', 'unavailable');
create type public.stock_reason      as enum ('order', 'order_cancel', 'item_unavailable',
                                              'restock', 'adjustment', 'damage', 'initial');
create type public.issue_type        as enum ('missing_item', 'damaged', 'wrong_item', 'quality', 'other');
create type public.issue_status      as enum ('open', 'resolved', 'rejected');
create type public.section_type      as enum ('banner_carousel', 'category_grid', 'product_rail',
                                              'collection_rail', 'buy_again');

-- ---------- Shared helpers --------------------------------------------
-- Keeps updated_at current. Attach with:
--   create trigger set_updated_at before update on public.<t>
--   for each row execute function public.set_updated_at();
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Validates a {en, mr, hi} jsonb value: an object, only known keys, string values,
-- and a non-empty English value. Used in CHECK constraints from Phase 1 on.
create or replace function public.is_localized_text(v jsonb, require_en boolean default true)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null
     and jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each(v) e
       where e.key not in ('en', 'mr', 'hi')
          or jsonb_typeof(e.value) not in ('string', 'null')
     )
     and (not require_en or coalesce(btrim(v ->> 'en'), '') <> '');
$$;

-- ---------- Profiles ---------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text check (char_length(full_name) <= 100),
  email        text,
  phone        text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  avatar_path  text,                                   -- path in the `avatars` bucket (Phase 3)
  language     text not null default 'en' check (language in ('en', 'mr', 'hi')),
  role         public.app_role not null default 'customer',
  is_blocked   boolean not null default false,
  cod_allowed  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where role <> 'customer';

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- Role helpers (used by RLS everywhere) -----------------------
-- SECURITY DEFINER so they can read profiles without recursing into profiles' own RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('staff', 'admin')
      and not p.is_blocked
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and not p.is_blocked
  );
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- New user → profile row --------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  lang text  := meta ->> 'language';
begin
  insert into public.profiles (id, email, full_name, language)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(meta ->> 'full_name', meta ->> 'name', ''), 100), ''),
    case when lang in ('en', 'mr', 'hi') then lang else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Protect privileged profile columns --------------------------
-- A customer may edit their name/phone/language/avatar, but never role,
-- is_blocked or cod_allowed. Admins change those via admin_set_role() (Phase 7).
-- auth.uid() is NULL for the SQL editor / service role, which lets the owner
-- bootstrap the first admin (see "First admin" below).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role        is distinct from old.role
    or new.is_blocked  is distinct from old.is_blocked
    or new.cod_allowed is distinct from old.cod_allowed
    or new.id          is distinct from old.id
    or new.email       is distinct from old.email then
      raise exception 'not allowed to change protected profile fields'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------- Profiles RLS -----------------------------------------------
alter table public.profiles enable row level security;

-- Own row, or any row for staff (they need the customer's name/phone on orders).
create policy "profiles: read own or staff"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: admin update any"
  on public.profiles for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No insert policy: rows are created only by handle_new_user().
-- No delete policy: account deletion goes through delete_my_account() (Phase 3.8).

-- ---------- App config ---------------------------------------------------
create table public.app_config (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value       jsonb not null,
  is_public   boolean not null default true,         -- false = staff/admin only
  description text,
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

alter table public.app_config enable row level security;

create policy "app_config: public read"
  on public.app_config for select
  to anon, authenticated
  using (is_public or (select public.is_staff()));

create policy "app_config: admin write"
  on public.app_config for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

insert into public.app_config (key, value, description) values
  ('min_app_version', '{"android": "0.1.0", "ios": "0.1.0"}',
     'Builds below this must update (force-update screen, Phase 9.9)'),
  ('maintenance',     '{"enabled": false, "message": {"en": "We are updating the app. Back soon!", "mr": "ॲप अपडेट होत आहे. लवकरच परत येऊ!", "hi": "ऐप अपडेट हो रहा है। जल्द वापस आएँगे!"}}',
     'Shows a full-screen message and blocks checkout'),
  ('support',         '{"phone": "+910000000000", "whatsapp": "+910000000000", "email": "support@example.com", "hours": {"en": "7 AM – 10 PM", "mr": "सकाळी ७ – रात्री १०", "hi": "सुबह 7 – रात 10"}}',
     'Help screen and "Call store" buttons'),
  ('legal_urls',      '{"privacy": "", "terms": "", "refunds": ""}',
     'Filled in Phase 9.8')
on conflict (key) do nothing;
```

> **Grants:** Supabase's default privileges already grant `select/insert/update/delete` on new `public` tables to `anon` and `authenticated`. That is safe **only** because RLS is enabled on every table; a table without policies returns nothing. The plan's rule "RLS on every table" is checked by `supabase db lint` and the Security Advisor.

### First admin (one-time)

After you sign in once in Phase 3 (or create a user in Studio → Authentication), run in the SQL editor (it runs as `postgres`, so `auth.uid()` is null and the protect trigger lets it through):
```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### `supabase/seed.sql` (Phase 0 part; later phases append)

```sql
-- Local development only. `supabase db reset` runs this after all migrations.
-- Test users (password: password123). Profiles are created by handle_new_user().
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'admin@nearkart.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Store Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'staff@nearkart.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Counter Staff"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'customer@nearkart.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"],"language":"mr"}', '{"full_name":"Test Customer","language":"mr"}', now(), now());

update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'staff' where id = '22222222-2222-2222-2222-222222222222';
```
(`crypt`/`gen_salt` come from `pgcrypto`, which Supabase enables in the `extensions` schema; the seed runs as `postgres` with `extensions` on the search path.)

### pgTAP test: `supabase/tests/0000_foundation.test.sql`

```sql
begin;
select plan(7);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'app_config', 'app_config exists');

-- every public table has RLS on
select is(
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
  0::bigint, 'RLS enabled on every public table');

-- the seed customer got a profile with language from metadata
select is((select language from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
          'mr', 'handle_new_user copied language');

-- act as the customer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'customer cannot promote themselves');

select lives_ok(
  $$ update public.profiles set full_name = 'Renamed' where id = '33333333-3333-3333-3333-333333333333' $$,
  'customer can edit own name');

select is((select count(*) from public.profiles), 1::bigint, 'customer sees only own profile');

select * from finish();
rollback;
```

**Checks**
- `npm run db:reset` finishes with no errors; Studio shows `profiles` (3 rows) and `app_config` (4 rows).
- In Studio's SQL editor, `select public.is_staff();` returns `false` (no JWT); the pgTAP test proves the logged-in cases.
- `npm run db:lint` reports no errors.

**Tests**
- `npm run db:test` runs the file above (7 passing).

---

## 0.9 Supabase client, TanStack Query, MMKV storage

**Goal:** one Supabase client with a secure persisted session, typed error mapping, a server-state cache that survives restarts and works offline, and a persisted settings store.

**Commands** (in `mobile/`)
```bash
npm i @supabase/supabase-js @tanstack/react-query @tanstack/react-query-persist-client \
      @tanstack/query-sync-storage-persister zustand
npx expo install react-native-mmkv expo-secure-store expo-crypto \
      @react-native-community/netinfo react-native-url-polyfill
```

**Files**
```
src/
  lib/storage.ts           # MMKV instances (general + encrypted auth) and adapters
  lib/supabase.ts          # the one Supabase client
  lib/errors.ts            # AppError + toAppError()
  lib/queryClient.ts       # QueryClient + persister + online/focus managers
  stores/settings.ts       # Zustand: language, theme, textScale, hasOnboarded
  providers/Providers.tsx  # provider tree
  features/config/api.ts, hooks.ts   # useAppConfig (smoke test)
```

### Session storage: why not plain SecureStore

A Supabase session (access JWT + refresh token + user object) is often **larger than 2048 bytes**, and `expo-secure-store` warns and may fail above that on iOS/Android. AsyncStorage is unencrypted.

**Decision:** keep the session in a **separate, encrypted MMKV instance**, and keep only that instance's **encryption key in SecureStore** (Keychain / Android Keystore). This is fast (MMKV is synchronous), has no size limit, and the data at rest is encrypted with a key the OS protects. On **web** (admin in a browser), the Supabase default `localStorage` is used instead.

**`src/lib/storage.ts`**
```ts
import { Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { StateStorage } from 'zustand/middleware';

// General app storage: settings, query cache, guest cart (not secret)
export const storage = new MMKV({ id: 'nearkart' });

// MMKV's encryptionKey is limited to 16 bytes (AES-128). Make a random 16-char key once.
const KEY_NAME = 'nk_auth_storage_key';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function authKey(): string {
  let key = SecureStore.getItem(KEY_NAME);                 // synchronous API (expo-secure-store ≥ 13)
  if (!key) {
    const bytes = Crypto.getRandomBytes(16);
    key = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    SecureStore.setItem(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  }
  return key;
}

// Encrypted instance for the Supabase session (native only)
const authStorage = Platform.OS === 'web' ? null : new MMKV({ id: 'nearkart-auth', encryptionKey: authKey() });

/** Storage adapter for supabase-js `auth.storage` (sync values are fine; the interface accepts promises or values) */
export const supabaseAuthStorage = authStorage && {
  getItem: (k: string) => authStorage.getString(k) ?? null,
  setItem: (k: string, v: string) => authStorage.set(k, v),
  removeItem: (k: string) => authStorage.delete(k),
};

export const zustandStorage: StateStorage = {
  getItem: (k) => storage.getString(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};

export const queryStorage = {
  getItem: (k: string) => storage.getString(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
};
```
> MMKV v4 replaced `new MMKV()` with `createMMKV()`. Use whichever your installed major version documents; the rest is identical.
> On reinstall, iOS can keep Keychain items while app data is wiped. That's harmless here: the key is reused and the empty MMKV just means "logged out".

### The Supabase client

**`src/lib/supabase.ts`**
```ts
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env } from '@/config/env';
import { supabaseAuthStorage } from './storage';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    ...(supabaseAuthStorage ? { storage: supabaseAuthStorage } : {}),   // web: default localStorage
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  realtime: { params: { eventsPerSecond: 10 } },
  global: { headers: { 'x-client-info': `nearkart-${Platform.OS}` } },
});

// Refresh tokens only while the app is in the foreground. Timers don't run
// reliably in the background on mobile, so stop/start explicitly.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
```
Only `src/features/*/api.ts`, `src/lib/*` and providers may import this (lint rule in 0.3).

### Errors

**`src/lib/errors.ts`**: one error type for the UI, whatever Supabase returns:
```ts
import type { PostgrestError } from '@supabase/supabase-js';

export type AppErrorKind =
  | 'network' | 'unauthorized' | 'forbidden' | 'notFound' | 'validation' | 'conflict' | 'server';

export class AppError extends Error {
  constructor(public kind: AppErrorKind, message?: string, public code?: string, public details?: unknown) {
    super(message ?? kind);
  }
  get retryable() { return this.kind === 'network' || this.kind === 'server'; }
}

/** Map supabase-js / PostgREST / Postgres errors to AppError.
 *  Our RPCs raise with SQLSTATE 'P0001' and a machine code in the message, e.g. 'OUT_OF_STOCK'. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as Partial<PostgrestError> & { message?: string; status?: number };
  const msg = err?.message ?? '';
  const code = err?.code ?? '';

  if (/Network request failed|Failed to fetch|fetch failed/i.test(msg)) return new AppError('network', msg);
  if (code === 'PGRST301' || code === 'PGRST302' || err?.status === 401) return new AppError('unauthorized', msg, code);
  if (code === '42501') return new AppError('forbidden', msg, code);           // RLS / privilege
  if (code === 'PGRST116') return new AppError('notFound', msg, code);         // .single() found 0 rows
  if (code === '23505') return new AppError('conflict', msg, code);            // unique violation
  if (code.startsWith('23') || code === '22P02' || code === 'P0001') return new AppError('validation', msg, code, err?.details);
  return new AppError('server', msg, code);
}

/** Unwrap { data, error } from any supabase call */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data as T;
}
```

### TanStack Query + offline persistence

**`src/lib/queryClient.ts`**
```ts
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AppError } from './errors';
import { queryStorage } from './storage';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)),
);

AppState.addEventListener('change', (status) => {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');   // refetch on return (covers missed Realtime events)
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,                       // catalog hooks override with longer times; live data uses Realtime
      gcTime: 24 * 60 * 60_000,                // keep 24 h (needed for persistence)
      retry: (count, err) => (err instanceof AppError ? err.retryable && count < 2 : count < 2),
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'online', retry: 0 },   // never silently replay money/stock writes
  },
});

export const persister = createSyncStoragePersister({ storage: queryStorage, key: 'rq-cache', throttleTime: 1000 });

/** Query keys that must NOT be persisted (fresh-only: cart quote, checkout) */
export const NO_PERSIST_PREFIXES = ['cartQuote', 'checkout'];
```
> **Mutations use `networkMode: 'online'`**: placing an order offline must fail visibly, not queue and fire later at a different price (plan §12).

### Settings store

**`src/stores/settings.ts`**
```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import i18n, { deviceLanguage, type Lang } from '@/i18n';
import { zustandStorage } from '@/lib/storage';

type Theme = 'system' | 'light' | 'dark';
type SettingsState = {
  language: Lang;
  theme: Theme;
  textScale: 1 | 1.2;
  hasOnboarded: boolean;         // language + location onboarding (Phases 1 and 3)
  setLanguage: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setLargeText: (on: boolean) => void;
  completeOnboarding: () => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      theme: 'system',
      textScale: 1,
      hasOnboarded: false,
      setLanguage: (language) => { void i18n.changeLanguage(language); set({ language }); },
      setTheme: (theme) => set({ theme }),
      setLargeText: (on) => set({ textScale: on ? 1.2 : 1 }),
      completeOnboarding: () => set({ hasOnboarded: true }),
    }),
    { name: 'settings', version: 1, storage: createJSONStorage(() => zustandStorage) },
  ),
);
```
In Phase 3, a logged-in user's language is also written to `profiles.language` so notifications (Phase 5) arrive in their language.

### Provider tree

**`src/providers/Providers.tsx`**
```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { queryClient, persister, NO_PERSIST_PREFIXES } from '@/lib/queryClient';
import { useSyncNativewindScheme } from '@/theme/useTheme';
import { ToastHost } from '@/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  useSyncNativewindScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister,
              maxAge: 24 * 60 * 60_000,
              buster: 'schema-0000',                 // bump when a migration changes response shapes
              dehydrateOptions: {
                shouldDehydrateQuery: (q) =>
                  q.state.status === 'success' &&
                  !NO_PERSIST_PREFIXES.includes(String(q.queryKey[0])),
              },
            }}
          >
            <BottomSheetModalProvider>
              {children}
              <ToastHost />
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```
Phase 3 adds an `AuthProvider` (listens to `supabase.auth.onAuthStateChange`) and Phase 1 a `RealtimeManager` (`src/lib/realtime.ts`) inside this tree.

### Smoke test: read `app_config`

**`src/features/config/api.ts`**
```ts
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

export const fetchPublicConfig = () =>
  unwrap(supabase.from('app_config').select('key, value').eq('is_public', true));
```

**`src/features/config/hooks.ts`**
```ts
import { useQuery } from '@tanstack/react-query';
import { fetchPublicConfig } from './api';

export const useAppConfig = () =>
  useQuery({
    queryKey: ['appConfig'],
    queryFn: fetchPublicConfig,
    staleTime: 10 * 60_000,
    select: (rows) => Object.fromEntries(rows.map((r) => [r.key, r.value])),
  });
```
The **Home** placeholder shows "Supabase OK · min version 0.1.0" or `<ErrorState>` with Retry. The **Account** placeholder wires the settings: a language selector (3 big buttons using `LANGUAGES[].native`), a theme segmented control and a large-text switch. This proves 0.5–0.9 together.

**Checks**
- Kill and reopen the app: language, theme and large text are kept.
- Airplane mode after one load: Home still shows the cached config and `onlineManager.isOnline()` is `false`.
- `npx supabase stop`, clear the app's data: `ErrorState` + Retry appears. `npx supabase start`, tap Retry: data loads.
- Real phone on Wi-Fi works with `EXPO_PUBLIC_SUPABASE_URL=http://<LAN-IP>:54321`.

**Tests**
- `errors.test.ts`: `toAppError` maps a network `TypeError` → `network`, `42501` → `forbidden`, `PGRST116` → `notFound`, `23505` → `conflict`, `P0001` → `validation`, anything else → `server`; `unwrap` throws on `error` and returns `data` otherwise.
- `settings.test.ts`: `setLanguage` calls `i18n.changeLanguage` and persists (MMKV mocked with an in-memory map in `jest.setup.ts`).
- `useAppConfig.test.tsx`: with `fetchPublicConfig` mocked, the hook returns `{ min_app_version: {...} }`.

---

## 0.10 Generated DB types

**Goal:** the app breaks at compile time when the schema changes, instead of at runtime on a customer's phone.

**Command** (repo root, local stack running)
```bash
npm run db:types        # supabase gen types typescript --local --schema public > mobile/src/types/database.ts
```
For the cloud project: `npx supabase gen types typescript --project-id <ref> --schema public`.

**`mobile/src/types/helpers.ts`**: short aliases used across features:
```ts
import type { Database } from './database';
import type { LocalizedString } from '@/i18n/localize';

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
export type RpcArgs<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Args'];
export type RpcReturns<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Returns'];

export type Profile = Tables<'profiles'>;
export type AppRole = Enums<'app_role'>;

/** jsonb {en,mr,hi} comes back as `Json`; narrow it without trusting it blindly */
export function asLocalized(v: unknown): LocalizedString {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' ? x : undefined);
  return { en: s(o.en), mr: s(o.mr), hi: s(o.hi) };
}
```

**Rules**
- `database.ts` is generated, committed, and never edited by hand (excluded from lint and Prettier).
- Every PR that adds a migration also includes the regenerated `database.ts`. CI checks this (0.11).
- RPCs that return `jsonb` (e.g. `get_home`, `get_cart_quote`) also get a hand-written zod schema in their feature's `types.ts`, because generated types can only say `Json`.

**Checks**
- Renaming a column in a migration and regenerating makes `npm run typecheck` fail where it's used.

---

## 0.11 CI pipeline (GitHub Actions)

**Goal:** every push and PR is linted, type-checked and tested, for the app **and** the database, for free.

**Jest setup** (in `mobile/`)
```bash
npx expo install jest-expo jest @types/jest
npm i -D @testing-library/react-native
```
`mobile/package.json`:
```json
"jest": {
  "preset": "jest-expo",
  "setupFiles": ["./jest.setup.ts"],
  "moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" },
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|@gorhom/.*|@supabase/.*)"
  ]
}
```
`jest.setup.ts`: mock `react-native-mmkv` (in-memory map), `expo-secure-store`, `expo-crypto`, `expo-haptics`, `expo-localization`, the NetInfo jest mock, and `@/lib/supabase` (feature tests mock their own `api.ts` instead of the network).

**`.github/workflows/ci.yml`**
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }

jobs:
  mobile:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: mobile } }
    env:
      EXPO_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
      EXPO_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon-key-not-secret
      EXPO_PUBLIC_WEB_URL: http://localhost:8081
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: mobile/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --ci --coverage
      - run: npx expo-doctor

  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase db start            # Postgres only; applies migrations + seed
      - run: supabase db lint --level warning
      - run: supabase test db              # pgTAP: supabase/tests/*.sql
      - name: Generated types are up to date
        run: |
          supabase gen types typescript --local --schema public > /tmp/database.ts
          diff -u mobile/src/types/database.ts /tmp/database.ts
```
Native builds are **not** run in CI (keeps inside free minutes); release builds are made locally (Phase 9). Deploying migrations to the cloud project is a **manual** `npm run db:push` until Phase 9, so a bad migration never auto-applies to real orders.

**Branch protection** (GitHub → Settings → Branches): require `CI / mobile` and `CI / database` before merging to `main`.

**Checks**
- A PR with a type error, a failing pgTAP assertion, or a migration without regenerated types goes red and can't merge.

---

## Phase 0 wrap-up

**Final structure**
```
nearkart/
  .github/workflows/ci.yml
  .husky/pre-commit
  package.json                      # db:* scripts, supabase CLI
  docs/                             # REACT_NATIVE_PLAN.md, phases/
  supabase/
    config.toml
    migrations/0000_foundation.sql
    seed.sql
    tests/0000_foundation.test.sql
  mobile/
    app/
      _layout.tsx
      (shop)/_layout.tsx  index.tsx  categories.tsx  orders.tsx  account.tsx
      dev/ui.tsx
      +not-found.tsx
    src/
      config/     env.ts
      features/   config/{api.ts, hooks.ts}
      i18n/       index.ts  localize.ts  i18next.d.ts  locales/{en,mr,hi}.json
      lib/        supabase.ts  storage.ts  errors.ts  queryClient.ts  format.ts  logger.ts  contrast.ts
      providers/  Providers.tsx
      stores/     settings.ts
      theme/      tokens.ts  useTheme.ts  fonts.ts
      types/      database.ts (generated)  helpers.ts
      ui/         Text Button IconButton Card Chip Screen Stepper PriceTag VegMark Badge
                  Skeleton EmptyState ErrorState Sheet Toast index.ts
    app.config.ts  babel.config.js  metro.config.js  tailwind.config.js  global.css
    eslint.config.js  .prettierrc  tsconfig.json  jest.setup.ts  .env.example
```

**Demo script (review before Phase 1)**
1. `npm run db:reset` → Studio shows 3 test profiles (admin, staff, customer) and 4 `app_config` rows.
2. Fresh install on Android → app opens in the phone's language; 4 tabs: Home, Categories, Orders, Account.
3. Account → मराठी → tabs relabel instantly. Dark → theme flips. Large text → text grows. Kill and reopen → all kept.
4. Home shows "Supabase OK". Airplane mode → still shows it from cache. Stop Supabase + clear data → ErrorState + Retry works.
5. `/dev/ui` shows the Stepper, PriceTag and VegMark in all states, both themes.
6. `npm run db:test` → 7 passing. PR on GitHub → both CI jobs green.

**Carry-overs into Phase 1**
- `0100_catalog.sql` uses the enums, `set_updated_at()`, `is_localized_text()` and `is_staff()/is_admin()` from this file.
- Add `src/lib/realtime.ts` (channel manager) and mount it in `Providers`.
- Add the floating cart bar slot to `(shop)/_layout.tsx`.
- Bump the persister `buster` whenever a migration changes the shape of cached data.
