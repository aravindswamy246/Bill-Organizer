import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import type { Bill, BillCategory } from './types';

export type DateRangeFilter = 'all' | 'month' | '3months' | 'year';

export type BillListFilters = {
  search: string;
  category: BillCategory | null;
  range: DateRangeFilter;
};

/** Earliest `bill_date` (YYYY-MM-DD) to include for a given range preset, or
 * `null` for "all time". Bills without a `bill_date` (not yet confirmed) are
 * excluded by any preset other than "all time". */
function rangeStart(range: DateRangeFilter): string | null {
  const now = new Date();
  if (range === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (range === '3months') {
    return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);
  }
  if (range === 'year') {
    return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Fetches the signed-in user's bills, chronologically ordered (RLS scopes
 * results to `auth.uid()`), filtered by merchant search / category / date
 * range. Re-queries whenever any filter changes.
 */
export function useBillList(filters: BillListFilters) {
  return useQuery({
    queryKey: ['bills', filters],
    queryFn: async () => {
      let query = supabase
        .from('bills')
        .select('*')
        .order('bill_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (filters.category) query = query.eq('category', filters.category);
      const trimmedSearch = filters.search.trim();
      if (trimmedSearch) query = query.ilike('merchant_name', `%${trimmedSearch}%`);
      const start = rangeStart(filters.range);
      if (start) query = query.gte('bill_date', start);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Bill[];
    },
  });
}
