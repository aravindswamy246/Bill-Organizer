import { useQuery } from '@tanstack/react-query';

import type { Bill, BillCategory } from '@/features/bills/types';
import { supabase } from '@/lib/supabase';

export type CategoryTotal = { category: BillCategory; total: number };

export type MonthlyAnalytics = {
  total: number;
  categories: CategoryTotal[];
  /** Raw confirmed bills for the month, kept for the per-category drill-down. */
  bills: Bill[];
};

function monthKey(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(month: Date): { start: string; end: string } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString().slice(0, 10);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Aggregates the signed-in user's **confirmed** bills for one calendar month
 * into a category breakdown + total. Only confirmed bills count toward
 * spend — a bill still pending review hasn't had its extracted amount
 * verified by the user yet (see CLAUDE.md: never trust automated extraction
 * for money).
 */
export function useMonthlyAnalytics(month: Date) {
  return useQuery({
    queryKey: ['analytics', 'month', monthKey(month)],
    queryFn: async (): Promise<MonthlyAnalytics> => {
      const { start, end } = monthBounds(month);
      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .eq('status', 'confirmed')
        .gte('bill_date', start)
        .lt('bill_date', end);
      if (error) throw error;

      const bills = (data ?? []) as Bill[];
      const totalsByCategory = new Map<BillCategory, number>();
      let total = 0;
      for (const bill of bills) {
        const amount = bill.total_amount ?? 0;
        total += amount;
        totalsByCategory.set(bill.category, (totalsByCategory.get(bill.category) ?? 0) + amount);
      }
      const categories = Array.from(totalsByCategory.entries())
        .map(([category, categoryTotal]) => ({ category, total: categoryTotal }))
        .sort((a, b) => b.total - a.total);

      return { total, categories, bills };
    },
  });
}
