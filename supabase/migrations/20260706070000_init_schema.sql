-- Bill Organizer — initial schema
-- profiles, bills, line_items, reminders, subscriptions
-- All tables use row-level security scoped to auth.uid().

create extension if not exists pgcrypto with schema extensions;

create extension if not exists pg_trgm with schema extensions;

create type public.subscription_tier as enum ('free', 'premium');
create type public.subscription_store as enum ('app_store', 'play_store');
create type public.bill_category as enum (
  'Warranty',
  'Insurance',
  'Utilities',
  'Subscriptions',
  'Dining & Grocery',
  'Medical',
  'Travel',
  'Other'
);
create type public.bill_source as enum ('camera', 'share_extension', 'whatsapp_business');
create type public.bill_status as enum ('pending_review', 'confirmed');

-- ---------------------------------------------------------------------------
-- profiles
-- One row per auth user. Created automatically (bare) on signup; name and
-- phone_number are filled in during the post-signup onboarding step, so both
-- are nullable until onboarding completes. phone_number is the identity key
-- used to match inbound WhatsApp Business messages to an account.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  phone_number text unique,
  subscription_tier public.subscription_tier not null default 'free',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are viewable by owner" on public.profiles for select using (auth.uid () = id);

create policy "profiles are updatable by owner" on public.profiles
for update
using (auth.uid () = id)
with
  check (auth.uid () = id);

-- Auto-create a bare profile row when a new auth user signs up.
create function public.handle_new_user () returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- bills
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.profiles (id) on delete cascade,
  merchant_name text,
  bill_date date,
  total_amount numeric(12, 2),
  currency text not null default 'INR',
  category public.bill_category not null default 'Other',
  source public.bill_source not null,
  storage_path text,
  extracted_json jsonb,
  status public.bill_status not null default 'pending_review',
  is_warranty_document boolean not null default false,
  is_insurance_document boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bills_user_id_idx on public.bills (user_id);
create index bills_user_id_bill_date_idx on public.bills (user_id, bill_date desc);
create index bills_user_id_category_idx on public.bills (user_id, category);
create index bills_merchant_name_trgm_idx on public.bills using gin (merchant_name gin_trgm_ops);

alter table public.bills enable row level security;

create policy "bills are manageable by owner" on public.bills for all using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

create function public.set_updated_at () returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger bills_set_updated_at before
update on public.bills for each row
execute function public.set_updated_at ();

-- ---------------------------------------------------------------------------
-- line_items
-- ---------------------------------------------------------------------------
create table public.line_items (
  id uuid primary key default gen_random_uuid (),
  bill_id uuid not null references public.bills (id) on delete cascade,
  description text not null,
  amount numeric(12, 2) not null
);

create index line_items_bill_id_idx on public.line_items (bill_id);

alter table public.line_items enable row level security;

create policy "line items are manageable by bill owner" on public.line_items for all using (
  exists (
    select 1
    from public.bills
    where
      bills.id = line_items.bill_id
      and bills.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select 1
      from public.bills
      where
        bills.id = line_items.bill_id
        and bills.user_id = auth.uid ()
    )
  );

-- ---------------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid (),
  bill_id uuid not null references public.bills (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expiry_date date not null,
  notified_30d boolean not null default false,
  notified_7d boolean not null default false,
  notified_1d boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index reminders_user_id_expiry_date_idx on public.reminders (user_id, expiry_date);
create index reminders_active_expiry_date_idx on public.reminders (expiry_date)
where
  active;

alter table public.reminders enable row level security;

create policy "reminders are manageable by owner" on public.reminders for all using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

-- ---------------------------------------------------------------------------
-- subscriptions (RevenueCat entitlement records)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier public.subscription_tier not null default 'free',
  renewed_at timestamptz,
  expires_at timestamptz,
  store public.subscription_store,
  created_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions are viewable by owner" on public.subscriptions for select using (auth.uid () = user_id);

-- Only the service role (via edge functions / RevenueCat webhook) writes
-- subscription state — no client-side insert/update policy is defined.
