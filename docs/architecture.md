# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| App framework | Expo (TypeScript), `expo-router`, built as a **dev-client** (not Expo Go) | Share Extension, Firebase messaging, and RevenueCat all require native config plugins that Expo Go can't load |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions), run locally via the Supabase CLI | Avoids hand-rolling auth/infra; SQL migrations are the schema source of truth |
| Bill parsing | Supabase Edge Function `parse-bill` → Claude API (vision) | Vision-LLM extraction handles arbitrary bill formats (thermal receipts, PDFs, screenshots); never called from the client so the API key stays server-side |
| Local notifications | `expo-notifications` | Works with zero external accounts — the primary reminder mechanism |
| Server push (secondary) | `@react-native-firebase/messaging` (not yet wired up) + Edge Function `send-reminders` | Redundant channel for once a Firebase project exists; currently stubs (logs) instead of sending |
| Billing | `react-native-purchases` (RevenueCat) behind `useEntitlements()` | Wraps App Store/Play Store subscriptions; falls back to a local dev-only mock toggle when no RevenueCat key is configured |
| Charts | `react-native-gifted-charts` | Bar chart (category breakdown) + line chart (spend trend) |
| State/data | `@supabase/supabase-js` + `@tanstack/react-query` | Query caching/invalidation for all Supabase reads |
| Offline capture | `expo-file-system` (Directory/File API) + `AsyncStorage` + `@react-native-community/netinfo` | Captures survive app restarts and lack of connectivity |

See `package.json` for exact dependency versions.

## Repo layout

```
prompt.md                          — original product brief
CLAUDE.md                          — architecture/conventions/setup, authoritative over docs/
docs/                               — this documentation
src/
  app/                              — expo-router screens (file-based routing)
    _layout.tsx                     — root: session-based route guard
    (auth)/                         — login, signup, onboarding (unauthenticated)
    (app)/                          — index (bill list), capture, bills/[id], reminders, analytics, paywall (authenticated)
  features/
    auth/                           — AuthProvider, phone number normalization
    capture/                        — camera/gallery/PDF capture, share-intent, offline queue
    bills/                          — Bill/LineItem types, list query, parse-bill invocation
    analytics/                      — monthly analytics + spend trend hooks
    reminders/                      — reminders list hook
    paywall/                        — useEntitlements()
    export/                        — CSV/PDF export
  lib/                              — supabase client, env validation, notifications, purchases,
                                      secure session storage, react-query client, dev mock premium,
                                      generated database types
  components/, constants/, hooks/   — shared UI primitives, theme, color-scheme hook
supabase/
  migrations/*.sql                  — schema, source of truth
  functions/{parse-bill,whatsapp-webhook,send-reminders,revenuecat-webhook}/
  seed.sql, config.toml
```

## Route tree & session guarding

`src/app/_layout.tsx` renders a `RootNavigation` component that reads `session` and `onboardingComplete` from `AuthProvider` and the current route via `useSegments()`, then redirects:

1. `session === undefined` (still hydrating from secure storage) → render nothing yet, no redirect.
2. `!session && !inAuthGroup` → `router.replace('/(auth)/login')`.
3. `session && !onboardingComplete && !onOnboardingScreen` → `router.replace('/(auth)/onboarding')`.
4. `session && onboardingComplete && inAuthGroup` → `router.replace('/(app)')`.

`onboardingComplete` is `Boolean(profile?.name && profile?.phone_number)` — a profile row always exists (auto-created by the `handle_new_user` trigger on signup) but starts with both fields null.

Routes:

| Path | File | Auth required | Purpose |
|---|---|---|---|
| `/(auth)/login` | `src/app/(auth)/login.tsx` | no | Email/password sign-in |
| `/(auth)/signup` | `src/app/(auth)/signup.tsx` | no | Email/password sign-up + confirmation-email prompt |
| `/(auth)/onboarding` | `src/app/(auth)/onboarding.tsx` | yes (profile incomplete) | Collects name + phone number; shows the WhatsApp intake number |
| `/(app)` | `src/app/(app)/index.tsx` | yes | Bill list, search, filters, export entry point |
| `/(app)/capture` | `src/app/(app)/capture.tsx` | yes | Camera / gallery / PDF picker |
| `/(app)/bills/[id]` | `src/app/(app)/bills/[id].tsx` | yes | Confirm/edit screen — parse trigger, save, reminder creation, delete |
| `/(app)/reminders` | `src/app/(app)/reminders.tsx` | yes | Active warranty/insurance reminders, soonest-first |
| `/(app)/analytics` | `src/app/(app)/analytics.tsx` | yes | Monthly spend + category breakdown + trend (premium-gated beyond current month) |
| `/(app)/paywall` | `src/app/(app)/paywall.tsx` | yes | RevenueCat purchase screen / dev mock toggle |

`src/app/(app)/_layout.tsx` also runs one-time session-scoped setup on mount: requests notification permissions and calls `configurePurchases(session.user.id)` so RevenueCat's `appUserID` matches the Supabase auth user id.

## End-to-end data flow: capturing a bill

```
Camera / gallery / PDF picker  ──┐
OS share-sheet (expo-share-intent) ──┤──▶ captureAndUpload(uri, mimeType, source)
                                  │        │
                                  │        ├─ enqueueCapture(): copy file into app storage,
                                  │        │   persist QueuedCapture to AsyncStorage
                                  │        └─ processQueue(): if online, upload now
                                  │
WhatsApp Business number ────────┘   (server-side: whatsapp-webhook downloads media directly,
                                       uploads to Storage, inserts the bill row itself — it never
                                       goes through the client offline queue)

processQueue() per item:
  supabase.storage.from('bills').upload(`${userId}/${itemId}.${ext}`, bytes)
  supabase.from('bills').insert({ user_id, source, storage_path, status: 'pending_review' })
  delete local file copy on success; keep item + increment attempts + record lastError on failure

Confirm/edit screen (bills/[id].tsx) on load:
  if status === 'pending_review' && extracted_json is null:
    parseBill(billId) → invokes edge function parse-bill
      → downloads file from Storage, calls Claude vision API (or mock if no API key)
      → writes extracted_json + merchant_name/bill_date/total_amount/category/... back onto the bill row
      → returns { extracted, mode: 'claude' | 'mock' }
  form pre-filled from extracted fields (or from the bill row directly if already confirmed)
  user reviews/edits, taps Save →
    updates bills row (status: 'confirmed'), replaces line_items, creates/updates/deletes the
    reminder + schedules/cancels local notifications as needed
```

Every step is designed so a capture is never lost: the file is copied to app storage before any network call, failed uploads stay queued with a retry count, and a failed/low-confidence parse still leaves the raw image saved for manual entry.
