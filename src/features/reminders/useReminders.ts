import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BillCategory } from '@/features/bills/types';
import type { Database } from '@/lib/database.types';

export type Reminder = Database['public']['Tables']['reminders']['Row'] & {
  bills: { merchant_name: string; category: BillCategory } | null;
};

/** Active reminders, soonest-expiring first — used by the reminders list
 * screen. Joins the parent bill's merchant name + category via PostgREST
 * embedding so the list can render without an extra round trip. */
export function useReminders() {
  return useQuery({
    queryKey: ['reminders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminders')
        .select('*, bills(merchant_name, category)')
        .eq('active', true)
        .order('expiry_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Reminder[];
    },
  });
}
