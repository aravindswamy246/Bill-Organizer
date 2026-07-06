import { useAuth } from '@/features/auth/AuthProvider';
import type { Database } from '@/lib/database.types';

export type EntitlementTier = Database['public']['Tables']['profiles']['Row']['subscription_tier'];

/**
 * Reads the signed-in user's entitlement tier from `profiles.subscription_tier`.
 * This is the real, server-backed source of truth (kept in sync by the
 * RevenueCat purchase flow once that's wired up) — there's no separate mock
 * layer here because the column defaults to `free` regardless of whether
 * RevenueCat is configured, so gating already degrades gracefully with no
 * external accounts.
 */
export function useEntitlements() {
  const { profile } = useAuth();
  const tier: EntitlementTier = profile?.subscription_tier ?? 'free';
  return {
    tier,
    isPremium: tier === 'premium',
  };
}
