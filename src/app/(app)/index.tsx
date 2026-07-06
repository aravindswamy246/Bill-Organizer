import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillListItem } from '@/components/bill-list-item';
import { CategoryChip } from '@/components/category-chip';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { BILL_CATEGORIES, type BillCategory } from '@/features/bills/types';
import { useBillList, type DateRangeFilter } from '@/features/bills/useBillList';
import { useTheme } from '@/hooks/use-theme';

const RANGE_OPTIONS: { label: string; value: DateRangeFilter }[] = [
  { label: 'All time', value: 'all' },
  { label: 'This month', value: 'month' },
  { label: 'Last 3 months', value: '3months' },
  { label: 'This year', value: 'year' },
];

const CATEGORY_OPTIONS: readonly string[] = ['All', ...BILL_CATEGORIES];

export default function HomeScreen() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<BillCategory | null>(null);
  const [range, setRange] = useState<DateRangeFilter>('all');

  // Debounce merchant search so we don't re-query on every keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data: bills, isLoading, isFetching, refetch } = useBillList({ search, category, range });
  const hasActiveFilters = search !== '' || category !== null || range !== 'all';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedView style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Hi{profile?.name ? `, ${profile.name}` : ''}
          </ThemedText>
          <ThemedView style={styles.headerLinks}>
            <Pressable onPress={() => router.push('/(app)/analytics')} hitSlop={Spacing.two}>
              <ThemedText type="link" themeColor="textSecondary">
                Analytics
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/(app)/reminders')} hitSlop={Spacing.two}>
              <ThemedText type="link" themeColor="textSecondary">
                Reminders
              </ThemedText>
            </Pressable>
            <Pressable onPress={signOut} hitSlop={Spacing.two}>
              <ThemedText type="link" themeColor="textSecondary">
                Log out
              </ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>

        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search by merchant"
          placeholderTextColor={theme.textSecondary}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={RANGE_OPTIONS}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <CategoryChip
              label={item.label}
              selected={range === item.value}
              onPress={() => setRange(item.value)}
            />
          )}
          contentContainerStyle={styles.chipRow}
        />

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORY_OPTIONS}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <CategoryChip
              label={item}
              selected={item === 'All' ? category === null : category === item}
              onPress={() => setCategory(item === 'All' ? null : (item as BillCategory))}
            />
          )}
          contentContainerStyle={styles.chipRow}
        />

        <FlatList
          style={styles.list}
          data={bills ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <BillListItem bill={item} />}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <ThemedView style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          ListEmptyComponent={
            !isLoading ? (
              <ThemedView style={styles.empty}>
                <ThemedText type="default" themeColor="textSecondary">
                  {hasActiveFilters
                    ? 'No bills match these filters.'
                    : 'No bills yet — capture your first one.'}
                </ThemedText>
              </ThemedView>
            ) : null
          }
        />

        <PrimaryButton
          title="Add a bill"
          onPress={() => router.push('/(app)/capture')}
          style={styles.addButton}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  headerLinks: {
    flexDirection: 'row',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  search: {
    marginTop: Spacing.three,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  chipRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: Spacing.four,
  },
  separator: {
    height: Spacing.two,
    backgroundColor: 'transparent',
  },
  empty: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  addButton: {
    marginBottom: Spacing.three,
  },
});
