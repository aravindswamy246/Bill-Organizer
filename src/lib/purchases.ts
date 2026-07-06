import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';

const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

/** The entitlement identifier configured in the RevenueCat dashboard for
 * premium access. Fixed for v1 — there's only one paid tier. */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

/** True once a RevenueCat project + API key exist for this platform. Until
 * then every function below is a no-op — gating falls back entirely to
 * `profiles.subscription_tier` and the local dev mock toggle (see
 * src/lib/devMockPremium.ts and useEntitlements). */
export const REVENUECAT_CONFIGURED = Boolean(Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY);

let configured = false;

/** Configures the RevenueCat SDK for the signed-in user, once per app
 * session. Sets RevenueCat's app_user_id to the Supabase auth user id so
 * `revenuecat-webhook` can map incoming events straight to `profiles.id`. */
export function configurePurchases(userId: string): void {
  if (!REVENUECAT_CONFIGURED || configured) return;
  const apiKey = Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey, appUserID: userId });
  configured = true;
}

/** Fetches the current default offering (packages configured in the
 * RevenueCat dashboard). Returns null in mock mode. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!REVENUECAT_CONFIGURED) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

/** Buys a package and returns the resulting customer info. Throws on
 * failure — callers should check `error.userCancelled` to distinguish a
 * cancelled purchase sheet from a real failure. */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/** Reads cached/fetched customer info. Returns null in mock mode. */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!REVENUECAT_CONFIGURED) return null;
  return Purchases.getCustomerInfo();
}

export function isEntitlementActive(info: CustomerInfo | null): boolean {
  if (!info) return false;
  return typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined';
}
