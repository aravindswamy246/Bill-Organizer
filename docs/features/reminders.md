# Reminders

Warranty/insurance expiry tracking. A reminder only ever exists for a bill whose category is `Warranty` or `Insurance` **and** has a non-blank expiry date entered on the confirm/edit screen (`docs/features/bills.md`). Created/updated/deleted entirely from `bills/[id].tsx` — there's no standalone "create reminder" flow.

## `useReminders()` (`src/features/reminders/useReminders.ts`)

Query key `['reminders']`. Fetches `reminders` where `active = true`, ordered `expiry_date ascending` (soonest first), embedding the parent bill's `merchant_name` and `category` via PostgREST's nested-select syntax (`select('*, bills(merchant_name, category)')`) so the list screen never needs a second round trip. RLS scopes results to `auth.uid()` automatically.

## `/(app)/reminders` screen (`src/app/(app)/reminders.tsx`)

- `daysUntil(expiryDate)` — whole days between today (midnight-normalized) and the expiry date; can be negative for an already-expired reminder that's still `active` (nothing currently auto-deactivates an expired reminder — it just keeps showing as "Expired N days ago" until the user deletes/edits the bill).
- `urgencyLabel(days)` — `"Expired N days ago"` / `"Expires today"` / `"Expires in N days"`.
- `urgent = days <= 7` — rendered in red (`#D64545`) to flag anything expiring within a week (or already expired) as urgent, separate from the 30/7/1-day notification offsets below (this is purely a list-display threshold).
- Tapping a row navigates to `/(app)/bills/${reminder.bill_id}` — the reminders screen itself has no edit affordance; editing a reminder means editing its bill.
- Empty state prompts: "Mark a bill as Warranty or Insurance with an expiry date to get alerts here."

## Local notification scheduling (`src/lib/notifications.ts`)

The **primary** reminder mechanism — works standalone with zero external accounts (no Firebase/FCM needed). Uses `expo-notifications`.

- `OFFSETS_DAYS = [30, 7, 1]` — the fixed set of days-before-expiry a notification fires at.
- Deterministic identifiers: `identifierFor(reminderId, offsetDays) = "reminder-${reminderId}-${offsetDays}d"` — lets the app cancel/reschedule a reminder's notifications by recomputing the same ids, without needing to persist whatever ids `scheduleNotificationAsync` returns.
- `requestNotificationPermissions()` — idempotent; no-ops if already granted/denied (`canAskAgain: false`), otherwise prompts. Called once at app start from the `(app)` root layout, and again defensively inside `scheduleReminderNotifications` before actually scheduling.
- Android channel `'reminders'` ("Warranty & insurance reminders", `DEFAULT` importance) is registered once at module load, guarded by `Platform.OS === 'android'`.
- `cancelReminderNotifications(reminderId)` — cancels all 3 offset notifications for a reminder (safe to call even if none were ever scheduled). Always called before rescheduling, so a changed expiry date never leaves a stale-dated notification behind.
- `scheduleReminderNotifications({reminderId, merchantName, expiryDate})`:
  1. Cancels any existing notifications for the reminder first.
  2. Bails silently if permission isn't granted, or if `expiryDate` doesn't parse.
  3. Computes each offset's trigger time as `9:00 AM` on `expiry - offsetDays`; **skips any offset that's already in the past** (e.g. a reminder created with only 5 days until expiry never gets a 30-day or 7-day notification, only the 1-day one, and if even that's past, none at all) — notifications never fire immediately or retroactively.
  4. Schedules via `Notifications.scheduleNotificationAsync` with a `DATE`-type trigger, body text `"Your ${merchantName} warranty/insurance expires in ${offsetDays} day(s)."`.

Called from `bills/[id].tsx`'s save flow (`docs/features/bills.md`): rescheduled whenever a reminder's expiry date changes, cancelled whenever a reminder is deleted (category changed away from Warranty/Insurance, or expiry date cleared).

## Server-side sweep (secondary, redundant channel)

`send-reminders` edge function (`docs/edge-functions.md`) re-derives the same 30/7/1-day logic server-side, cross-user, intended to run on a schedule. Exists purely as a backstop for a device that missed its local notification (reinstall, cleared storage) — **not yet wired to actually deliver a push** (FCM is stubbed/logged only, per `CLAUDE.md`'s external-setup notes). Marking a reminder "notified" in that sweep means "this offset was processed," not "a push was delivered."

## Free-tier limit: max 2 active reminders

Enforced in **two independent places**:

1. **Client-side pre-check** (`bills/[id].tsx`, `FREE_ACTIVE_REMINDER_LIMIT = 2`): before inserting a brand-new reminder, counts the user's current active reminders and skips creation (showing an upgrade prompt) if already at the limit. This exists purely for UX — showing the paywall prompt inline in the save flow rather than surfacing a raw database error.
2. **Database trigger** (`reminders_enforce_free_tier_limit`, `docs/database.md`): the authoritative enforcement. Fires on any insert/update that transitions a reminder into `active = true` for a `free`-tier user once 2 other active reminders already exist, raising a Postgres exception. This closes the gap where a modified client or a direct REST call with a valid JWT could otherwise bypass the client-side check entirely (RLS alone only checks ownership, not business limits — see `docs/security.md`).

Premium users (`profiles.subscription_tier = 'premium'`) are exempt from both checks — unlimited active reminders.
