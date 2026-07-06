import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryChip } from '@/components/category-chip';
import { FormField } from '@/components/form-field';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { parseBill } from '@/features/bills/parseBill';
import { BILL_CATEGORIES, type Bill, type BillCategory } from '@/features/bills/types';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const EXPIRY_CATEGORIES: readonly BillCategory[] = ['Warranty', 'Insurance'];

type LineItemRow = { description: string; amount: string };

export default function BillDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const billId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  const [merchantName, setMerchantName] = useState('');
  const [billDate, setBillDate] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [category, setCategory] = useState<BillCategory>('Other');
  const [expiryDate, setExpiryDate] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);

  const needsExpiry = EXPIRY_CATEGORIES.includes(category);

  const load = useCallback(async () => {
    if (!billId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data: bill, error } = await supabase
        .from('bills')
        .select('*')
        .eq('id', billId)
        .single<Bill>();
      if (error || !bill) throw error ?? new Error('Bill not found');

      setStoragePath(bill.storage_path);
      if (bill.storage_path) {
        const { data: signed } = await supabase.storage
          .from('bills')
          .createSignedUrl(bill.storage_path, 300);
        if (signed?.signedUrl) setImageUrl(signed.signedUrl);
      }

      if (!bill.extracted_json && bill.status === 'pending_review') {
        setParsing(true);
        try {
          const result = await parseBill(bill.id);
          const extracted = result.extracted;
          setMerchantName(extracted.merchant_name ?? '');
          setBillDate(extracted.bill_date ?? '');
          setTotalAmount(extracted.total_amount != null ? String(extracted.total_amount) : '');
          setCategory(extracted.category_guess);
          setExpiryDate(extracted.detected_expiry_date ?? '');
          setLineItems(
            extracted.line_items.map((item) => ({
              description: item.description,
              amount: String(item.amount),
            })),
          );
          setLowConfidence(extracted.confidence === 'low');
        } catch (parseErr) {
          console.error('parseBill failed', parseErr);
          setLowConfidence(true);
        } finally {
          setParsing(false);
        }
      } else {
        setMerchantName(bill.merchant_name ?? '');
        setBillDate(bill.bill_date ?? '');
        setTotalAmount(bill.total_amount != null ? String(bill.total_amount) : '');
        setCategory(bill.category);

        const [{ data: items }, { data: reminder }] = await Promise.all([
          supabase.from('line_items').select('*').eq('bill_id', bill.id),
          supabase.from('reminders').select('*').eq('bill_id', bill.id).maybeSingle(),
        ]);
        setLineItems(
          (items ?? []).map((item) => ({ description: item.description, amount: String(item.amount) })),
        );
        setExpiryDate(reminder?.expiry_date ?? '');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this bill.');
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    // One-time fetch (+ optional parse) on mount, not a cascading update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const updateLineItem = (index: number, patch: Partial<LineItemRow>) => {
    setLineItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeLineItem = (index: number) => {
    setLineItems((rows) => rows.filter((_, i) => i !== index));
  };

  const addLineItem = () => {
    setLineItems((rows) => [...rows, { description: '', amount: '' }]);
  };

  const handleSave = async () => {
    if (!billId) return;
    setSaveError(null);

    const trimmedMerchant = merchantName.trim();
    if (!trimmedMerchant) {
      setSaveError('Merchant name is required.');
      return;
    }
    const parsedTotal = Number(totalAmount);
    if (totalAmount.trim() === '' || Number.isNaN(parsedTotal) || parsedTotal < 0) {
      setSaveError('Enter a valid total amount.');
      return;
    }
    if (needsExpiry && expiryDate.trim() && Number.isNaN(Date.parse(expiryDate.trim()))) {
      setSaveError('Expiry date must be a valid date (YYYY-MM-DD).');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error: updateError } = await supabase
        .from('bills')
        .update({
          merchant_name: trimmedMerchant,
          bill_date: billDate.trim() || null,
          total_amount: parsedTotal,
          category,
          status: 'confirmed',
          is_warranty_document: category === 'Warranty',
          is_insurance_document: category === 'Insurance',
        })
        .eq('id', billId);
      if (updateError) throw updateError;

      const validLineItems = lineItems
        .map((row) => ({ description: row.description.trim(), amount: Number(row.amount) }))
        .filter((row) => row.description !== '' && !Number.isNaN(row.amount));

      const { error: deleteItemsError } = await supabase
        .from('line_items')
        .delete()
        .eq('bill_id', billId);
      if (deleteItemsError) throw deleteItemsError;

      if (validLineItems.length > 0) {
        const { error: insertItemsError } = await supabase
          .from('line_items')
          .insert(validLineItems.map((row) => ({ ...row, bill_id: billId })));
        if (insertItemsError) throw insertItemsError;
      }

      const trimmedExpiry = expiryDate.trim();
      if (needsExpiry && trimmedExpiry) {
        const { data: existingReminder } = await supabase
          .from('reminders')
          .select('id')
          .eq('bill_id', billId)
          .maybeSingle();
        if (existingReminder) {
          const { error: reminderError } = await supabase
            .from('reminders')
            .update({ expiry_date: trimmedExpiry, active: true })
            .eq('id', existingReminder.id);
          if (reminderError) throw reminderError;
        } else {
          const { error: reminderError } = await supabase.from('reminders').insert({
            bill_id: billId,
            user_id: user.id,
            expiry_date: trimmedExpiry,
          });
          if (reminderError) throw reminderError;
        }
      } else {
        const { error: reminderDeleteError } = await supabase
          .from('reminders')
          .delete()
          .eq('bill_id', billId);
        if (reminderDeleteError) throw reminderDeleteError;
      }

      await queryClient.invalidateQueries({ queryKey: ['bills'] });
      router.replace('/(app)');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this bill.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!billId) return;
    Alert.alert('Delete bill?', 'This permanently removes the bill, its image, and any reminder.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setSaveError(null);
          try {
            if (storagePath) {
              await supabase.storage.from('bills').remove([storagePath]);
            }
            const { error } = await supabase.from('bills').delete().eq('id', billId);
            if (error) throw error;
            await queryClient.invalidateQueries({ queryKey: ['bills'] });
            router.replace('/(app)');
          } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not delete this bill.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centered}>
          <ThemedText type="default">Loading bill…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (loadError) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centered}>
          <ThemedText type="default">{loadError}</ThemedText>
          <Pressable onPress={() => router.back()} hitSlop={Spacing.two}>
            <ThemedText type="linkPrimary">Go back</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Pressable onPress={() => router.back()} hitSlop={Spacing.two}>
            <ThemedText type="link" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.title}>
            Review bill
          </ThemedText>

          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.preview} contentFit="contain" />
          ) : null}

          {parsing ? (
            <ThemedView style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">Reading this bill…</ThemedText>
            </ThemedView>
          ) : null}

          {lowConfidence && !parsing ? (
            <ThemedView style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">
                We couldn&apos;t confidently read all the details — please double-check the fields
                below before saving.
              </ThemedText>
            </ThemedView>
          ) : null}

          <FormField
            label="Merchant"
            value={merchantName}
            onChangeText={setMerchantName}
            placeholder="e.g. Amazon"
          />
          <FormField
            label="Date"
            value={billDate}
            onChangeText={setBillDate}
            placeholder="YYYY-MM-DD"
          />
          <FormField
            label="Total amount"
            value={totalAmount}
            onChangeText={setTotalAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <ThemedText type="smallBold" style={styles.sectionLabel}>
            Category
          </ThemedText>
          <ThemedView style={styles.chipRow}>
            {BILL_CATEGORIES.map((option) => (
              <CategoryChip
                key={option}
                label={option}
                selected={category === option}
                onPress={() => setCategory(option)}
              />
            ))}
          </ThemedView>

          {needsExpiry ? (
            <FormField
              label="Expiry date"
              value={expiryDate}
              onChangeText={setExpiryDate}
              placeholder="YYYY-MM-DD"
            />
          ) : null}

          <ThemedText type="smallBold" style={styles.sectionLabel}>
            Line items
          </ThemedText>
          {lineItems.map((row, index) => (
            <ThemedView key={index} style={styles.lineItemRow}>
              <FormField
                label=""
                value={row.description}
                onChangeText={(text) => updateLineItem(index, { description: text })}
                placeholder="Description"
                style={styles.lineItemDescription}
              />
              <FormField
                label=""
                value={row.amount}
                onChangeText={(text) => updateLineItem(index, { amount: text })}
                placeholder="0.00"
                keyboardType="decimal-pad"
                style={styles.lineItemAmount}
              />
              <Pressable onPress={() => removeLineItem(index)} hitSlop={Spacing.two}>
                <ThemedText type="small" themeColor="textSecondary">
                  Remove
                </ThemedText>
              </Pressable>
            </ThemedView>
          ))}
          <Pressable onPress={addLineItem} hitSlop={Spacing.two}>
            <ThemedText type="linkPrimary">+ Add line item</ThemedText>
          </Pressable>

          {saveError ? (
            <ThemedText type="small" style={styles.saveError}>
              {saveError}
            </ThemedText>
          ) : null}

          <PrimaryButton
            title="Save"
            loading={saving}
            disabled={parsing || deleting}
            onPress={handleSave}
            style={styles.saveButton}
          />

          <Pressable
            onPress={handleDelete}
            disabled={saving || deleting}
            hitSlop={Spacing.two}
            style={styles.deleteButton}
          >
            <ThemedText type="link" style={styles.deleteLabel}>
              {deleting ? 'Deleting…' : 'Delete bill'}
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: Spacing.two,
  },
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  lineItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  lineItemDescription: {
    flex: 2,
  },
  lineItemAmount: {
    flex: 1,
  },
  saveError: {
    color: '#D64545',
  },
  saveButton: {
    marginTop: Spacing.three,
  },
  deleteButton: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  deleteLabel: {
    color: '#D64545',
  },
});
