import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useEntitlements } from '@/features/paywall/useEntitlements';
import { useTheme } from '@/hooks/use-theme';
import { setDevMockPremium } from '@/lib/devMockPremium';
import { getCurrentOffering, purchasePackage, REVENUECAT_CONFIGURED } from '@/lib/purchases';

// Copy shown at the top of the paywall, tailored to what triggered it
// (prompt.md §5 paywall triggers: historical analytics, 3rd active
// reminder, export tap).
const REASON_COPY: Record<string, string> = {
  analytics: 'See your full spend history and trends by upgrading to Premium.',
  reminders: 'You already have 2 active reminders on the free plan — upgrade for unlimited reminders.',
  export: 'Export your bills as CSV or PDF with Premium.',
};

const BENEFITS = [
  'Full historical analytics & month-over-month trends',
  'Unlimited warranty & insurance reminders',
  'CSV & PDF export of your bills',
];

export default function PaywallScreen() {
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { isPremium } = useEntitlements();
  const params = useLocalSearchParams<{ reason?: string }>();

  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loadingOffering, setLoadingOffering] = useState(REVENUECAT_CONFIGURED);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  useEffect(() => {
    if (!REVENUECAT_CONFIGURED) return;
    getCurrentOffering()
      .then(setOffering)
      .finally(() => setLoadingOffering(false));
  }, []);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setPurchasing(pkg.identifier);
    try {
      await purchasePackage(pkg);
      await queryClient.invalidateQueries({ queryKey: ['revenuecat', 'customerInfo'] });
      router.back();
    } catch (err) {
      const cancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!cancelled) {
        Alert.alert('Purchase failed', err instanceof Error ? err.message : 'Please try again.');
      }
    } finally {
      setPurchasing(null);
    }
  };

  const handleDevToggle = async (nextValue: boolean) => {
    await setDevMockPremium(nextValue);
    await queryClient.invalidateQueries({ queryKey: ['dev', 'mockPremium'] });
    if (nextValue) router.back();
  };

  const reasonCopy = params.reason ? REASON_COPY[params.reason] : undefined;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title" style={styles.title}>
            Bill Organizer Premium
          </ThemedText>
          {reasonCopy ? (
            <ThemedText type="default" themeColor="textSecondary" style={styles.reason}>
              {reasonCopy}
            </ThemedText>
          ) : null}

          <ThemedView style={[styles.benefitsCard, { backgroundColor: theme.backgroundElement }]}>
            {BENEFITS.map((benefit) => (
              <ThemedView key={benefit} style={styles.benefitRow}>
                <ThemedText type="default">•</ThemedText>
                <ThemedText type="default" style={styles.benefitText}>
                  {benefit}
                </ThemedText>
              </ThemedView>
            ))}
          </ThemedView>

          {isPremium ? (
            <ThemedView style={[styles.statusCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">You&apos;re on Premium — thanks for supporting the app!</ThemedText>
              {!REVENUECAT_CONFIGURED ? (
                <Pressable onPress={() => handleDevToggle(false)} hitSlop={Spacing.two}>
                  <ThemedText type="link" themeColor="textSecondary" style={styles.devRevert}>
                    Simulate Free (dev only)
                  </ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
          ) : REVENUECAT_CONFIGURED ? (
            <ThemedView style={styles.packages}>
              {loadingOffering ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Loading plans…
                </ThemedText>
              ) : offering && offering.availablePackages.length > 0 ? (
                offering.availablePackages.map((pkg) => (
                  <PrimaryButton
                    key={pkg.identifier}
                    title={`${pkg.product.title} — ${pkg.product.priceString}`}
                    loading={purchasing === pkg.identifier}
                    disabled={purchasing !== null}
                    onPress={() => handlePurchase(pkg)}
                  />
                ))
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  No plans are available right now.
                </ThemedText>
              )}
            </ThemedView>
          ) : (
            <ThemedView style={[styles.devCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Developer mode</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.devCopy}>
                RevenueCat isn&apos;t configured yet (no API key set), so real purchases aren&apos;t available.
                Use this toggle to simulate Premium locally for testing.
              </ThemedText>
              <PrimaryButton title="Simulate Premium (dev only)" onPress={() => handleDevToggle(true)} />
            </ThemedView>
          )}

          <Pressable onPress={() => router.back()} hitSlop={Spacing.two} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">
              Not now
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  reason: {
    lineHeight: 22,
  },
  benefitsCard: {
    padding: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  benefitRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  benefitText: {
    flex: 1,
  },
  statusCard: {
    padding: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  devRevert: {
    marginTop: Spacing.one,
  },
  packages: {
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  devCard: {
    padding: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  devCopy: {
    lineHeight: 20,
  },
  backLink: {
    alignItems: 'center',
    marginTop: Spacing.three,
  },
});
