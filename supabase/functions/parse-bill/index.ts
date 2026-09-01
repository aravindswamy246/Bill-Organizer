// Supabase Edge Function: parse-bill
//
// Given a bill that already has a raw file uploaded (`storage_path` set by
// the client's offline queue), downloads that file and extracts structured
// data through the configured vision provider (default: Anthropic/Claude —
// see ./providers/index.ts) via its vision API, then writes best-guess
// fields back onto the bill row. The client still requires the user to
// confirm/edit before flipping `status` to 'confirmed' — this function
// never does that itself.
//
// Runs with the caller's own JWT (not the service role), so every query
// here is subject to the same RLS policies as the client — a user can only
// ever parse their own bills.
//
// Falls back to a mock (empty, low-confidence) extraction when no vision
// provider is configured (e.g. the default Anthropic provider has no
// ANTHROPIC_API_KEY set), VISION_PROVIDER names an unknown provider, or
// the provider's extract() call fails — so a missing/invalid key or a
// transient API error never blocks the capture flow — the user can always
// fill the confirm screen in manually.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getVisionProvider } from './providers/index.ts';
import { mockExtraction, type ExtractedBill } from './providers/types.ts';

// Re-exported so existing importers (index.test.ts, and anything else
// that imported these directly from this module before the provider
// split) keep working unchanged.
export { mockExtraction, type ExtractedBill };
export { callClaude, contentBlockForFile } from './providers/anthropic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function guessMimeTypeFromPath(path: string): string {
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// Minimal shape of the supabase-js calls this function makes — narrow
// enough that `index.test.ts` can pass a hand-written fake instead of a
// real `SupabaseClient`, so the download/extract/save logic is
// unit-testable without a live Supabase project.
export type BillsClient = {
  from(table: 'bills'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        single(): Promise<{
          data: { id: string; storage_path: string | null } | null;
          error: unknown;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: unknown }>;
    };
  };
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
};

function defaultGetClient(authHeader: string): BillsClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  }) as unknown as BillsClient;
}

// Exported so `index.test.ts` can inject a fake client and mock `fetch`
// (Claude) to exercise the full request/response cycle without a live
// Supabase project or a real Anthropic API key. `Deno.serve` is only
// invoked when this module is run directly (the Supabase edge runtime's
// entrypoint), not on import.
export function createHandler(getClient: (authHeader: string) => BillsClient = defaultGetClient) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { billId } = await req.json();
      if (!billId || typeof billId !== 'string') {
        return json({ error: 'billId is required' }, 400);
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

      const supabase = getClient(authHeader);

      const { data: bill, error: billError } = await supabase
        .from('bills')
        .select('id, storage_path')
        .eq('id', billId)
        .single();
      if (billError || !bill) return json({ error: 'Bill not found' }, 404);
      if (!bill.storage_path) return json({ error: 'Bill has no uploaded file' }, 400);

      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('bills')
        .download(bill.storage_path);
      if (downloadError || !fileBlob) return json({ error: 'Could not download bill file' }, 500);

      const mimeType = fileBlob.type || guessMimeTypeFromPath(bill.storage_path);
      const bytes = new Uint8Array(await fileBlob.arrayBuffer());
      const base64 = base64Encode(bytes);

      let extracted: ExtractedBill;
      let mode = 'mock';
      const provider = getVisionProvider();
      if (provider) {
        try {
          extracted = await provider.extract(mimeType, base64);
          // Legacy mode string: the Anthropic provider is registered as
          // 'anthropic' (see providers/anthropic.ts), but stored
          // extraction rows and existing tests have always used 'claude'
          // for mode/_mode — map it here instead of renaming the
          // provider, so already-stored data keeps meaning the same
          // thing.
          mode = provider.name === 'anthropic' ? 'claude' : provider.name;
        } catch (error) {
          console.error(
            `${provider.name} extraction failed, falling back to mock extraction`,
            error,
          );
          extracted = mockExtraction();
          mode = 'mock';
        }
      } else {
        extracted = mockExtraction();
        mode = 'mock';
      }

      const { error: updateError } = await supabase
        .from('bills')
        .update({
          extracted_json: { ...extracted, _mode: mode },
          merchant_name: extracted.merchant_name,
          bill_date: extracted.bill_date,
          total_amount: extracted.total_amount,
          currency: extracted.currency || 'INR',
          category: extracted.category_guess,
          is_warranty_document: extracted.is_warranty_document,
          is_insurance_document: extracted.is_insurance_document,
        })
        .eq('id', billId);
      if (updateError) return json({ error: 'Could not save extraction result' }, 500);

      return json({ billId, extracted, mode });
    } catch (error) {
      console.error('parse-bill error', error);
      return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
  };
}

export const handler = createHandler();

if (import.meta.main) Deno.serve(handler);
