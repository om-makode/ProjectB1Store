# Phase 3: Accounts, Addresses & Serviceability

> **Goal:** know **who** is ordering and **where** to deliver. One-tap Google or email-code login (only when needed), a profile, an address book with a map pin, and a server-side check that says whether the store delivers to that spot.
> **Duration:** about 1 week · **Depends on:** Phase 1 (stores, `store_status()`), Phase 0 (profiles, roles) · **Next:** Phase 4 (Cart & Checkout)

**Done when:**
- [ ] A guest can browse everything; login is asked **only** at checkout, wishlist or "Notify me", with a one-line reason
- [ ] Google Sign-In works on an Android device (debug **and** release keystore) and on iOS; email OTP works using a free SMTP (Brevo) in production and Inbucket locally
- [ ] Profile shows name, email, phone and photo; edits are saved; language choice is saved to `profiles.language`
- [ ] First launch asks for location ("Use current location" / "Pick on map"); the header shows **"Delivering to 📍 …"** or **"Not delivering here yet"**
- [ ] A user can add, edit, set default and delete addresses; each address is checked against the delivery area by the **server** (`addresses.is_serviceable`)
- [ ] The store banner shows Open / Busy / Closed (opens at …) live, and the rules for what's allowed in each state are applied
- [ ] "Delete my account" works from the app
- [ ] `0300_accounts_addresses.sql` applies cleanly with `supabase db reset`; pgTAP tests pass; `supabase gen types` re-run

| # | Heading | Output |
|---|---|---|
| — | Migration | `supabase/migrations/0300_accounts_addresses.sql` |
| 3.1 | Supabase Auth: Google + email OTP | Google Cloud clients, Supabase providers, SMTP, `auth/login.tsx`, `auth/verify.tsx` |
| 3.2 | Session & login gate | `useAuth`, `AuthProvider`, `useRequireLogin`, post-login hooks |
| 3.3 | Profile & settings | `account/profile.tsx`, avatar upload, language sync |
| 3.4 | Location onboarding | `(onboarding)/location.tsx`, `useLocationStore` |
| 3.5 | Address book & map pin | `MapPinPicker`, `AddressForm`, address screens |
| 3.6 | Serviceability check | `check_serviceability()`, `useServiceability()`, service-area setup |
| 3.7 | Store open/closed rules | `StoreStatusBanner`, state matrix |
| 3.8 | Delete account | `delete_my_account()`, `account/delete.tsx` |

---

## Migration: `0300_accounts_addresses.sql`

All SQL for this phase in one file, applied in this order. It assumes from earlier phases:

- Phase 0: extensions `postgis`, `pg_trgm`, `unaccent` installed in schema `extensions`; schema `private` (not exposed by the API); `public.set_updated_at()`; `public.profiles` (`id` → `auth.users(id) on delete cascade`); `public.is_staff()`, `public.is_admin()`.
- Phase 1: `public.stores` with `id bigint`, `location geography(Point)`, `service_radius_km`, `service_area geography(Polygon) null`, `eta_minutes`; `public.store_status(store_id)`.

```sql
-- ============================================================================
-- 0300_accounts_addresses.sql
-- Addresses, serviceability, account deletion, avatars bucket
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Serviceability (used by addresses trigger, the app, and Phase 4 checkout)
-- ---------------------------------------------------------------------------

-- Internal: works on a geography point. Picks the best store for the point:
-- a store whose area covers it (nearest first); otherwise the nearest store
-- (so the UI can say "nearest store is 7.4 km away").
create or replace function private.serviceability_for_point(p_point extensions.geography)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_point is null then
    return jsonb_build_object('serviceable', false, 'reason', 'NO_LOCATION');
  end if;

  select
    s.id,
    s.eta_minutes,
    extensions.st_distance(s.location, p_point) / 1000.0 as distance_km,
    case
      when s.service_area is not null then extensions.st_covers(s.service_area, p_point)
      else extensions.st_dwithin(s.location, p_point, coalesce(s.service_radius_km, 0) * 1000.0)
    end as inside
  into v_row
  from public.stores s
  where s.location is not null
  order by inside desc, distance_km asc
  limit 1;

  if not found then
    return jsonb_build_object('serviceable', false, 'reason', 'NO_STORE');
  end if;

  return jsonb_build_object(
    'serviceable',      coalesce(v_row.inside, false),
    'store_id',         case when v_row.inside then v_row.id end,
    'nearest_store_id', v_row.id,
    'distance_km',      round(v_row.distance_km::numeric, 2),
    'eta_minutes',      case when v_row.inside then v_row.eta_minutes end,
    'reason',           case when v_row.inside then null else 'OUTSIDE_AREA' end
  );
end;
$$;

-- Public: lat/lng in, answer out. Callable by guests (onboarding, map pin).
create or replace function public.check_serviceability(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;

  return private.serviceability_for_point(
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  );
end;
$$;

revoke all on function public.check_serviceability(double precision, double precision) from public;
grant execute on function public.check_serviceability(double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Addresses
-- ---------------------------------------------------------------------------

create table public.addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label           text not null default 'home' check (label in ('home', 'work', 'other')),
  receiver_name   text not null check (char_length(btrim(receiver_name)) between 2 and 80),
  receiver_phone  text not null check (receiver_phone ~ '^[6-9][0-9]{9}$'),   -- 10-digit Indian mobile, no +91
  house           text not null check (char_length(btrim(house)) between 1 and 120),   -- flat / house no. / building
  area            text not null check (char_length(btrim(area)) between 2 and 160),    -- street / locality
  landmark        text check (landmark is null or char_length(landmark) <= 120),
  city            text not null check (char_length(btrim(city)) between 2 and 80),
  pincode         text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  latitude        double precision not null check (latitude between -90 and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  location        extensions.geography(Point, 4326) not null,   -- set by trigger from lat/lng
  is_serviceable  boolean not null default false,                -- set by trigger, never by the client
  is_default      boolean not null default false,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.addresses is 'Customer delivery addresses. Soft-deleted (deleted_at) so old orders keep their address_id.';

create index addresses_user_idx on public.addresses (user_id) where deleted_at is null;
-- At most one default address per user (among live addresses).
create unique index addresses_one_default_per_user
  on public.addresses (user_id) where is_default and deleted_at is null;

-- Trigger: compute location + serviceability, keep exactly one default, limit count.
create or replace function private.addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live_count int;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'ADDRESS_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;

  new.location := extensions.st_setsrid(
    extensions.st_makepoint(new.longitude, new.latitude), 4326
  )::extensions.geography;

  new.is_serviceable := coalesce(
    (private.serviceability_for_point(new.location) ->> 'serviceable')::boolean, false
  );

  if new.deleted_at is not null then
    new.is_default := false;
    return new;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_live_count
    from public.addresses a
    where a.user_id = new.user_id and a.deleted_at is null;

    if v_live_count >= 20 then
      raise exception 'ADDRESS_LIMIT' using errcode = 'P0001';
    end if;

    if v_live_count = 0 then
      new.is_default := true;          -- the first address is the default
    end if;
  end if;

  if new.is_default then
    update public.addresses a
       set is_default = false
     where a.user_id = new.user_id
       and a.is_default
       and a.id <> new.id;
  end if;

  return new;
end;
$$;

create trigger addresses_before_write
  before insert or update on public.addresses
  for each row execute function private.addresses_before_write();

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

alter table public.addresses enable row level security;

create policy "addresses: read own live"
  on public.addresses for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

create policy "addresses: insert own"
  on public.addresses for insert to authenticated
  with check (user_id = (select auth.uid()) and deleted_at is null);

create policy "addresses: update own live"
  on public.addresses for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- No DELETE policy: deletion is soft, through delete_address().
revoke delete on public.addresses from anon, authenticated;
revoke all on public.addresses from anon;

-- Soft delete + promote another address to default if needed.
create or replace function public.delete_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  update public.addresses a
     set deleted_at = now()
   where a.id = p_address_id
     and a.user_id = v_uid
     and a.deleted_at is null;

  if not found then
    raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The trigger cleared is_default on the deleted row; if the user now has no
  -- default, promote the most recently used live address.
  if not exists (
    select 1 from public.addresses a
    where a.user_id = v_uid and a.deleted_at is null and a.is_default
  ) then
    update public.addresses a
       set is_default = true
     where a.id = (
       select a2.id from public.addresses a2
       where a2.user_id = v_uid and a2.deleted_at is null
       order by a2.updated_at desc
       limit 1
     );
  end if;
end;
$$;

revoke all on function public.delete_address(uuid) from public, anon;
grant execute on function public.delete_address(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Account deletion (DPDP Act + Play Store requirement)
-- Phase 4 replaces this function to also (a) refuse while orders are open and
-- (b) anonymise past orders, which must be kept for GST records.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  delete from public.addresses where user_id = v_uid;

  -- Removes the login. profiles (and everything that cascades from it) go with it.
  -- Avatar files are removed by the app through the Storage API first (direct
  -- deletes from storage.objects are blocked by Supabase).
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Avatars bucket: public read, each user writes only <uid>/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: update own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

**Why `latitude`/`longitude` columns as well as `location`?** The app sends plain numbers (easy with supabase-js and the generated types) and reads them back as numbers. `location` (PostGIS `geography`) is what distance and polygon checks use. The trigger keeps them in sync, so the client can never send a `location` that disagrees with the numbers.

**Why `is_serviceable` is stored:** the address list can show "Not deliverable" without a call per address. It is recomputed on every write, and **Phase 4 re-checks live** in `get_cart_quote()` / `place_order()`, because the admin can shrink the delivery area later.

After applying: `supabase db reset` locally, then `npm run gen:types` (Phase 0.10) so `addresses`, `check_serviceability`, `delete_address` and `delete_my_account` appear in `src/types/database.ts`.

---

## 3.1 Supabase Auth: Google + email OTP

**Goal:** two free login methods. **Google** is one tap on Android (most users already have a Google account on the phone). **Email code** is the fallback for anyone without Google, and for iOS users who prefer it. Phone OTP is skipped because SMS always costs money ⚠️; the phone number is collected on the address form instead (3.5).

### Google Cloud setup (one-time, free, no billing account)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project **NearKart**.
2. **OAuth consent screen** → External → app name, support email, logo, privacy policy URL (Phase 9 hosts it; a placeholder GitHub Pages URL works until then). Scopes: `openid`, `email`, `profile` only. Publish the app (no verification is needed for these basic scopes).
3. **Credentials → Create OAuth client ID**, three times:

| Client | Fields | Used where |
|---|---|---|
| **Web application** | (no redirect URIs needed for native) | `webClientId` in the app **and** "Client IDs" in Supabase. The ID token's audience is this client. |
| **Android** | Package `in.nearkart.app`, SHA-1 of **each** signing key: debug (`cd android && ./gradlew signingReport`, or `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`), your upload key, **and the Play App Signing key** (Play Console → Setup → App integrity) | Lets Google return a token to this app. Missing the Play signing SHA-1 is the #1 reason Google login works in testing but fails for Play Store users. |
| **iOS** | Bundle ID `in.nearkart.app` | `iosClientId` + `iosUrlScheme` |

### Supabase setup

Dashboard → **Authentication → Sign In / Providers → Google**:
- Enable. **Client IDs:** `<WEB_CLIENT_ID>,<IOS_CLIENT_ID>` (comma-separated, web first). Client secret: the web client's secret.
- **Skip nonce checks: ON.** See "Nonce" below.

Local (`supabase/config.toml`):

```toml
[auth]
site_url = "nearkart://"
additional_redirect_urls = ["nearkart://**"]
jwt_expiry = 3600
enable_signup = true

[auth.external.google]
enabled = true
client_id = "env(GOOGLE_WEB_CLIENT_ID)"
secret = "env(GOOGLE_WEB_CLIENT_SECRET)"
skip_nonce_check = true

[auth.email]
enable_signup = true
enable_confirmations = false      # the OTP itself proves the email
otp_length = 6
otp_expiry = 600                  # 10 minutes
max_frequency = "60s"             # one code per minute per address

[auth.email.template.magic_link]
subject = "Your NearKart login code"
content_path = "./supabase/templates/otp.html"

[auth.email.template.confirmation]
subject = "Your NearKart login code"
content_path = "./supabase/templates/otp.html"

[auth.rate_limit]
email_sent = 30                   # per hour, project-wide; raise once custom SMTP is on
```

### Free SMTP for email codes (Brevo)

Supabase's built-in email sender is for testing only (a few emails per hour, and only to team addresses). For real users:

1. Create a free **Brevo** account (≈300 emails/day). Verify a sender (your domain is best; a Gmail sender works but lands in spam more often).
2. Brevo → SMTP & API → create an SMTP key.
3. Supabase Dashboard → **Authentication → Emails → SMTP Settings**: host `smtp-relay.brevo.com`, port `587`, user = your Brevo login, password = the SMTP key, sender `no-reply@<your-domain>`, name `NearKart`.
4. Raise **Rate limits → emails per hour** to e.g. 100.

Locally, `supabase start` catches all emails in **Inbucket** at `http://localhost:54324`, so no SMTP is needed during development.

### OTP email template (`supabase/templates/otp.html`)

Both "Magic link" and "Confirm signup" templates must show `{{ .Token }}` (a brand-new email gets the signup template, an existing one gets the magic-link template). The language comes from `user_metadata.language`, which the app sends on the first request.

```html
<div style="font-family: 'Noto Sans', 'Noto Sans Devanagari', Arial, sans-serif; font-size: 16px">
  {{ if eq .Data.language "mr" }}
    <p>तुमचा NearKart लॉगिन कोड:</p>
  {{ else if eq .Data.language "hi" }}
    <p>आपका NearKart लॉगिन कोड:</p>
  {{ else }}
    <p>Your NearKart login code:</p>
  {{ end }}
  <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold">{{ .Token }}</p>
  {{ if eq .Data.language "mr" }}
    <p>हा कोड १० मिनिटांसाठी वैध आहे. तो कोणालाही सांगू नका.</p>
  {{ else if eq .Data.language "hi" }}
    <p>यह कोड 10 मिनट तक मान्य है। इसे किसी को न बताएँ।</p>
  {{ else }}
    <p>This code is valid for 10 minutes. Don't share it with anyone.</p>
  {{ end }}
</div>
```

### Packages & config

```bash
npx expo install @react-native-google-signin/google-signin expo-crypto
```

`app.config.ts` (additions):

```ts
plugins: [
  // …
  ['@react-native-google-signin/google-signin', {
    iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME, // com.googleusercontent.apps.<reversed iOS client id>
  }],
],
extra: {
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
},
```

Rebuild the dev client after adding the plugin (`npx expo run:android`).

### Files

```
mobile/src/features/auth/
  google.ts            # configure + signInWithGoogle()
  emailOtp.ts          # requestEmailCode(), verifyEmailCode()
  errors.ts            # map Supabase/Google errors → i18n keys
mobile/app/auth/
  login.tsx            # reason line, Google button, email field
  verify.tsx           # 6-digit code, resend timer
supabase/templates/otp.html
```

### `google.ts`

```ts
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { supabase } from '@/lib/supabase';
import { env } from '@/config/env';

let configured = false;
function configure() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: env.googleWebClientId,   // must be the WEB client id
    iosClientId: env.googleIosClientId,
    scopes: ['email', 'profile'],
  });
  configured = true;
}

export type GoogleResult = { status: 'ok' } | { status: 'cancelled' };

export async function signInWithGoogle(): Promise<GoogleResult> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return { status: 'cancelled' };

    const idToken = res.data.idToken;
    if (!idToken) throw new Error('GOOGLE_NO_ID_TOKEN');

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
    return { status: 'ok' };
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) {
      return { status: 'cancelled' };
    }
    throw e;
  }
}

export async function signOutGoogle() {
  configure();
  try { await GoogleSignin.signOut(); } catch { /* not signed in with Google */ }
}
```

### Nonce (why "Skip nonce checks" is on)

A nonce stops a stolen ID token from being replayed. Supabase checks it by comparing `sha256(nonce you pass)` with the `nonce` claim in the token. The **free** `@react-native-google-signin/google-signin` API can't take a custom nonce, and on iOS the Google SDK puts its own nonce in the token, which Supabase can't verify. So the free path is:

- **Skip nonce checks = ON** in Supabase. Supabase still checks the token's signature (Google's keys), issuer, **audience (your client IDs)** and expiry (~1 hour). The remaining risk is replay of a leaked token inside that hour, which is acceptable for a grocery app.
- **Stricter option (also free):** use the browser flow (`supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'nearkart://auth/callback', skipBrowserRedirect: true } })` + `expo-web-browser` + PKCE). It's one extra screen for the user but has no nonce gap. Or use a sign-in module that accepts a nonce, and pass it like this:

```ts
import * as Crypto from 'expo-crypto';
const rawNonce = Crypto.randomUUID();
const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
// give hashedNonce to Google, then:
await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce });
// and turn "Skip nonce checks" OFF
```

### `emailOtp.ts`

```ts
import { supabase } from '@/lib/supabase';
import i18n from '@/i18n';

export async function requestEmailCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      data: { language: i18n.language },   // used by the email template + handle_new_user
    },
  });
  if (error) throw error;                  // 429 → "Wait a minute before asking for a new code"
}

export async function verifyEmailCode(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  });
  if (error) throw error;                  // "Token has expired or is invalid" → 'auth.codeInvalid'
}
```

### Login screen (`app/auth/login.tsx`)

```
┌──────────────────────────────────────┐
│  ✕                                   │
│        🛒  NearKart                  │
│  Log in to place your order          │  ← from ?reason=checkout (i18n)
│                                      │
│  [ G  Continue with Google ]         │  ← big, 56dp
│                                      │
│  ───────────  or  ───────────        │
│  Email  [ you@example.com      ]     │
│  [   Get code on email   ]           │
│                                      │
│  By continuing you agree to Terms    │
│  & Privacy Policy                    │
└──────────────────────────────────────┘
```

- `reason` param → line: `auth.reason.checkout` "Log in to place your order", `auth.reason.wishlist`, `auth.reason.notify`, `auth.reason.orders`.
- Email validated with zod (`z.string().email()`); button shows a spinner and is disabled while sending.
- On success go to `auth/verify?email=…&next=…`.

### Verify screen (`app/auth/verify.tsx`)

- One `TextInput` with `keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `autoComplete="one-time-code"` (Android/iOS autofill from the email app's notification), `maxLength={6}`. Auto-submits at 6 digits.
- "Resend code" enabled after a 60 s countdown (matches `max_frequency`).
- "Wrong email? Change" goes back.
- Errors: invalid/expired → `auth.codeInvalid`; 429 → `auth.tooManyRequests`.

### i18n keys (add to `en.json`, `mr.json`, `hi.json`)

| Key | en | mr | hi |
|---|---|---|---|
| `auth.continueGoogle` | Continue with Google | Google ने पुढे जा | Google से जारी रखें |
| `auth.getCode` | Get code on email | ईमेलवर कोड मिळवा | ईमेल पर कोड पाएँ |
| `auth.enterCode` | Enter the 6-digit code sent to {{email}} | {{email}} वर पाठवलेला ६ अंकी कोड टाका | {{email}} पर भेजा गया 6 अंकों का कोड डालें |
| `auth.resendIn` | Resend in {{s}}s | {{s}} सेकंदात पुन्हा पाठवा | {{s}} सेकंड में फिर से भेजें |
| `auth.codeInvalid` | That code is wrong or expired. | कोड चुकीचा आहे किंवा त्याची मुदत संपली आहे. | कोड गलत है या उसकी अवधि समाप्त हो गई है। |
| `auth.tooManyRequests` | Too many tries. Wait a minute and try again. | खूप प्रयत्न झाले. एक मिनिट थांबा आणि पुन्हा प्रयत्न करा. | बहुत ज़्यादा प्रयास। एक मिनट रुककर फिर कोशिश करें। |
| `auth.reason.checkout` | Log in to place your order | ऑर्डर करण्यासाठी लॉग इन करा | ऑर्डर करने के लिए लॉग इन करें |
| `auth.reason.wishlist` | Log in to save your favourites | आवडत्या वस्तू जतन करण्यासाठी लॉग इन करा | पसंदीदा सामान सेव करने के लिए लॉग इन करें |
| `auth.reason.notify` | Log in and we'll tell you when it's back | लॉग इन करा, वस्तू परत आली की आम्ही कळवू | लॉग इन करें, सामान वापस आने पर हम बताएँगे |
| `auth.googleFailed` | Google login didn't work. Try email instead. | Google लॉगिन झाले नाही. ईमेलने प्रयत्न करा. | Google लॉगिन नहीं हुआ। ईमेल से कोशिश करें। |

> Have a native Marathi and Hindi speaker review all copy before release (Phase 9).

### Play Store reviewer access

Play review needs a working login. Create `review@<your-domain>` in Supabase (Dashboard → Users → Add user, with a password), enable **Email + password** sign-in, and expose a password field only behind a hidden gesture (7 taps on the version number in Account → About). Put the credentials in Play Console → App access. Details in Phase 9.10.

**Checks**
- Google login works on a physical Android phone with the debug build, then with a release build installed from Play internal testing (proves the Play signing SHA-1 is registered).
- Email code arrives in Inbucket locally and in a real inbox via Brevo, in the user's language.
- After login, `auth.users` and `public.profiles` both have the row (Phase 0 `handle_new_user` copies `full_name` and `avatar_url` from Google's metadata).

**Tests**
- Unit: `errors.ts` mapping (cancelled → no toast; 429 → `auth.tooManyRequests`; invalid OTP → `auth.codeInvalid`).
- Component: verify screen auto-submits at 6 digits; resend button disabled for 60 s.
- Maestro (local): request code → read it from Inbucket's API (`GET http://localhost:54324/api/v1/mailbox/<name>`) → enter it → land on `next`.

---

## 3.2 Session & login gate

**Goal:** the app always knows the session state, refreshes tokens quietly, and asks for login only at the moment it's needed, then continues where the user was.

**Files**

```
mobile/src/features/auth/
  useAuth.ts           # Zustand store: status, session, profile
  AuthProvider.tsx     # onAuthStateChange, AppState refresh, profile fetch
  useRequireLogin.ts   # gate
  postLogin.ts         # registry of "after login" tasks (merge cart, push token, language)
```

### Session storage

Phase 0.9 created the Supabase client with a SecureStore-backed adapter. Supabase sessions can exceed SecureStore's ~2 KB recommended size on some devices, so use the "large secure store" pattern: an AES key in SecureStore and the encrypted session in MMKV. If Phase 0 used plain SecureStore, switch to this now:

```ts
// src/lib/supabaseStorage.ts
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'auth' });
const KEY_NAME = 'nk.session.key';

async function getKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    key = Crypto.randomUUID().replace(/-/g, '');
    await SecureStore.setItemAsync(KEY_NAME, key);
  }
  return key;
}
// The MMKV instance itself can be opened with { encryptionKey } from getKey();
// that is the simplest correct way to encrypt at rest.
export const supabaseStorage = {
  getItem: async (k: string) => mmkv.getString(k) ?? null,
  setItem: async (k: string, v: string) => mmkv.set(k, v),
  removeItem: async (k: string) => mmkv.delete(k),
};
```

(Open the `auth` MMKV instance with `encryptionKey: await getKey()` during app start-up, before creating the Supabase client.)

### `useAuth.ts`

```ts
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Tables } from '@/types/database';

type Status = 'loading' | 'signedOut' | 'signedIn';
type AuthState = {
  status: Status;
  session: Session | null;
  profile: Tables<'profiles'> | null;
  set: (p: Partial<AuthState>) => void;
};

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  profile: null,
  set: (p) => set(p),
}));

export const useUserId = () => useAuth((s) => s.session?.user.id ?? null);
export const useRole = () => useAuth((s) => s.profile?.role ?? 'customer');
```

### `AuthProvider.tsx`

```tsx
export function AuthProvider({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const set = useAuth((s) => s.set);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session);
      if (event === 'SIGNED_IN') runPostLogin(session!.user.id).catch(logger.warn);
      if (event === 'SIGNED_OUT') qc.removeQueries({ predicate: (q) => isUserScoped(q.queryKey) });
    });

    // Refresh tokens only while the app is in the foreground (Supabase RN guidance)
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();

    return () => { sub.subscription.unsubscribe(); appState.remove(); };
  }, []);

  async function applySession(session: Session | null) {
    if (!session) return set({ status: 'signedOut', session: null, profile: null });
    set({ status: 'signedIn', session });
    supabase.realtime.setAuth(session.access_token);   // private Realtime channels (Phase 4/5)
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    set({ profile: data ?? null });
  }

  return <>{children}</>;
}
```

`isUserScoped(key)` returns true for keys starting with `['me']`, `['cart']`, `['orders']`, `['addresses']`, `['notifications']`. Catalog caches survive logout.

### `useRequireLogin.ts`

```ts
export type LoginReason = 'checkout' | 'wishlist' | 'notify' | 'orders' | 'review';

export function useRequireLogin() {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (reason: LoginReason, next: string = pathname): boolean => {
      if (status === 'signedIn') return true;
      router.push({ pathname: '/auth/login', params: { reason, next } });
      return false;
    },
    [status, pathname],
  );
}

// usage
const requireLogin = useRequireLogin();
<Button onPress={() => requireLogin('checkout', '/cart') && proceed()} />
```

After a successful login the login screen calls `router.replace(next)`, so the user lands back on the cart (or product) instead of Home.

### `postLogin.ts`

```ts
type Task = (userId: string) => Promise<void>;
const tasks: Task[] = [];
export const onSignedIn = (t: Task) => tasks.push(t);
export async function runPostLogin(userId: string) {
  for (const t of tasks) await t(userId).catch(logger.warn);   // one failure doesn't stop the rest
}
```

Registered tasks: **sync language** (3.3), **merge guest cart** (Phase 4.2), **register push token** (Phase 5.8).

### Logout

Account → **Log out**: `await signOutGoogle(); await supabase.auth.signOut({ scope: 'local' })`. User-scoped queries are removed by the listener. The guest cart starts empty (the server cart stays on the server for the next login). The selected browsing location stays.

**Checks**
- Kill the app while logged in → reopen → still logged in, no flash of the login screen (status starts as `loading` and the splash screen stays until it resolves).
- Leave the phone idle over an hour → reopen → the next request works (token refreshed on foreground).
- Guest taps **Place order** → login → returns to the cart.

**Tests**
- `useRequireLogin` pushes `/auth/login` with `reason` and `next` when signed out and returns `true` when signed in.
- `runPostLogin` runs all tasks even if one throws.

---

## 3.3 Profile & settings

**Goal:** a simple profile the store can trust ("who is this customer?") and settings that follow the user across devices.

**Files**

```
mobile/app/(shop)/account.tsx      # menu: profile card, addresses, orders, language, settings, help, logout
mobile/app/account/profile.tsx     # edit name, phone, photo
mobile/app/account/settings.tsx    # language, theme, large text
mobile/src/features/profile/{api.ts, hooks.ts, AvatarPicker.tsx}
```

### Account tab

```
┌──────────────────────────────────────┐
│ (photo)  Priya Patil          Edit › │
│          priya@gmail.com             │
├──────────────────────────────────────┤
│ 📍 Saved addresses                 › │
│ 🧾 My orders                       › │   (Phase 5)
│ ❤️ Wishlist                        › │   (Phase 8)
│ 🔔 Notifications                   › │   (Phase 5)
│ 🌐 Language: मराठी                 › │
│ ⚙️ Settings                        › │
│ ❓ Help & support                  › │   (call/WhatsApp the store)
│ ℹ️ About / Seller details          › │   (Phase 9: legal info)
│ 🏪 Store mode                      › │   (staff only, Phase 6)
│ 🛠 Admin                           › │   (admin only, Phase 7)
│ ↪ Log out                            │
└──────────────────────────────────────┘
```

Guests see a **"Log in"** card at the top instead of the profile card, plus Language, Settings and Help.

### Profile edit

| Field | Rule | Notes |
|---|---|---|
| Full name | 2–80 chars | Prefilled from Google |
| Email | read-only | From `auth.users` |
| Phone | optional, `^[6-9]\d{9}$` | Shown as `+91` prefix + 10 digits. Used as the default receiver phone in new addresses. Not verified (no SMS). |
| Photo | optional | `AvatarPicker` |

```ts
export function useUpdateProfile() {
  const qc = useQueryClient();
  const set = useAuth((s) => s.set);
  return useMutation({
    mutationFn: async (patch: { full_name?: string; phone?: string | null; avatar_path?: string | null; language?: Lang }) => {
      const uid = useAuth.getState().session!.user.id;
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select('*').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (profile) => { set({ profile }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
}
```

The Phase 0 trigger on `profiles` blocks changes to `role`, `is_blocked` and `cod_allowed` from the client, so this update can only touch safe columns.

### Avatar upload

```ts
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';

export async function pickAndUploadAvatar(uid: string, oldPath?: string | null) {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (res.canceled) return null;

  const out = await ImageManipulator.manipulateAsync(
    res.assets[0]!.uri,
    [{ resize: { width: 256, height: 256 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.WEBP, base64: true },   // re-encoding drops EXIF/GPS
  );

  const path = `${uid}/${Crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from('avatars').upload(path, decode(out.base64!), { contentType: 'image/webp' });
  if (error) throw error;
  if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
  return path;
}
```

Display with `supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl` through `expo-image`.

### Language sync

- The device setting (Zustand + MMKV, Phase 0.7) is what the UI uses.
- On every change and once after login (post-login task), write it to `profiles.language`. Phase 5 uses it to write notifications and push messages in the user's language.
- On a **new device**, after login: if the user never picked a language on this device, adopt `profiles.language`.

### Settings screen

Language (3 big buttons), Theme (System / Light / Dark), Large text (switch), and "Clear cached data" (keeps login). Notification preferences arrive in Phase 8.6.

**Checks**
- Change name on phone A → open Account on phone B → new name shows after pull-to-refresh.
- Try `supabase.from('profiles').update({ role: 'admin' })` from the app in a dev build → it is rejected.

**Tests**
- zod profile schema (phone rules).
- `AvatarPicker` calls `remove()` on the old path only after a successful upload.

---

## 3.4 Location onboarding

**Goal:** before the first Home load, know roughly where the user is, so Home can say "Delivering to …" or "Not delivering here yet" and the cart can show the right ETA. Guests get this too (no login needed).

**Files**

```
mobile/app/(onboarding)/location.tsx
mobile/src/features/location/
  useLocationStore.ts        # persisted: current "browsing location"
  useCurrentLocation.ts      # permission + GPS + reverse geocode
  useServiceability.ts       # (3.6)
  LocationHeader.tsx         # "Delivering to 📍 Home · Rajapeth ⌄"
```

### Flow

```
Language (Phase 0) ──► Location
                        ├─ [📍 Use my current location]   → permission → GPS → serviceability → Home
                        ├─ [🗺 Pick on map]                → MapPinPicker (3.5) → Home
                        └─ "Skip for now"                  → Home with "Set location" header
Logged-in users with addresses: the header uses the default address instead, and the picker
shows saved addresses first.
```

### `useLocationStore.ts`

```ts
type BrowsingLocation = {
  source: 'gps' | 'map' | 'address';
  addressId?: string;           // when source = 'address'
  label: string;                // "Home" or "Rajapeth, Amravati"
  lat: number;
  lng: number;
  serviceable: boolean;
  storeId: number | null;
  etaMinutes: number | null;
  checkedAt: number;            // re-check if older than 24 h
};

export const useLocationStore = create<{ current: BrowsingLocation | null; setCurrent: (l: BrowsingLocation | null) => void }>()(
  persist((set) => ({ current: null, setCurrent: (current) => set({ current }) }), {
    name: 'nk.location',
    storage: createJSONStorage(() => mmkvStorage),
  }),
);
```

### `useCurrentLocation.ts`

```ts
import * as Location from 'expo-location';

export async function getCurrentPlace() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { error: 'PERMISSION_DENIED' as const };

  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) return { error: 'GPS_OFF' as const };   // show "Turn on location" + Linking.openSettings()

  const pos =
    (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

  const { latitude: lat, longitude: lng } = pos.coords;
  const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(() => []);
  return {
    lat, lng,
    label: [place?.district ?? place?.subregion, place?.city].filter(Boolean).join(', ') || 'Current location',
    pincode: place?.postalCode ?? undefined,
    city: place?.city ?? undefined,
  };
}
```

- Permission is requested **only** after the user taps the button, with a one-line reason above it: "We use your location only to check delivery and fill your address."
- `reverseGeocodeAsync` uses the phone's built-in geocoder (free, no API key). It can be empty offline, so it's only used to pre-fill.
- `app.config.ts`: add the `expo-location` plugin with `locationWhenInUsePermission` text in English (iOS shows it), and don't request background location.

**Checks**
- Deny permission → "Pick on map" still works; the app never asks twice in a row.
- GPS off → clear message with "Open settings".

**Tests**
- `getCurrentPlace` returns `PERMISSION_DENIED` / `GPS_OFF` with mocked `expo-location`.

---

## 3.5 Address book & map pin

**Goal:** saving an address takes under 30 seconds: drop a pin, confirm the house number, done. The **pin** is what matters for delivery; the text helps the person delivering.

**Files**

```
mobile/src/features/addresses/
  api.ts               # list, create, update, setDefault, delete (RPC)
  hooks.ts             # useAddresses, useSaveAddress, useDeleteAddress, useDefaultAddress
  schema.ts            # zod
  MapPinPicker.tsx
  AddressForm.tsx
  AddressCard.tsx
mobile/app/account/addresses/index.tsx   # list
mobile/app/account/addresses/new.tsx     # map → form
mobile/app/account/addresses/[id].tsx    # edit
```

### Map choice (and why not Google Maps)

| Option | Cost | Verdict |
|---|---|---|
| `react-native-maps` with Google on Android | ⚠️ Google Maps SDK needs an API key on a **billing-enabled** Cloud project, even when usage is inside the free quota | Avoid |
| `react-native-maps` with Apple Maps on iOS | Free | Fine for iOS only |
| **`@maplibre/maplibre-react-native`** + **OpenFreeMap** tiles | Free, no key, no account | **Use on both platforms**: one code path |

OpenFreeMap serves OpenStreetMap vector tiles for free with no key (`https://tiles.openfreemap.org/styles/liberty`). Show the required **"© OpenStreetMap contributors"** attribution on the map. Don't use `tile.openstreetmap.org` directly from an app; its usage policy forbids that.

```bash
npx expo install @maplibre/maplibre-react-native
```

Add `"@maplibre/maplibre-react-native"` to `plugins` in `app.config.ts` and rebuild the dev client.

### `MapPinPicker.tsx`

A fixed pin in the centre of the map (the map moves under it, like Blinkit/Swiggy), a "Locate me" button, and a bottom card showing the area name and whether it's deliverable.

```tsx
import MapLibreGL from '@maplibre/maplibre-react-native';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function MapPinPicker({ initial, onConfirm }: Props) {
  const [center, setCenter] = useState(initial);            // { lat, lng }
  const debounced = useDebounce(center, 400);
  const service = useServiceability(debounced.lat, debounced.lng);   // 3.6
  const place = useReverseGeocode(debounced);                        // expo-location, cached

  return (
    <View className="flex-1">
      <MapLibreGL.MapView
        style={{ flex: 1 }}
        mapStyle={STYLE}
        logoEnabled={false}
        attributionEnabled
        onRegionDidChange={(f) => {
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
          setCenter({ lat: lat!, lng: lng! });
        }}
      >
        <MapLibreGL.Camera defaultSettings={{ centerCoordinate: [initial.lng, initial.lat], zoomLevel: 16 }} />
        <MapLibreGL.UserLocation visible />
      </MapLibreGL.MapView>

      <CenterPin pointerEvents="none" />          {/* absolutely positioned 📍 with a shadow dot */}
      <LocateMeButton onPress={async () => { /* getCurrentPlace() → camera.flyTo */ }} />

      <Card className="absolute bottom-0 inset-x-0 p-4">
        <Text variant="title">{place.data?.area ?? t('address.movePin')}</Text>
        <Text tone="muted">{place.data?.cityLine}</Text>
        {service.data && !service.data.serviceable && (
          <Banner tone="warning">{t('address.notServiceable', { km: service.data.distance_km })}</Banner>
        )}
        <Button onPress={() => onConfirm({ ...debounced, ...place.data })}>{t('address.confirmLocation')}</Button>
      </Card>
    </View>
  );
}
```

Optional (nice for users): draw the delivery circle/polygon on the map. The store row is public; build a circle polygon with `@turf/circle` from `stores.location` + `service_radius_km`, or draw `service_area` directly, as a `FillLayer` with 10% opacity.

### Address form

Opens after "Confirm location", with the pin shown as a small static map at the top ("Change" goes back to the map).

| Field | Prefill | Rule |
|---|---|---|
| Flat / house no. / building | — | required |
| Area / street | reverse geocode | required |
| Landmark | — | optional ("Near Hanuman temple") |
| City | reverse geocode | required |
| Pincode | reverse geocode | 6 digits |
| Receiver name | profile name | required |
| Receiver phone | profile phone | `^[6-9]\d{9}$`, shown with `+91` |
| Save as | Home / Work / Other chips | — |
| Make default | on for the first address | — |

```ts
// schema.ts
export const addressSchema = z.object({
  house: z.string().trim().min(1).max(120),
  area: z.string().trim().min(2).max(160),
  landmark: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'address.pincodeInvalid'),
  receiver_name: z.string().trim().min(2).max(80),
  receiver_phone: z.string().transform((s) => s.replace(/\D/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/, 'address.phoneInvalid')),
  label: z.enum(['home', 'work', 'other']),
  is_default: z.boolean(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
```

The phone transform accepts `+91 98765 43210`, `098765 43210` and `9876543210`.

### API

```ts
export async function saveAddress(input: AddressInput, id?: string) {
  const row = { ...input, landmark: input.landmark || null };
  const q = id
    ? supabase.from('addresses').update(row).eq('id', id)
    : supabase.from('addresses').insert(row);           // user_id defaults to auth.uid()
  const { data, error } = await q.select('id, is_serviceable, is_default').single();
  if (error) throw error;                                // 'ADDRESS_LIMIT' → toast
  return data;
}

export const deleteAddress = (id: string) => supabase.rpc('delete_address', { p_address_id: id });
export const setDefault = (id: string) => supabase.from('addresses').update({ is_default: true }).eq('id', id);
```

After save: if `is_serviceable` is false, show "Saved. We don't deliver here yet, but we'll keep it." and don't select it for checkout.

### Address list

`AddressCard`: label icon, receiver name + phone, two-line address, a **Default** chip, a **"Not deliverable"** chip when `is_serviceable` is false, and a ⋮ menu (Edit, Set as default, Delete). Delete uses an **Undo** snackbar (5 s) before calling the RPC, instead of an "Are you sure?" dialog.

**Checks**
- Add 2 addresses → only one is default; set the other as default → the first one flips.
- Edit an address by moving the pin outside the area → it becomes "Not deliverable".
- Phone number formats above are all accepted; `12345` is rejected.

**Tests**
- zod schema cases (phone transform, pincode).
- `AddressCard` shows "Not deliverable" when `is_serviceable` is false.

---

## 3.6 Serviceability check

**Goal:** one rule, on the server, that answers "Do we deliver here?" and is used in four places: onboarding, the map pin, saved addresses, and checkout (Phase 4).

**SQL:** `private.serviceability_for_point()` and `public.check_serviceability(lat, lng)` in the migration above.

**Two ways to define the delivery area** (on the single `stores` row):

| Mode | Set | When to use |
|---|---|---|
| **Radius** | `stores.location` + `service_radius_km` (e.g. 4) | Start here. Simple, good enough for one town. |
| **Polygon** | `stores.service_area` (overrides the radius when set) | When the circle crosses a river/highway you can't serve, or misses a colony you can. |

Set a polygon without any admin UI yet (Phase 7 adds one):

1. Open [geojson.io](https://geojson.io) (free), draw the area, and copy the polygon coordinates.
2. Run in Supabase SQL editor:
   ```sql
   update public.stores
      set service_area = extensions.st_geogfromtext(
        'SRID=4326;POLYGON((77.735 20.945, 77.790 20.945, 77.790 20.905, 77.735 20.905, 77.735 20.945))'
      )
    where id = 1;
   -- Re-check existing addresses after changing the area:
   update public.addresses set updated_at = now() where deleted_at is null;
   ```
   (Coordinates are **lng lat**, and the first and last points must be the same.)

**App hook**

```ts
export function useServiceability(lat?: number, lng?: number) {
  return useQuery({
    queryKey: ['serviceability', round5(lat), round5(lng)],      // ~1 m precision for caching
    enabled: lat != null && lng != null,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_serviceability', { p_lat: lat!, p_lng: lng! });
      if (error) throw error;
      return data as {
        serviceable: boolean; store_id: number | null; nearest_store_id: number | null;
        distance_km: number; eta_minutes: number | null; reason: 'OUTSIDE_AREA' | 'NO_STORE' | null;
      };
    },
  });
}
```

**Header (`LocationHeader.tsx`)**

| State | Header |
|---|---|
| Serviceable | **Delivering to 📍 Home** · Rajapeth ⌄ · *~20 min* |
| Not serviceable | **📍 Rajapeth** ⌄ · *Not delivering here yet* (amber) |
| No location | **📍 Set your location** ⌄ |

Tapping opens a sheet: saved addresses (logged in), "Use current location", "Pick on map".

**Not-serviceable screen behaviour:** browsing, search and the cart still work (people like to look), but the cart's checkout button is replaced by "We don't deliver to this address yet" + "Change address". Keep a lightweight "Tell me when you deliver here" button for later (it can write a row to `search_queries` with query `area:<pincode>`, so the owner sees demand by area in Phase 7 with no new table).

**Checks**
- A point at the store's location → `serviceable: true`, `distance_km: 0`.
- A point 10 km away with radius 4 → `serviceable: false`, `reason: 'OUTSIDE_AREA'`, `distance_km ≈ 10`.
- With a polygon set, a point inside the polygon but outside the radius → `serviceable: true` (the polygon wins).

**Tests:** see pgTAP below.

---

## 3.7 Store open/closed rules

**Goal:** the customer always knows, before filling a cart, whether an order can be placed **now**, and the rule is the same on the phone and in the database.

Phase 1 built `store_status(store_id)` (opening hours + `is_accepting_orders` + `busy_message`) and the live `store:<id>` Realtime channel. This phase turns them into clear UI rules.

### State matrix

| Store state (from `store_status`) | Location | Home banner | Browse & add to cart | Checkout button |
|---|---|---|---|---|
| Open + accepting | Serviceable | none, header shows ETA | ✅ | ✅ "Place order" |
| Open + accepting | Not serviceable | "Not delivering to this address" | ✅ | ❌ "Change address" |
| Open + **paused** (`is_accepting_orders = false`) | any | 🟠 "Not taking orders right now. {{busy_message}}" | ✅ | ❌ "Store paused" |
| Open + **busy** (`busy_message` set, still accepting) | Serviceable | 🟡 "Busy: delivery may take ~40 min" | ✅ | ✅ |
| **Closed** (outside hours) | any | 🔴 "Closed now · Opens at 7:00 AM" | ✅ | ❌ "Opens at 7:00 AM" |

The checkout rule is **enforced again on the server** in Phase 4 (`get_cart_quote` → `STORE_CLOSED`; `place_order` raises it). The banner is just the friendly early warning.

### `StoreStatusBanner.tsx`

```tsx
export function StoreStatusBanner() {
  const { data: status } = useStoreStatus();      // Phase 1 hook, invalidated by the store:<id> channel
  const loc = useLocationStore((s) => s.current);
  if (!status) return null;

  if (!status.is_open)      return <Banner tone="danger"  icon="clock">{t('store.closedOpensAt', { time: formatTime(status.opens_at) })}</Banner>;
  if (!status.accepting)    return <Banner tone="warning" icon="pause">{t('store.paused')}{status.message ? ` ${localize(status.message)}` : ''}</Banner>;
  if (loc && !loc.serviceable) return <Banner tone="warning" icon="map-marker-off">{t('store.notServiceable')}</Banner>;
  if (status.message)       return <Banner tone="info" icon="timer-sand">{localize(status.message)}</Banner>;
  return null;
}
```

- `formatTime` shows 12-hour time in the user's language (`Intl.DateTimeFormat(lang + '-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })`), always in **IST**, even if the phone's time zone is different.
- When the store closes while the user is on the cart screen, the Realtime event refetches status and the quote, and the button changes without a reload.

| Key | en | mr | hi |
|---|---|---|---|
| `store.closedOpensAt` | Closed now · Opens at {{time}} | सध्या बंद · {{time}} ला उघडेल | अभी बंद · {{time}} बजे खुलेगा |
| `store.paused` | Not taking orders right now. | सध्या ऑर्डर घेत नाही. | अभी ऑर्डर नहीं ले रहे हैं। |
| `store.notServiceable` | We don't deliver to this location yet. | या ठिकाणी आम्ही अजून डिलिव्हरी करत नाही. | इस जगह पर हम अभी डिलीवरी नहीं करते। |

**Checks**
- Flip `is_accepting_orders` in Studio → every open app shows the paused banner within ~1 s.
- Set the phone to a different time zone → opening times still show IST.

**Tests**
- `StoreStatusBanner` renders the right banner for each row of the matrix (mock `useStoreStatus` and `useLocationStore`).

---

## 3.8 Delete account

**Goal:** a user can delete their account from inside the app, which the Play Store requires and India's DPDP Act expects, without breaking the store's order records.

**SQL:** `public.delete_my_account()` in the migration above. **Phase 4 replaces it** (`create or replace`) to:
1. refuse with `ACTIVE_ORDERS_EXIST` while any order is not `delivered`/`cancelled`, and
2. anonymise past orders (receiver name, phone, house and landmark removed from `address_snapshot`) instead of deleting them. Tax law requires keeping invoices for several years, so orders stay but are no longer linked to a person (`orders.user_id` becomes `null` via `on delete set null`).

> If your Supabase project rejects `delete from auth.users` inside the function (permissions on the `auth` schema can change between platform versions), move that one step to a tiny Edge Function `delete-account` that verifies the caller's JWT and calls `supabase.auth.admin.deleteUser(uid)` with the service-role key. Keep the data clean-up in SQL.

**Screen (`app/account/delete.tsx`)**

1. Explain in plain words: "Your profile, addresses, cart and wishlist will be deleted. Past orders are kept without your name for tax records. This can't be undone."
2. Big red **Delete my account** button → a second sheet: "Delete account?" [Cancel] [Delete].
3. Then:

```ts
async function deleteAccount() {
  const { profile } = useAuth.getState();
  if (profile?.avatar_path) await supabase.storage.from('avatars').remove([profile.avatar_path]);
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;                         // ACTIVE_ORDERS_EXIST (Phase 4) → explain + link to Orders
  await signOutGoogle();
  await supabase.auth.signOut({ scope: 'local' });
  queryClient.clear();
  router.replace('/');
  toast(t('account.deleted'));
}
```

A web version of the same flow (required by Play: "a link where users can request deletion") is added in Phase 9.8.

**Checks**
- Delete → the user is gone from Dashboard → Authentication; `profiles` and `addresses` rows are gone; logging in again with the same Google account creates a fresh, empty profile.

---

## Testing for Phase 3

### pgTAP: `supabase/tests/0300_accounts_addresses.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures (run as postgres) -----------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.local');

-- Use the seed store; make it a 4 km radius around a known point.
update public.stores
   set location = extensions.st_setsrid(extensions.st_makepoint(77.7500, 20.9300), 4326)::extensions.geography,
       service_radius_km = 4,
       service_area = null
 where id = (select min(id) from public.stores);

-- check_serviceability --------------------------------------------------------
select ok((public.check_serviceability(20.9300, 77.7500) ->> 'serviceable')::boolean,
          'store location is serviceable');
select ok(not (public.check_serviceability(21.0200, 77.7500) ->> 'serviceable')::boolean,
          '10 km north is not serviceable');
select is(public.check_serviceability(21.0200, 77.7500) ->> 'reason', 'OUTSIDE_AREA', 'reason is OUTSIDE_AREA');
select throws_ok($$ select public.check_serviceability(123, 77) $$, 'P0001', 'INVALID_LOCATION', 'bad latitude rejected');

-- Polygon overrides radius
update public.stores
   set service_area = extensions.st_geogfromtext(
     'SRID=4326;POLYGON((77.70 21.05, 77.80 21.05, 77.80 20.90, 77.70 20.90, 77.70 21.05))')
 where id = (select min(id) from public.stores);
select ok((public.check_serviceability(21.0200, 77.7500) ->> 'serviceable')::boolean,
          'inside polygon wins over radius');
update public.stores set service_area = null where id = (select min(id) from public.stores);

-- Addresses as user A ---------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
values ('Asha', '9876543210', '12', 'Rajapeth', 'Amravati', '444601', 20.9300, 77.7500);

select is((select count(*)::int from public.addresses where is_default), 1, 'first address becomes default');
select ok((select is_serviceable from public.addresses limit 1), 'trigger sets is_serviceable');

insert into public.addresses (receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude, is_default)
values ('Asha', '9876543210', '5', 'Far colony', 'Amravati', '444602', 21.0200, 77.7500, true);

select is((select count(*)::int from public.addresses where is_default), 1, 'still exactly one default');
select ok(not (select is_serviceable from public.addresses where area = 'Far colony'), 'far address not serviceable');

select throws_ok(
  $$ insert into public.addresses (user_id, receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
     values ('00000000-0000-0000-0000-0000000000b1', 'X', '9876543210', '1', 'Area', 'City', '444601', 20.93, 77.75) $$,
  '42501', null, 'cannot insert an address for another user');

-- Soft delete hides the row and promotes another default
select public.delete_address((select id from public.addresses where is_default));
select is((select count(*)::int from public.addresses), 1, 'deleted address hidden');
select is((select count(*)::int from public.addresses where is_default), 1, 'remaining address promoted to default');

-- User B sees nothing of A
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.addresses), 0, 'user B cannot see user A addresses');

select * from finish();
rollback;
```

Run: `supabase test db`.

### App tests

| Type | What |
|---|---|
| Unit | address zod schema; `errors.ts`; `formatTime` in IST for all 3 languages |
| Component | `StoreStatusBanner` matrix; `AddressCard` chips; verify-code screen |
| Maestro | `login_email.yaml` (Inbucket), `add_address.yaml` (map → form → save → appears as default), `outside_area.yaml` (pin far away → "Not deliverable") |
| Manual | Google login with the release build from Play internal testing; location permission denied path; TalkBack on the map screen (the pin card must be readable) |

---

## Phase 3 wrap-up

- **Shipped:** Google + email OTP login via Supabase Auth, session handling, a login gate that returns users to where they were, profile and avatar, language synced to the server, location onboarding, a map pin picker with free tiles, an address book with server-checked serviceability, clear store open/closed rules, and account deletion.
- **SQL:** `0300_accounts_addresses.sql` (`addresses`, `private.serviceability_for_point`, `check_serviceability`, `delete_address`, `delete_my_account`, `avatars` bucket + policies) and `supabase/tests/0300_accounts_addresses.test.sql`.
- **Next (Phase 4):** cart and COD checkout. It reuses `private.serviceability_for_point()` for the delivery check, uses addresses for checkout, replaces `delete_my_account()` to protect order records, and registers the "merge guest cart" post-login task.
