import type { Database } from '@/lib/database.types';

export const BILL_CATEGORIES = [
  'Warranty',
  'Insurance',
  'Utilities',
  'Subscriptions',
  'Dining & Grocery',
  'Medical',
  'Travel',
  'Other',
] as const satisfies readonly Database['public']['Enums']['bill_category'][];

export type BillCategory = Database['public']['Enums']['bill_category'];

export type Bill = Database['public']['Tables']['bills']['Row'];
export type LineItem = Database['public']['Tables']['line_items']['Row'];

/** Structured output of the `parse-bill` edge function. Keep in sync with
 * `supabase/functions/parse-bill/index.ts` (Deno can't import this file). */
export type ExtractedBill = {
  merchant_name: string | null;
  bill_date: string | null;
  total_amount: number | null;
  currency: string;
  category_guess: BillCategory;
  line_items: { description: string; amount: number }[];
  is_warranty_document: boolean;
  is_insurance_document: boolean;
  detected_expiry_date: string | null;
  confidence: 'high' | 'medium' | 'low';
};
