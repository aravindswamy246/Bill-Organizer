# Monetization (RevenueCat + freemium gating)

## `useEntitlements()` (`src/features/paywall/useEntitlements.ts`)

Resolves the signed-in user's premium status from **three sources, most to least authoritative**:

1. **`profiles.subscription_tier`** — the server-side record of truth, kept in sync only by the `revenuecat-webhook` edge function (real purchases, on any device — see `docs/edge-functions.md` and the column-level GRANT lockdown in `docs/database.md`).
2. **RevenueCat's own cached customer info** (`getCustomerInfo()`, react-query key `['revenuecat','customerInfo']`, `staleTime: 60_000`) — checked directly (only when `REVENUECAT_CONFIGURED`) so a purchase completed seconds ago reflects immediately in the UI without waiting for the webhook round-trip to update `profiles`.
3. **A local dev-only mock toggle** (`src/lib/devMockPremium.ts`, react-query key `['dev','mockPremium']`, `staleTime: 0`) — only queried when RevenueCat isn't configured at all (`enabled: !REVENUECAT_CONFIGURED`), so free/premium gating stays fully end-to-end-testable before any RevenueCat project or store products exist.

```ts
isPremium =
  dbTier === 'premium' ||
  (REVENUECAT_CONFIGURED && isEntitlementActive(customerInfo)) ||
  (!REVENUECAT_CONFIGURED && devMockPremium === true);
```

Returns `{ tier, isPremium, revenueCatConfigured }`.

## RevenueCat wrapper (`src/lib/purchases.ts`)

- `PREMIUM_ENTITLEMENT_ID = 'premium'` — the single entitlement identifier this app checks against (v1 has exactly one paid tier, no multi-tier plans).
- `REVENUECAT_CONFIGURED = Boolean(platform-specific EXPO_PUBLIC_REVENUECAT_API_KEY_{IOS,ANDROID})` — every other function in this file becomes a no-op (returns `null`/does nothing) when false, which is the state until a RevenueCat project + store products exist (`CLAUDE.md` → "External setup required").
- `configurePurchases(userId)` — called once per app session from `src/app/(app)/_layout.tsx`'s mount effect. Sets RevenueCat's `appUserID` to the **Supabase auth user id**, which is what lets `revenuecat-webhook`'s `event.app_user_id` map directly onto `profiles.id` server-side.
- `getCurrentOffering()` / `purchasePackage(pkg)` / `getCustomerInfo()` — thin wraps over the `react-native-purchases` SDK. `purchasePackage` throws on failure; callers check `error.userCancelled` to distinguish a dismissed purchase sheet from a genuine failure (see the paywall screen below).
- `isEntitlementActive(info)` — `typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined'`.

## Dev mock toggle (`src/lib/devMockPremium.ts`)

`AsyncStorage` key `'dev:mockPremium'`, `getDevMockPremium()` / `setDevMockPremium(value)`. Purely on-device — never touches `profiles.subscription_tier`, so there's no server state to reconcile once RevenueCat is actually configured; this code path (both the toggle UI and the `useEntitlements` branch that reads it) simply becomes unreachable at that point since `REVENUECAT_CONFIGURED` flips to `true`.

## Paywall screen (`/(app)/paywall` → `src/app/(app)/paywall.tsx`)

- Reads a `reason` query param (`'analytics' | 'reminders' | 'export'`) and shows contextual copy from `REASON_COPY` above a fixed 3-line benefits list (full historical analytics, unlimited reminders, CSV/PDF export). An unrecognized/missing reason just omits the contextual line.
- **If `isPremium`**: shows a thank-you card. If RevenueCat isn't configured, also shows a dev-only "Simulate Free" link (`handleDevToggle(false)`) to flip the mock toggle back off.
- **Else if `REVENUECAT_CONFIGURED`**: fetches the current offering on mount (`getCurrentOffering()`) and renders one `PrimaryButton` per available package (`${product.title} — ${product.priceString}`). Tapping one calls `purchasePackage`, then invalidates the `['revenuecat','customerInfo']` query key (so `useEntitlements` immediately re-resolves to premium) and navigates back. A cancelled purchase sheet (`userCancelled`) is silently ignored; any other failure shows an `Alert`.
- **Else** (RevenueCat not configured): shows a "Developer mode" card explaining real purchases aren't available yet, with a "Simulate Premium (dev only)" button (`handleDevToggle(true)`) that sets the mock toggle, invalidates its query key, and navigates back.
- Always has a "Not now" link back.

## Paywall trigger points

| Trigger | `reason` | Where |
|---|---|---|
| Viewing analytics for a past month while on free tier | `analytics` | `analytics.tsx` — `locked` card and the spend-trend locked card both link here |
| Creating a 3rd active warranty/insurance reminder while on free tier | `reminders` | `bills/[id].tsx` save flow, after the free-tier reminder-count check fails (`docs/features/reminders.md`) |
| Tapping Export while on free tier | `export` | `index.tsx`'s Export header link, before showing the CSV/PDF `Alert` |

## Freemium limits, enforcement summary

| Limit | Client-side check | Server-side enforcement |
|---|---|---|
| Analytics: current month only | Yes (`analytics.tsx`'s `locked` gate) | **No** — deliberately not RLS/table-enforced; see `docs/security.md` for the reasoning |
| Max 2 active reminders | Yes (`bills/[id].tsx` pre-check) | **Yes** — `reminders_enforce_free_tier_limit` Postgres trigger (`docs/database.md`) |
| Export (CSV/PDF) | Yes (`index.tsx` gate before the export `Alert`) | N/A — export runs entirely on-device from already-fetched bill data, there's no separate server endpoint to gate |

`subscription_tier` itself can only ever be written by the `revenuecat-webhook` edge function — the column-level `REVOKE`/`GRANT` in `20260706100000_profiles_tier_column_grants.sql` (`docs/database.md`) means a signed-in client cannot self-upgrade via a direct table update, regardless of any of the above client-side gates.
