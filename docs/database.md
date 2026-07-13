# Database

Source of truth: `supabase/migrations/*.sql`, applied in filename order. Local dev: `supabase start`, then `supabase db reset` to apply all migrations fresh (destructive to local data only) or `supabase migration up` to apply new ones incrementally.

## Extensions

- `pgcrypto` (schema `extensions`) — `gen_random_uuid()` for primary keys.
- `pg_trgm` (schema `extensions`) — trigram GIN index powering merchant-name search.

## Enums

```sql
create type public.subscription_tier as enum ('free', 'premium');
create type public.subscription_store as enum ('app_store', 'play_store');
create type public.bill_category as enum (
  'Warranty', 'Insurance', 'Utilities', 'Subscriptions',
  'Dining & Grocery', 'Medical', 'Travel', 'Other'
);
create type public.bill_source as enum ('camera', 'share_extension', 'whatsapp_business');
create type public.bill_status as enum ('pending_review', 'confirmed');
```

The category list is fixed for v1 — don't add categories without an explicit product decision (see `CLAUDE.md`).

## Tables

Every table has row-level security enabled and scoped to `auth.uid()`. Base table GRANTs are separate from RLS: `anon, authenticated` get full CRUD grants (`20260706070200_grants.sql`) and so does `service_role` (`20260706090000_service_role_grants.sql`, needed because `service_role` has `BYPASSRLS` but Postgres still enforces the underlying GRANT before RLS is even considered). Default privileges are set so future tables inherit the same grants.

### `profiles`

One row per `auth.users` row, auto-created (bare) on signup.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `references auth.users(id) on delete cascade` |
| `name` | `text` | nullable until onboarding |
| `phone_number` | `text` | unique, nullable until onboarding; **identity key for WhatsApp intake** |
| `subscription_tier` | `subscription_tier` | not null, default `'free'` |
| `created_at` | `timestamptz` | not null, default `now()` |

**RLS:**
- `profiles are viewable by owner` — `select using (auth.uid() = id)`
- `profiles are updatable by owner` — `update using (auth.uid() = id) with check (auth.uid() = id)`

**Column-level lockdown** (`20260706100000_profiles_tier_column_grants.sql`): `subscription_tier` cannot be written by `anon`/`authenticated` even though the row-level UPDATE policy would otherwise allow it:
```sql
revoke update on public.profiles from anon, authenticated;
grant update (name, phone_number) on public.profiles to anon, authenticated;
```
Only the `revenuecat-webhook` edge function (service-role key) can change `subscription_tier`. Without this, a signed-in client could self-upgrade with `supabase.from('profiles').update({ subscription_tier: 'premium' })`.

**Trigger:** `on_auth_user_created` (`after insert on auth.users`) calls `handle_new_user()`, which inserts a bare `profiles` row with just the new `id`.

### `bills`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `user_id` | `uuid` | `references profiles(id) on delete cascade` |
| `merchant_name` | `text` | nullable |
| `bill_date` | `date` | nullable |
| `total_amount` | `numeric(12,2)` | nullable |
| `currency` | `text` | not null, default `'INR'` |
| `category` | `bill_category` | not null, default `'Other'` |
| `source` | `bill_source` | not null |
| `storage_path` | `text` | nullable — path in the `bills` storage bucket |
| `extracted_json` | `jsonb` | nullable — raw `parse-bill` output, kept for audit |
| `status` | `bill_status` | not null, default `'pending_review'` |
| `is_warranty_document` | `boolean` | not null, default `false` |
| `is_insurance_document` | `boolean` | not null, default `false` |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` |

**Indexes:** `(user_id)`, `(user_id, bill_date desc)`, `(user_id, category)`, GIN trigram on `merchant_name` (powers the `ilike` merchant search).

**RLS:** `bills are manageable by owner` — `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`.

**Trigger:** `bills_set_updated_at` (`before update`) calls `set_updated_at()`, which sets `new.updated_at = now()`.

### `line_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `bill_id` | `uuid` | `references bills(id) on delete cascade` |
| `description` | `text` | not null |
| `amount` | `numeric(12,2)` | not null |

**Index:** `(bill_id)`.

**RLS:** `line items are manageable by bill owner` — `for all using (exists (select 1 from bills where bills.id = line_items.bill_id and bills.user_id = auth.uid()))`, same clause on `with check`. No `user_id` column of its own — ownership is always derived through the parent bill.

### `reminders`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `bill_id` | `uuid` | `references bills(id) on delete cascade` |
| `user_id` | `uuid` | `references profiles(id) on delete cascade` |
| `expiry_date` | `date` | not null |
| `notified_30d` / `notified_7d` / `notified_1d` | `boolean` | not null, default `false` — flipped by `send-reminders` |
| `active` | `boolean` | not null, default `true` |
| `created_at` | `timestamptz` | not null, default `now()` |

**Indexes:** `(user_id, expiry_date)`, partial index `(expiry_date) where active`.

**RLS:** `reminders are manageable by owner` — `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`.

**Trigger — free-tier enforcement** (`20260706110000_reminders_free_tier_limit.sql`): `reminders_enforce_free_tier_limit` (`before insert or update`) calls `enforce_free_tier_reminder_limit()`:

```sql
create function public.enforce_free_tier_reminder_limit () returns trigger as $$
declare
  tier public.subscription_tier;
  active_count integer;
begin
  if not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active then
    return new;
  end if;

  select subscription_tier into tier from public.profiles where id = new.user_id;
  if tier = 'premium' then
    return new;
  end if;

  select count(*) into active_count
  from public.reminders
  where user_id = new.user_id and active and id <> new.id;

  if active_count >= 2 then
    raise exception 'free tier is limited to 2 active reminders' using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
```

This exists because the "max 2 active reminders" rule was previously enforced only client-side (a count-then-insert in `bills/[id].tsx`) — a modified client or a direct REST call with a valid user JWT could otherwise create unlimited reminders. The trigger only fires on the transition *into* `active = true` (a brand-new active reminder, or reactivating one that was inactive); viewing, listing, or deactivating a reminder is never restricted. See `docs/security.md` for how this was verified.

### `subscriptions`

RevenueCat entitlement audit log, written only by the `revenuecat-webhook` edge function (service-role key).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `user_id` | `uuid` | `references profiles(id) on delete cascade` |
| `tier` | `subscription_tier` | not null, default `'free'` |
| `renewed_at` / `expires_at` | `timestamptz` | nullable |
| `store` | `subscription_store` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Index:** `(user_id)`.

**RLS:** `subscriptions are viewable by owner` — `select using (auth.uid() = user_id)`. **No** client-side insert/update policy exists — only `service_role` writes this table.

## Storage: `bills` bucket

`20260706070100_storage_bills_bucket.sql`:

```sql
insert into storage.buckets (id, name, public) values ('bills', 'bills', false);

create policy "bill images are manageable by owner" on storage.objects for all using (
  bucket_id = 'bills' and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'bills' and auth.uid()::text = (storage.foldername(name))[1]
);
```

- **Private bucket** — never a public URL. All reads go through `supabase.storage.from('bills').createSignedUrl(path, 300)` (5-minute expiry, see `bills/[id].tsx`).
- **Path convention**: `${user_id}/${uuid}.${ext}` — the first path segment must equal `auth.uid()` for the owner-scoped storage RLS policy to match.

## Local seed data

`supabase/seed.sql` creates a demo user (`demo@billorganizer.dev` / `password123`) with sample bills and reminders for local development — run automatically by `supabase db reset` per `supabase/config.toml`'s `[db.seed]` block.

## Migration history

| File | Purpose |
|---|---|
| `20260706070000_init_schema.sql` | Enums, all 5 tables, RLS policies, indexes, `handle_new_user`/`set_updated_at` triggers |
| `20260706070100_storage_bills_bucket.sql` | Private `bills` storage bucket + owner-scoped storage policy |
| `20260706070200_grants.sql` | Base `anon`/`authenticated` table GRANTs (RLS alone doesn't grant access — Postgres denies the underlying DML without an explicit GRANT) + default privileges for future tables |
| `20260706090000_service_role_grants.sql` | Same GRANTs for `service_role`, needed because `BYPASSRLS` doesn't imply table access |
| `20260706100000_profiles_tier_column_grants.sql` | Locks `subscription_tier` to service-role-only writes (column-level GRANT) |
| `20260706110000_reminders_free_tier_limit.sql` | Server-side trigger enforcing "max 2 active reminders" for free tier |
