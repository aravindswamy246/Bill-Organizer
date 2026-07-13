# Bill list, confirm/edit, and delete

## Types (`src/features/bills/types.ts`)

- `Bill = Database['public']['Tables']['bills']['Row']`, `LineItem = Database['public']['Tables']['line_items']['Row']` — generated from the DB schema (`docs/database.md`).
- `BILL_CATEGORIES` — the fixed 8-category tuple, typed `as const satisfies readonly BillCategory[]` so it can't silently drift from the `bill_category` Postgres enum.
- `ExtractedBill` — the shape of `parse-bill`'s output (`merchant_name`, `bill_date`, `total_amount`, `currency`, `category_guess`, `line_items[]`, `is_warranty_document`, `is_insurance_document`, `detected_expiry_date`, `confidence: 'high'|'medium'|'low'`). Hand-duplicated from `supabase/functions/parse-bill/index.ts` — Deno can't import client TS files, so this type must be kept in sync manually if the edge function's schema changes.

## Bill list (`/(app)` → `src/app/(app)/index.tsx`)

- **Search**: a free-text `TextInput` debounced 300ms (`searchInput` → `search` via `setTimeout`) before it feeds into the query, so typing doesn't re-fetch on every keystroke.
- **Filters**: a horizontal date-range chip row (`all` | `month` | `3months` | `year`) and a horizontal category chip row (`All` + the 8 fixed categories) — both single-select, backed by local `useState`.
- **Data**: `useBillList({ search, category, range })` (`src/features/bills/useBillList.ts`) — a `@tanstack/react-query` query keyed `['bills', filters]` (any filter change is a new key, no manual invalidation needed for filter changes). Query itself:
  - Always orders by `bill_date desc nullsFirst:false, created_at desc` — undated (not-yet-confirmed) bills sort by upload time and always after dated ones.
  - `category` filter → `.eq('category', ...)`.
  - `search` filter → `.ilike('merchant_name', '%<term>%')` (case-insensitive substring; powered by the `pg_trgm` GIN index on `merchant_name`, see `docs/database.md`).
  - `range` filter → `rangeStart(range)` computes a `YYYY-MM-DD` lower bound (`month`: 1st of current month; `3months`: same day-of-month 3 months back; `year`: Jan 1 of current year; `all`: no bound) and applies `.gte('bill_date', start)`. Bills with a null `bill_date` (not yet confirmed) are excluded by every preset except `all`.
  - RLS scopes every result to `auth.uid()` automatically — no explicit `user_id` filter needed client-side.
- **List rendering**: `BillListItem` (`src/components/bill-list-item.tsx`) shows merchant name (or "Unnamed merchant"), `category · formatted date`, the formatted amount (`Intl.NumberFormat('en-IN', {style:'currency', currency: bill.currency})`, falling back to `"${currency} ${amount.toFixed(2)}"` if the currency code isn't recognized by `Intl`), and a "Needs review" tag when `status === 'pending_review'`. Tapping a row navigates to `/(app)/bills/${bill.id}`.
- **Pull-to-refresh**: `RefreshControl` wired to react-query's `refetch`/`isFetching`.
- **Export**: the "Export" header link is gated by `useEntitlements().isPremium` — non-premium taps `router.push('/(app)/paywall?reason=export')` instead of exporting (see `docs/features/monetization.md`). Premium users get an `Alert` offering CSV or PDF, calling `exportBillsAsCsv(bills)` / `exportBillsAsPdf(bills)` (`src/features/export/exportBills.ts`) over whatever bills currently match the active filters (not necessarily the whole history).
- **Add a bill** button → `router.push('/(app)/capture')`.

## Confirm/edit screen (`/(app)/bills/[id]` → `src/app/(app)/bills/[id].tsx`)

This is the single screen every capture path (camera/gallery/PDF, share-intent, and — indirectly, since the user opens it from the list — WhatsApp) eventually routes through, and the **only** place a bill's `status` becomes `'confirmed'`.

### Load (`load()`, runs once on mount)

1. Fetch the bill row by id (any RLS-denied/missing id throws "Bill not found").
2. If `storage_path` is set, create a 5-minute signed URL (`createSignedUrl(path, 300)`) for the image/PDF preview — the bucket is private, so this is the only way to display it (`docs/database.md`).
3. **Branch on parse state**:
   - `!extracted_json && status === 'pending_review'` (a freshly uploaded, never-parsed bill) → shows a "Reading this bill…" banner, calls `parseBill(bill.id)` (`src/features/bills/parseBill.ts`, invokes the `parse-bill` edge function), and pre-fills every form field from the returned `extracted` object. `confidence === 'low'` sets `lowConfidence`, which renders a "double-check the fields below" banner instead of silently trusting the extraction. If the invocation itself throws (network error, function down — distinct from the edge function's own internal mock-fallback for a bad/missing Claude response), the catch block still sets `lowConfidence: true` and lets the user fill in the (now-empty) form manually — **a parse failure never blocks the confirm screen from being usable**.
   - Otherwise (already parsed or already confirmed) → fields are populated directly from the bill row, plus `line_items` and the bill's `reminders` row (`.maybeSingle()`, since a bill only ever has 0 or 1 reminder) fetched in parallel.
4. `needsExpiry = EXPIRY_CATEGORIES.includes(category)` where `EXPIRY_CATEGORIES = ['Warranty', 'Insurance']` — only these two categories show the expiry-date field at all.

### Save (`handleSave()`)

1. Client-side validation: merchant name required (trimmed non-empty); total amount must parse as a non-negative number; if `needsExpiry` and a non-empty expiry date was entered, it must be a `Date.parse`-able string.
2. Updates the `bills` row: merchant/date/amount/category, **`status: 'confirmed'`**, and `is_warranty_document`/`is_insurance_document` derived directly from `category === 'Warranty'`/`'Insurance'` (not from whatever the LLM originally guessed — the user's final category choice is authoritative).
3. Line items: **delete-then-reinsert** — all existing `line_items` for the bill are deleted, then any row with both a non-empty trimmed description and a valid numeric amount is reinserted. Simpler than diffing, and line items have no independent identity worth preserving across an edit.
4. Reminder logic (only reached if `needsExpiry` and a non-blank expiry date is present):
   - An existing reminder for this bill → updated in place (`expiry_date`, `active: true`) and its local notifications rescheduled via `scheduleReminderNotifications()`.
   - No existing reminder → **client-side pre-check** of the free-tier limit: if `!isPremium`, counts the user's current active reminders (`count:'exact', head:true` query) and only proceeds if the count is below `FREE_ACTIVE_REMINDER_LIMIT = 2`. This is a UX nicety, not the security boundary — the same limit is enforced authoritatively at the database layer by the `reminders_enforce_free_tier_limit` trigger (`docs/database.md`, `docs/security.md`) regardless of what this client-side check does. If the client-side check blocks creation, `reminderPaywallTriggered` is set instead of throwing.
   - If the category/expiry was cleared (or the category changed away from Warranty/Insurance), any existing reminder for the bill is deleted and its local notifications cancelled (`cancelReminderNotifications`).
5. Invalidates the `['bills']` and `['reminders']` react-query cache keys so the list and reminders screens refresh.
6. If the free-tier reminder limit was hit, shows an `Alert` ("Bill saved, but you already have 2 active reminders...") with **Not now** (→ bill list) and **Upgrade** (→ `/(app)/paywall?reason=reminders`) options — the bill itself is still saved either way, only the reminder/notification is skipped.
7. Otherwise navigates straight back to `/(app)`.

### Delete (`handleDelete()`)

Confirms via `Alert`, then: removes the storage object (if any) from the `bills` bucket, deletes the `bills` row (which **cascades** to `line_items` and `reminders` via their `on delete cascade` foreign keys — see `docs/database.md`), invalidates the bills query cache, and navigates back. Note: deleting the row does not itself cancel any already-scheduled local notifications for its reminder — this is a modeled gap the same way any hard-delete-with-cascade is (the DB row disappearing doesn't reach into `expo-notifications`' OS-level schedule).

## Parse invocation (`src/features/bills/parseBill.ts`)

```ts
export async function parseBill(billId: string): Promise<{ billId, extracted, mode: 'claude'|'mock' }>
```

Thin wrapper over `supabase.functions.invoke('parse-bill', { body: { billId } })`. Only throws for genuine request failures (network, auth, missing bill) — a missing `ANTHROPIC_API_KEY` or a failed Claude call is handled *inside* the edge function itself (falls back to `mockExtraction()`, see `docs/edge-functions.md`), so this function's caller only ever needs to handle the "request itself failed" case, not "extraction quality was poor" (that's what `confidence` is for).
