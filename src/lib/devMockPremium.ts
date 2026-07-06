import AsyncStorage from '@react-native-async-storage/async-storage';

// Dev-only entitlement override, used exclusively when REVENUECAT_CONFIGURED
// is false (see src/lib/purchases.ts) — lets free/premium gating be tested
// end-to-end before a RevenueCat project + store products exist (prompt.md
// "Definition of done" calls for this to work with a *real* sandbox
// purchase; until then, this local toggle stands in for it). Purely
// on-device: never touches `profiles.subscription_tier`, so there's no
// server-side state to reconcile once RevenueCat is actually configured —
// this code path simply becomes unreachable.
const STORAGE_KEY = 'dev:mockPremium';

export async function getDevMockPremium(): Promise<boolean> {
  return (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
}

export async function setDevMockPremium(value: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
}
