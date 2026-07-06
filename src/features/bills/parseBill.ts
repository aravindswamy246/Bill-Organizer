import { supabase } from '@/lib/supabase';

import type { ExtractedBill } from './types';

export type ParseBillResult = {
  billId: string;
  extracted: ExtractedBill;
  mode: 'claude' | 'mock';
};

/**
 * Invokes the `parse-bill` edge function for a bill that already has a
 * `storage_path` (set at upload time). The function itself falls back to a
 * mock, empty extraction if `ANTHROPIC_API_KEY` isn't configured or the
 * Claude call fails — this never throws for that case, only for genuine
 * request failures (network, auth, missing bill).
 */
export async function parseBill(billId: string): Promise<ParseBillResult> {
  const { data, error } = await supabase.functions.invoke<ParseBillResult>('parse-bill', {
    body: { billId },
  });
  if (error) throw error;
  if (!data) throw new Error('parse-bill returned no data');
  return data;
}
