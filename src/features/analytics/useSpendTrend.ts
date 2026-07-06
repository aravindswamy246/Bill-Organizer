import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export type MonthSpend = { monthKey: string; label: string; total: number };

/**
 * Month-over-month confirmed spend for the trailing `monthsBack` months
 * (inclusive of the current month). Premium-only feature — callers should
 * gate rendering behind `useEntitlements().isPremium`.
 */
export function useSpendTrend(monthsBack = 6) {
  return useQuery({
    queryKey: ['analytics', 'trend', monthsBack],
    queryFn: async (): Promise<MonthSpend[]> => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await supabase
        .from('bills')
        .select('bill_date, total_amount')
        .eq('status', 'confirmed')
        .gte('bill_date', start);
      if (error) throw error;

      const totalsByMonth = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.bill_date) continue;
        const key = row.bill_date.slice(0, 7);
        totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + (row.total_amount ?? 0));
      }

      const months: MonthSpend[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push({
          monthKey: key,
          label: d.toLocaleDateString('en-IN', { month: 'short' }),
          total: totalsByMonth.get(key) ?? 0,
        });
      }
      return months;
    },
  });
}
