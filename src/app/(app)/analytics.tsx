import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { BillListItem } from '@/components/bill-list-item';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useMonthlyAnalytics } from '@/features/analytics/useMonthlyAnalytics';
import { useSpendTrend } from '@/features/analytics/useSpendTrend';
import type { BillCategory } from '@/features/bills/types';
import { useEntitlements } from '@/features/paywall/useEntitlements';
import { useTheme } from '@/hooks/use-theme';

const CATEGORY_COLORS: Record<BillCategory, string> = {
  Warranty: '#208AEF',
  Insurance: '#5AC8FA',
  Utilities: '#34C759',
  Subscriptions: '#AF52DE',
  'Dining & Grocery': '#FF9500',
  Medical: '#FF3B30',
  Travel: '#FFCC00',
  Other: '#8E8E93',
};

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export default function AnalyticsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isPremium } = useEntitlements();

  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedCategory, setSelectedCategory] = useState<BillCategory | null>(null);

  const viewingCurrentMonth = isSameMonth(month, now);
  const locked = !viewingCurrentMonth && !isPremium;

  const { data, isLoading } = useMonthlyAnalytics(month);
  const { data: trend } = useSpendTrend(6);

  const goToPreviousMonth = () => {
    if (locked) return; // already viewing a locked month — don't dig further into history
    setSelectedCategory(null);
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    if (viewingCurrentMonth) return; // can't navigate into the future
    setSelectedCategory(null);
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const showUpgradePrompt = () => {
    // TODO(Phase 11): replace with navigation to the real RevenueCat paywall screen.
    Alert.alert(
      'Upgrade to Premium',
      'Historical analytics and spend trends are a premium feature. Premium purchases are coming soon.',
    );
  };

  const barData =
    data?.categories.map((entry) => ({
      value: entry.total,
      label: entry.category.length > 8 ? `${entry.category.slice(0, 7)}…` : entry.category,
      frontColor: CATEGORY_COLORS[entry.category],
    })) ?? [];

  const trendData = trend?.map((entry) => ({ value: entry.total, label: entry.label })) ?? [];

  const drillDownBills = selectedCategory
    ? (data?.bills.filter((bill) => bill.category === selectedCategory) ?? [])
    : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title" style={styles.title}>
            Analytics
          </ThemedText>

          <ThemedView style={styles.monthNav}>
            <Pressable onPress={goToPreviousMonth} disabled={locked} hitSlop={Spacing.two}>
              <ThemedText
                type="linkPrimary"
                themeColor={locked ? 'textSecondary' : undefined}
              >
                ‹ Prev
              </ThemedText>
            </Pressable>
            <ThemedText type="subtitle" style={styles.monthLabel}>
              {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </ThemedText>
            <Pressable onPress={goToNextMonth} disabled={viewingCurrentMonth} hitSlop={Spacing.two}>
              <ThemedText
                type="linkPrimary"
                themeColor={viewingCurrentMonth ? 'textSecondary' : undefined}
              >
                Next ›
              </ThemedText>
            </Pressable>
          </ThemedView>

          {locked ? (
            <Pressable
              onPress={showUpgradePrompt}
              style={[styles.lockedCard, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="smallBold">Premium feature</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.lockedCopy}>
                Upgrade to Premium to view analytics for past months.
              </ThemedText>
            </Pressable>
          ) : (
            <>
              <ThemedView style={[styles.totalCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Total spend
                </ThemedText>
                <ThemedText type="title" style={styles.totalAmount}>
                  {isLoading ? '…' : formatINR(data?.total ?? 0)}
                </ThemedText>
              </ThemedView>

              {barData.length > 0 ? (
                <ThemedView style={styles.chartCard}>
                  <BarChart
                    data={barData}
                    barWidth={28}
                    spacing={20}
                    roundedTop
                    hideRules
                    xAxisThickness={0}
                    yAxisThickness={0}
                    yAxisTextStyle={{ color: theme.textSecondary }}
                    xAxisLabelTextStyle={{ color: theme.textSecondary, fontSize: 11 }}
                    noOfSections={4}
                  />
                </ThemedView>
              ) : !isLoading ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
                  No confirmed bills for this month yet.
                </ThemedText>
              ) : null}

              <ThemedText type="smallBold" style={styles.sectionLabel}>
                By category
              </ThemedText>
              {(data?.categories ?? []).map((entry) => (
                <Pressable
                  key={entry.category}
                  onPress={() =>
                    setSelectedCategory((current) =>
                      current === entry.category ? null : entry.category,
                    )
                  }
                  style={[styles.categoryRow, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedView style={styles.categoryLabelRow}>
                    <ThemedView
                      style={[styles.dot, { backgroundColor: CATEGORY_COLORS[entry.category] }]}
                    />
                    <ThemedText type="default">{entry.category}</ThemedText>
                  </ThemedView>
                  <ThemedText type="smallBold">{formatINR(entry.total)}</ThemedText>
                </Pressable>
              ))}

              {selectedCategory ? (
                <ThemedView style={styles.drillDown}>
                  <ThemedText type="smallBold" style={styles.sectionLabel}>
                    {selectedCategory} bills
                  </ThemedText>
                  {drillDownBills.map((bill) => (
                    <BillListItem key={bill.id} bill={bill} />
                  ))}
                </ThemedView>
              ) : null}

              <ThemedText type="smallBold" style={styles.sectionLabel}>
                Spend trend
              </ThemedText>
              {isPremium ? (
                trendData.length > 0 ? (
                  <ThemedView style={styles.chartCard}>
                    <LineChart
                      data={trendData}
                      color={theme.text}
                      thickness={2}
                      hideRules
                      xAxisThickness={0}
                      yAxisThickness={0}
                      yAxisTextStyle={{ color: theme.textSecondary }}
                      xAxisLabelTextStyle={{ color: theme.textSecondary, fontSize: 11 }}
                      noOfSections={4}
                    />
                  </ThemedView>
                ) : null
              ) : (
                <Pressable
                  onPress={showUpgradePrompt}
                  style={[styles.lockedCard, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText type="small" themeColor="textSecondary" style={styles.lockedCopy}>
                    Upgrade to Premium to see your spend trend over time.
                  </ThemedText>
                </Pressable>
              )}
            </>
          )}

          <Pressable onPress={() => router.back()} hitSlop={Spacing.two} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">
              Back
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
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  monthLabel: {
    fontSize: 18,
    lineHeight: 24,
  },
  totalCard: {
    padding: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.half,
  },
  totalAmount: {
    fontSize: 32,
    lineHeight: 38,
  },
  chartCard: {
    paddingVertical: Spacing.three,
    backgroundColor: 'transparent',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  categoryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  drillDown: {
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  lockedCard: {
    padding: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.half,
  },
  lockedCopy: {
    lineHeight: 20,
  },
  emptyCopy: {
    paddingVertical: Spacing.three,
  },
  backLink: {
    alignItems: 'center',
    marginTop: Spacing.three,
  },
});
