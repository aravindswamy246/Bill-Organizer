# Security

Findings and fixes from a `vibesec`-methodology audit pass (access control/IDOR, XSS, CSRF, secrets exposure, open redirect, SSRF, file upload, SQLi, XXE, path traversal). This covers what was found, what was fixed, and — just as importantly — what was deliberately left as-is with the reasoning, so a future pass doesn't waste time re-litigating settled decisions.

## Fixes applied

### 1. Timing-safe secret comparison on webhook auth

**Finding**: `revenuecat-webhook` and `send-reminders` compared their shared secrets (`REVENUECAT_WEBHOOK_SECRET`, `CRON_SECRET`) with plain `!==` string comparison. JavaScript's `!==` on strings short-circuits at the first differing character, which — in principle — makes response timing a (very noisy, hard to exploit in practice over a real network, but non-zero) side channel an attacker could use to recover the secret one character at a time. `whatsapp-webhook` already did this correctly (`timingSafeEqualHex`, comparing HMAC hex digests).

**Fix**: added a `timingSafeEqualString(a, b)` helper to both functions — same shape as `whatsapp-webhook`'s existing one, XORing char codes across the full length of both strings (after an early-exit length check) so the comparison always takes the same number of operations regardless of where the first mismatch occurs:

```ts
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
```

Both auth guards were changed from `if (provided !== secret)` to `if (!provided || !timingSafeEqualString(provided, secret))`. See `docs/edge-functions.md` for where each is used.

### 2. Free-tier reminder limit enforced at the database layer

**Finding**: the "max 2 active reminders on the free tier" business rule (`prompt.md` §5) was enforced **only client-side** — `bills/[id].tsx` counted active reminders before inserting a new one (`docs/features/reminders.md`). The `reminders` table's RLS policy (`for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`) only checks *ownership*, not *count* — RLS has no concept of "how many rows does this user already have." A modified client, or a direct REST call against PostgREST with a valid user JWT (`POST /rest/v1/reminders`), could insert unlimited active reminders, completely bypassing the freemium gate server-side.

**Fix**: `20260706110000_reminders_free_tier_limit.sql` adds a `before insert or update` trigger, `reminders_enforce_free_tier_limit`, calling `enforce_free_tier_reminder_limit()` (full SQL in `docs/database.md`). It only fires on the transition *into* `active = true` (a brand-new active reminder, or reactivating a previously-inactive one) — viewing, listing, and deactivating a reminder are never restricted. For `free`-tier users, it counts the user's other active reminders and raises `P0001` ("free tier is limited to 2 active reminders") if that count is already ≥ 2. `premium`-tier users are exempt. `security definer set search_path = public` so the function runs with definer privileges and an unambiguous search path regardless of caller.

**Verification**: tested manually via `psql` against local Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — a free-tier test user's 3rd active-reminder insert was correctly rejected with the expected error; a premium-tier test user could create 3+ active reminders without issue.

The client-side check remains in place too (defense in depth, and better UX — it lets the app show a friendly upgrade prompt inline instead of surfacing a raw Postgres error to the user).

## Deliberately not changed

### Analytics "current month only" free-tier gate is UI-only

The free-tier restriction to current-month analytics (`analytics.tsx`'s `locked` state, `docs/features/analytics.md`) is enforced **only client-side**. This was evaluated and deliberately left as-is rather than pushed down to RLS or a trigger, because:

- `useMonthlyAnalytics`/`useSpendTrend` query the `bills` table directly, using the exact same general-purpose, unrestricted-by-date RLS policy (`bills are manageable by owner`) that the ordinary bill list/search feature also needs — free-tier users can browse their **entire** bill history in the list/search screen with no restriction at all (per spec, only analytics is gated). Restricting `bills` SELECT access by date at the RLS or table level would break bill list/search for free users too, since Postgres RLS policies apply uniformly to every query against a table, not per-feature.
- A correct server-side fix would mean moving analytics queries behind dedicated Postgres RPC functions (`security definer` functions that themselves check `subscription_tier` before aggregating), which is a real design change, not a small hardening patch.
- This is judged a **monetization/business-logic gate**, not a cross-user data-isolation vulnerability — RLS still fully protects one user's bills from another user; the only "leak" here is a free-tier user seeing their *own* older data via analytics if they bypass the client (which they could already see via the ordinary bill list, so no new information is exposed, only a paywall UX bypass).

If this changes (e.g. product wants the aggregate numbers themselves to be premium-gated even from a modified client), the fix is dedicated RPCs, not table-level RLS changes.

## Confirmed clean (no action needed)

- **Open redirect**: no code path constructs a URL for redirection from user/external input. No `Linking.openURL` calls exist in the app; `expo-share-intent` only ever hands the app file paths (images/PDFs), never URLs to open; every internal `router.push`/`router.replace` call navigates to either a static route string or a route built from a UUID the app itself just fetched from its own Supabase query (e.g. `/(app)/bills/${bill.id}`) — never from unvalidated external input.
- **SSRF**: the only server-initiated outbound requests to a URL are (a) `parse-bill` calling the fixed Anthropic API endpoint, (b) `whatsapp-webhook` calling the fixed Meta Graph API base (or, in tests only, an env-var override that's never set in real deployments), and (c) `revenuecat-webhook`/`send-reminders` calling nothing external at all. None of these endpoints are user-influenced — they're hardcoded constants, not derived from request bodies or headers. Low SSRF risk by construction; no allowlist/DNS-pinning logic was needed since there's no user-controlled URL fetch anywhere in the codebase.
- **XSS in HTML export**: `exportBillsAsPdf` (`src/features/export/exportBills.ts`) generates HTML from bill data (merchant names, categories, etc. — all user-editable via the confirm/edit screen) and renders it via `expo-print`. `escapeHtml()` is applied to every interpolated field before it's placed in the HTML template, so a merchant name like `<script>` or `"><img onerror=...>` can't break out of its text node. Covered by `exportBills.test.ts`.
- **CSV injection**: `csvEscape()` (same file) quotes/escapes fields per standard CSV rules (wraps in quotes, doubles embedded quotes) before writing to the exported `.csv`. Note: this covers *quoting* correctness, not formula-injection hardening (a merchant name starting with `=`, `+`, `-`, or `@` could still be interpreted as a formula by Excel/Sheets on open) — worth revisiting if CSV export becomes a higher-value target, but the data only ever originates from the bill's own owner (their own merchant names/amounts), not from another party, so the realistic blast radius is a user tricking themselves, not a cross-user attack.
- **Storage path traversal**: every storage path written by any capture path (`offlineQueue.ts`, `whatsapp-webhook`) is built from a server/client-generated UUID plus a mime-type-derived extension (`${user_id}/${uuid}.${ext}`), never from user-supplied filenames — there's no path segment an attacker could manipulate to escape the `${user_id}/` prefix that storage RLS keys off of.
- **Secrets in client code**: verified no Anthropic/WhatsApp/RevenueCat-webhook/cron secret ever appears in client-side code or `EXPO_PUBLIC_*` env vars — those are edge-function-only secrets (`docs/edge-functions.md`'s env var table). The only `EXPO_PUBLIC_*` secrets are RevenueCat's *client* SDK keys, which are public-by-design per RevenueCat's own architecture (they identify the app, not authenticate a privileged caller).

## General security posture (see `docs/database.md` for full detail)

- RLS enabled and owner-scoped (`auth.uid()`) on every table.
- Base table GRANTs kept separate from and in addition to RLS — both `anon,authenticated` and `service_role` need explicit GRANTs, since Postgres denies the underlying DML on a missing GRANT before RLS is even evaluated, and `service_role`'s `BYPASSRLS` doesn't imply table-level access either.
- `profiles.subscription_tier` has a column-level `REVOKE`/`GRANT` lockdown so only the service-role-key-authenticated `revenuecat-webhook` function can change it — a signed-in client cannot self-upgrade via a direct table update even though the row-level UPDATE policy would otherwise permit it.
- `bills` storage bucket is private; every read goes through a 5-minute signed URL, never a public URL.
- Webhook signature/secret validation: `whatsapp-webhook` verifies Meta's `X-Hub-Signature-256` HMAC (`WHATSAPP_APP_SECRET`); `revenuecat-webhook` and `send-reminders` validate a shared-secret header (now both timing-safe, see above). All three degrade to "skip verification, log a warning" when their respective secret isn't configured yet — a deliberate, documented mock/degrade pattern for local development pre-external-setup, **not** acceptable in production (flagged as such in both `CLAUDE.md` and the relevant function's code comments).
