# Analytics dashboard

`/(app)/analytics` (`src/app/(app)/analytics.tsx`). Only **confirmed** bills ever count toward spend in either hook — a bill still `pending_review` hasn't had its extracted total verified by a human yet (`CLAUDE.md`: "never silently trust 100% automated extraction for money").

## `useMonthlyAnalytics(month: Date)` (`src/features/analytics/useMonthlyAnalytics.ts`)

Query key `['analytics', 'month', monthKey(month)]` where `monthKey` is `YYYY-MM`. Fetches every `bills` row with `status = 'confirmed'` and `bill_date` within `[start of month, start of next month)`, then aggregates client-side (not a DB view/RPC — plain JS reduce over the fetched rows) into:

```ts
{ total: number; categories: { category: BillCategory; total: number }[]; bills: Bill[] }
```

`categories` is sorted descending by total. The raw `bills` array is kept in the result specifically to power the category drill-down UI without a second round-trip.

## `useSpendTrend(monthsBack = 6)` (`src/features/analytics/useSpendTrend.ts`)

Query key `['analytics', 'trend', monthsBack]`. Single query for confirmed bills with `bill_date >= (monthsBack-1 months ago, 1st of month)`, selecting only `bill_date, total_amount` (no need for full rows here). Buckets amounts by `bill_date.slice(0,7)` (`YYYY-MM`) into a `Map`, then builds a dense `MonthSpend[]` — `{monthKey, label, total}` — for every one of the trailing `monthsBack` months in order, defaulting to `0` for months with no confirmed bills (so the trend line never has gaps). `label` is a short month name (`d.toLocaleDateString('en-IN', {month:'short'})`). Documented as **premium-only** — the hook itself has no gate, the screen is responsible for not rendering it (or the chart) for free-tier users.

## Screen behavior (`analytics.tsx`)

- **Month navigation**: `month` state starts at the 1st of the current calendar month. `goToPreviousMonth`/`goToNextMonth` step by whole months; `goToNextMonth` is disabled once `viewingCurrentMonth` is true (`isSameMonth(month, now)`) — no navigating into the future. Changing months resets `selectedCategory` (the drill-down) since it's meaningless across months.
- **Free-tier month gate**: `locked = !viewingCurrentMonth && !isPremium`. This is a **UI-only** gate — it hides the total/chart/category list behind a "Premium feature" card (tapping it goes to `/(app)/paywall?reason=analytics`) and additionally disables the "Prev" button once already on a locked month (so a free user can't page further back into history, though the underlying `useMonthlyAnalytics` query for that month still executes — see `docs/security.md` for why this wasn't hardened at the RLS/table level: the `bills` table needs to stay generally queryable for the unrestricted bill list/search feature, and a proper fix would require moving analytics behind dedicated RPC functions, judged out of scope for the Phase 12 hardening pass since it's a monetization gate, not a cross-user data-isolation issue).
- **Total spend card**: current month's `data.total`, formatted `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})` (hardcoded INR here, unlike the bill list which formats per-bill using each bill's own `currency` field).
- **Category bar chart**: `react-native-gifted-charts`' `BarChart`, one bar per category present that month, colored from a fixed `CATEGORY_COLORS` map (one hardcoded hex per one of the 8 fixed categories — Warranty `#208AEF`, Insurance `#5AC8FA`, Utilities `#34C759`, Subscriptions `#AF52DE`, Dining & Grocery `#FF9500`, Medical `#FF3B30`, Travel `#FFCC00`, Other `#8E8E93`). Long category labels are truncated to 7 chars + `…`. Shows "No confirmed bills for this month yet" when empty.
- **Category drill-down**: tapping a category row in the "By category" list toggles `selectedCategory` (tap again to collapse); when set, renders every bill from `data.bills` matching that category using the same `BillListItem` component the main bill list uses.
- **Spend trend line chart**: gated directly on `isPremium` (not on `viewingCurrentMonth` — the trend chart is a premium feature regardless of which month is being viewed for the rest of the screen). Non-premium sees a locked card linking to `/(app)/paywall?reason=analytics` (same reason string as the month gate — the paywall screen doesn't distinguish which specific analytics feature triggered it).

See `docs/features/monetization.md` for how `isPremium` is resolved and the paywall's `reason` query param.
