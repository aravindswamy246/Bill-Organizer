import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/AuthProvider';
import type { Database } from '@/lib/database.types';
import { getDevMockPremium } from '@/lib/devMockPremium';
import { getCustomerInfo, isEntitlementActive, REVENUECAT_CONFIGURED } from '@/lib/purchases';

export type EntitlementTier = Database['public']['Tables']['profiles']['Row']['subscription_tier'];

/**
 * Resolves the signed-in user's premium status from three sources, most to
 * least authoritative:
 *  1. `profiles.subscription_tier` — the server-side record, kept in sync by
 *     `revenuecat-webhook` (real purchases, any device).
 *  2. RevenueCat's own cached customer info — checked directly so a just-
 *     completed purchase reflects immediately in the UI without waiting on
 *     the webhook round-trip. Only queried once REVENUECAT_CONFIGURED.
 *  3. A local dev-only mock toggle (src/lib/devMockPremium.ts) — only
 *     consulted when RevenueCat isn't configured at all, so free/premium
 *     gating stays fully testable before a RevenueCat project exists.
 */
export function useEntitlements() {
  const { profile } = useAuth();
  const dbTier: EntitlementTier = profile?.subscription_tier ?? 'free';

  const { data: customerInfo } = useQuery({
    queryKey: ['revenuecat', 'customerInfo'],
    queryFn: getCustomerInfo,
    enabled: REVENUECAT_CONFIGURED,
    staleTime: 60_000,
  });

  const { data: devMockPremium } = useQuery({
    queryKey: ['dev', 'mockPremium'],
    queryFn: getDevMockPremium,
    enabled: !REVENUECAT_CONFIGURED,
    staleTime: 0,
  });

  const isPremium =
    dbTier === 'premium' ||
    (REVENUECAT_CONFIGURED && isEntitlementActive(customerInfo ?? null)) ||
    (!REVENUECAT_CONFIGURED && devMockPremium === true);

  return {
    tier: (isPremium ? 'premium' : dbTier) as EntitlementTier,
    isPremium,
    revenueCatConfigured: REVENUECAT_CONFIGURED,
  };
}
