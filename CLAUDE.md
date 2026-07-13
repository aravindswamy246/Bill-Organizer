# Bill Organizer — CLAUDE.md

## What this is
A React Native (iOS + Android) mobile app, built with Expo, for the Indian market. Users capture bills/receipts via camera, OS share-sheet ("forward from WhatsApp"), or a dedicated WhatsApp Business Cloud API number. Every bill is parsed by a vision-capable LLM (Claude) into structured data, categorized, and — for Warranty/Insurance bills — tracked toward an expiry date with scheduled reminders. Includes a spend analytics dashboard and RevenueCat-powered freemium gating.

Full product spec: see `prompt.md` in the repo root. Do not duplicate that spec here — read it for feature detail; this file is about how to work in this codebase.

**Expo HAS CHANGED**: read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. (Was `AGENTS.md`.)

## Key product decisions (deviate from prompt.md only here)
- **Auth is email/password** via Supabase Auth, NOT phone OTP. Phone number is still collected during profile setup — it remains the identity key used to match inbound WhatsApp Business messages to a user account.
- Vision LLM: **Claude API** (claude-sonnet-4-6 or newer), called only from a Supabase Edge Function. The API key must never reach the client.
- Local Supabase is the primary dev backend. No cloud accounts (Supabase, Anthropic, Firebase, Apple/RevenueCat, Meta) exist yet — see "External setup required" below. Code should degrade gracefully (mock modes) where a missing credential would otherwise block local development.

## Stack
- **App**: Expo (TypeScript, expo-router), built via `expo prebuild` / dev client (not Expo Go) — Share Extensions, Firebase messaging, and RevenueCat all require native config plugins.
- **Share sheet capture**: `expo-share-intent`
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions), run locally via the Supabase CLI. SQL migrations are the source of truth for schema.
- **Bill parsing**: Supabase Edge Function `parse-bill`, calls Claude's vision API with a structured-extraction prompt, validates the response with zod.
- **Push/local notifications**: `expo-notifications` for scheduled local reminders (works without any external account); `@react-native-firebase/messaging` for server-sent push once a Firebase project exists.
- **Billing**: `react-native-purchases` (RevenueCat), wrapped in a `useEntitlements()` hook that falls back to a mock/dev entitlement provider when no RevenueCat key is configured, so free/premium gating stays testable pre-launch.
- **Charts**: `react-native-gifted-charts`.
- **State/data**: `@supabase/supabase-js` + TanStack Query.

## Repo layout
```
prompt.md                  — full product spec (read first)
app/                       — expo-router screens ((auth), (app) groups)
src/features/{capture,bills,analytics,reminders,paywall,auth}/
src/lib/{supabase,entitlements,offlineQueue,notifications}.ts
supabase/migrations/*.sql  — schema, source of truth
supabase/functions/{parse-bill,whatsapp-webhook,send-reminders}/
```

## Commands
- `npm install` — install JS deps
- `npx expo prebuild` — regenerate native iOS/Android projects after config plugin changes
- `npx expo run:ios` / `npx expo run:android` — build & run on simulator/emulator
  - Android native build (CMake/Ninja for `react-native-worklets`/`react-native-screens`) fails on JDK 24+ (`WARNING: A restricted method in java.lang.System has been called`). Use a JDK 17–21 — Android Studio's bundled JBR works and needs no separate install: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` before `npx expo run:android`.
  - `expo prebuild` regenerates `android/` from scratch and does not recreate `android/local.properties`, so a fresh prebuild + `run:android` fails with "SDK location not found". Fix: `export ANDROID_HOME="$HOME/Library/Android/sdk"` and `echo "sdk.dir=$ANDROID_HOME" > android/local.properties` before building.
- `supabase start` — start local Postgres/Auth/Storage/Studio
- `supabase db reset` — apply all migrations fresh (destructive to local data only)
- `supabase functions serve` — run edge functions locally
- `supabase functions serve parse-bill --env-file supabase/.env.local` — serve a single function with secrets
- `npx tsc --noEmit` — typecheck
- `npm run lint` — ESLint

## Conventions (do not violate)
- **Never call the LLM API from the client.** All Claude calls go through the `parse-bill` edge function.
- **Storage buckets are private.** Bills contain financial PII — access only via short-lived signed URLs, never public URLs.
- **RLS is mandatory on every table.** Every table a user can reach must have row-level security scoped to `auth.uid()`.
- **Never silently trust 100% automated extraction for money.** Every parsed bill goes through a confirm/edit screen before it's saved as confirmed.
- **Offline-safe capture.** A captured bill must never be lost due to lack of connectivity — queue locally, sync when back online.
- **Fallback on parse failure.** If the vision LLM call fails or returns low-confidence data, still save the raw image and let the user fill in fields manually — never block the save.
- Category set is fixed for v1: Warranty, Insurance, Utilities, Subscriptions, Dining & Grocery, Medical, Travel, Other. Don't add categories without being asked.
- Out of scope for v1 (per prompt.md §7): Gmail scanning, POS integrations, insurance claim automation, price-drop alerts, multi-user/family accounts. Do not build these.

## External setup required (not blockers for local dev)
These are needed to go from "working locally" to "live in production." Each integration point in code should work in a degraded/mock mode until these exist:
1. **Anthropic API key** — for real bill parsing (mock-extraction mode is used until this is set).
2. **Supabase cloud project** — to deploy migrations/functions/storage beyond local dev.
3. **Firebase project** — for FCM server push (local notifications work without this).
4. **Apple Developer account + Google Play Console** — needed for TestFlight/Play sandbox, push entitlements, and real Share Extension distribution.
5. **RevenueCat account + store products** — for real subscription purchases. Until then, `useEntitlements()` falls back to a local dev-only mock toggle exposed on the paywall screen. Once set up:
   - `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` — client-side SDK keys (public, safe to ship in the app binary — RevenueCat's own design).
   - Configure RevenueCat's app_user_id to equal the Supabase auth user id (already done client-side in `configurePurchases`, called from `src/app/(app)/_layout.tsx`) so the webhook can map events to `profiles.id`.
   - `REVENUECAT_WEBHOOK_SECRET` — set as a secret for the `revenuecat-webhook` function, and configure the same value as the webhook's "Authorization header" in the RevenueCat dashboard. Without it, the webhook accepts unauthenticated requests (logged) — fine for local testing, never acceptable in production.
   - A "premium" entitlement must exist in the RevenueCat dashboard (see `PREMIUM_ENTITLEMENT_ID` in `src/lib/purchases.ts`).
6. **Meta Business verification + WhatsApp Business Cloud API number** — required for the WhatsApp-forward intake path; camera capture and the OS Share Extension work independently of this. Once obtained, set these as secrets for the `whatsapp-webhook` function (`supabase secrets set` in the cloud project, or an `--env-file` locally):
   - `WHATSAPP_VERIFY_TOKEN` — any string you choose; entered in the Meta App Dashboard webhook config and echoed back on the GET verification handshake.
   - `WHATSAPP_APP_SECRET` — from the Meta App Dashboard; used to verify the `X-Hub-Signature-256` HMAC on inbound POSTs. Without it, signature verification is skipped (logged), matching this codebase's mock/degrade pattern — fine for local dev, never acceptable in production.
   - `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` — from the Cloud API number; used to download inbound media and send reply messages. Without them, both are stubbed (logged only).

## Skills available in this repo's context
- `supabase` / `supabase-postgres-best-practices` — Supabase and Postgres patterns
- `expo-react-native-typescript` — Expo/RN conventions
- `vibesec` — run before considering any security-sensitive feature (auth, storage, webhooks) done
