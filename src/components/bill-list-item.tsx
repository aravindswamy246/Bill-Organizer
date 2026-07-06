import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Bill } from '@/features/bills/types';
import { useTheme } from '@/hooks/use-theme';

function formatAmount(amount: number | null, currency: string): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(date: string | null): string {
  if (!date) return 'No date';
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function BillListItem({ bill }: { bill: Bill }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/(app)/bills/${bill.id}`)}
      style={[styles.row, { backgroundColor: theme.backgroundElement }]}
    >
      <ThemedView style={styles.info}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {bill.merchant_name || 'Unnamed merchant'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {bill.category} · {formatDate(bill.bill_date)}
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.trailing}>
        <ThemedText type="smallBold">{formatAmount(bill.total_amount, bill.currency)}</ThemedText>
        {bill.status === 'pending_review' ? (
          <ThemedText type="small" themeColor="textSecondary">
            Needs review
          </ThemedText>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  info: {
    flex: 1,
    gap: Spacing.half,
    marginRight: Spacing.two,
    backgroundColor: 'transparent',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
});
