import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Reminder } from '@/features/reminders/useReminders';
import { useReminders } from '@/features/reminders/useReminders';
import { useTheme } from '@/hooks/use-theme';

/** Days between today and an ISO (YYYY-MM-DD) expiry date, floored — can be
 * negative for an already-expired reminder. */
function daysUntil(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function urgencyLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

function ReminderRow({ reminder }: { reminder: Reminder }) {
  const router = useRouter();
  const theme = useTheme();
  const days = daysUntil(reminder.expiry_date);
  const urgent = days <= 7;

  return (
    <Pressable
      onPress={() => router.push(`/(app)/bills/${reminder.bill_id}`)}
      style={[styles.row, { backgroundColor: theme.backgroundElement }]}
    >
      <ThemedView style={styles.rowContent}>
        <ThemedText type="default">{reminder.bills?.merchant_name ?? 'Unknown merchant'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {reminder.bills?.category ?? ''} · expires {reminder.expiry_date}
        </ThemedText>
      </ThemedView>
      <ThemedText
        type="smallBold"
        style={urgent ? styles.urgent : undefined}
        themeColor={urgent ? undefined : 'textSecondary'}
      >
        {urgencyLabel(days)}
      </ThemedText>
    </Pressable>
  );
}

export default function RemindersScreen() {
  const router = useRouter();
  const { data: reminders, isLoading, isFetching, refetch } = useReminders();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedView style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={Spacing.two}>
            <ThemedText type="link" themeColor="textSecondary">
              Back
            </ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.title}>
            Reminders
          </ThemedText>
        </ThemedView>

        <FlatList
          style={styles.list}
          data={reminders ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ReminderRow reminder={item} />}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <ThemedView style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          ListEmptyComponent={
            !isLoading ? (
              <ThemedView style={styles.empty}>
                <ThemedText type="default" themeColor="textSecondary">
                  No active reminders. Mark a bill as Warranty or Insurance with an expiry date to
                  get alerts here.
                </ThemedText>
              </ThemedView>
            ) : null
          }
        />
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  header: {
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  list: {
    flex: 1,
    marginTop: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  rowContent: {
    flex: 1,
    gap: Spacing.one,
    backgroundColor: 'transparent',
  },
  separator: {
    height: Spacing.two,
    backgroundColor: 'transparent',
  },
  urgent: {
    color: '#D64545',
  },
  empty: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
});
