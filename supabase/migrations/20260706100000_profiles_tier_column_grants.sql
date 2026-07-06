-- Lock down `profiles.subscription_tier` so only the service role (via the
-- `revenuecat-webhook` edge function) can change it.
--
-- The RLS policy "profiles are updatable by owner" (20260706070000) is
-- row-level only — it has no column restriction. Combined with the blanket
-- per-table GRANT in 20260706070200_grants.sql (which gives anon/authenticated
-- UPDATE on every column of every public table), any signed-in client could
-- currently do `supabase.from('profiles').update({ subscription_tier: 'premium' })`
-- and bypass the paywall entirely. subscription_tier must only ever be
-- written by the RevenueCat webhook, which authenticates with the
-- service-role key and already has full table grants from
-- 20260706090000_service_role_grants.sql.
--
-- Column-level GRANT is additive on top of the table-level GRANT, so we
-- revoke UPDATE entirely and re-grant only the columns clients still need
-- to write themselves (name, phone_number — used by onboarding).
revoke update on public.profiles
from anon, authenticated;

grant update (name, phone_number) on public.profiles to anon, authenticated;
