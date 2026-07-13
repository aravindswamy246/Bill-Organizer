# Bill Organizer — Documentation Index

This folder documents how the app is actually built, as of the current codebase. For *why* things are built this way and repo-wide conventions, read `/CLAUDE.md` first — it takes precedence over anything here if the two ever disagree. For the original product brief, see `/prompt.md`.

| Doc | Covers |
|---|---|
| [architecture.md](./architecture.md) | Stack, repo layout, route tree, session/data flow, end-to-end request flow for a captured bill |
| [database.md](./database.md) | Full Postgres schema: tables, columns, RLS policies, triggers, storage bucket |
| [edge-functions.md](./edge-functions.md) | The four Supabase Edge Functions — contracts, env vars, internal logic |
| [features/auth.md](./features/auth.md) | Email/password auth, session persistence, onboarding, phone normalization |
| [features/capture.md](./features/capture.md) | Camera/gallery/PDF capture, OS share-sheet intake, offline queue |
| [features/bills.md](./features/bills.md) | Bill list/search/filter, confirm/edit screen, parsing invocation, delete cascade |
| [features/analytics.md](./features/analytics.md) | Monthly spend breakdown, trend chart, category drill-down, free-tier month gate |
| [features/reminders.md](./features/reminders.md) | Warranty/insurance expiry reminders, local notification scheduling, free-tier limit |
| [features/monetization.md](./features/monetization.md) | RevenueCat entitlements, dev mock premium toggle, paywall triggers |
| [features/whatsapp.md](./features/whatsapp.md) | WhatsApp Business Cloud API intake webhook |
| [testing.md](./testing.md) | Jest (client) and Deno (edge functions) test setup, how to run, patterns used |
| [security.md](./security.md) | vibesec audit findings and the fixes applied (RLS, signed URLs, timing-safe secrets, server-side tier enforcement) |

## Quick facts

- **Stack**: Expo (TypeScript, expo-router, dev-client build) + Supabase (Postgres/Auth/Storage/Edge Functions) + Claude API (vision extraction) + RevenueCat (billing) + `expo-notifications` (local reminders).
- **Auth model**: email/password, not phone OTP. Phone number is a separate profile field used only to match inbound WhatsApp messages.
- **No cloud accounts exist yet** — local Supabase is the dev backend, and every external integration (Claude, RevenueCat, Firebase, WhatsApp) degrades to a mock/stub when its credential is absent. See `CLAUDE.md` → "External setup required" for what's needed to go live.
- **Category set is fixed for v1**: Warranty, Insurance, Utilities, Subscriptions, Dining & Grocery, Medical, Travel, Other.
- **Freemium limits**: free tier = current-month-only analytics (UI-gated) + max 2 active reminders (enforced both client-side and by a Postgres trigger). Premium = full history, unlimited reminders, CSV/PDF export.
