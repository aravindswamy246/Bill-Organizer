// Supabase Edge Function: parse-bill
//
// Given a bill that already has a raw file uploaded (`storage_path` set by
// the client's offline queue), downloads that file and extracts structured
// data with Claude's vision API, then writes best-guess fields back onto
// the bill row. The client still requires the user to confirm/edit before
// flipping `status` to 'confirmed' — this function never does that itself.
//
// Runs with the caller's own JWT (not the service role), so every query
// here is subject to the same RLS policies as the client — a user can only
// ever parse their own bills.
//
// Falls back to a mock (empty, low-confidence) extraction when
// ANTHROPIC_API_KEY isn't configured, or when the Claude call fails, so a
// missing/invalid key or a transient API error never blocks the capture
// flow — the user can always fill the confirm screen in manually.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const CATEGORIES = [
  'Warranty',
  'Insurance',
  'Utilities',
  'Subscriptions',
  'Dining & Grocery',
  'Medical',
  'Travel',
  'Other',
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Category = (typeof CATEGORIES)[number];

type ExtractedBill = {
  merchant_name: string | null;
  bill_date: string | null;
  total_amount: number | null;
  currency: string;
  category_guess: Category;
  line_items: { description: string; amount: number }[];
  is_warranty_document: boolean;
  is_insurance_document: boolean;
  detected_expiry_date: string | null;
  confidence: 'high' | 'medium' | 'low';
};

const EXTRACT_BILL_TOOL = {
  name: 'extract_bill',
  description:
    'Extract structured data from a bill, receipt, warranty card, or insurance document image/PDF.',
  input_schema: {
    type: 'object',
    properties: {
      merchant_name: { type: ['string', 'null'], description: 'Store or service provider name.' },
      bill_date: {
        type: ['string', 'null'],
        description: 'Date printed on the document, ISO 8601 (YYYY-MM-DD).',
      },
      total_amount: { type: ['number', 'null'], description: 'Total amount charged.' },
      currency: { type: 'string', description: 'ISO 4217 currency code, e.g. INR.' },
      category_guess: { type: 'string', enum: CATEGORIES },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['description', 'amount'],
        },
      },
      is_warranty_document: { type: 'boolean' },
      is_insurance_document: { type: 'boolean' },
      detected_expiry_date: {
        type: ['string', 'null'],
        description:
          'Warranty or insurance policy expiry date, ISO 8601. Only set when is_warranty_document or is_insurance_document is true and an expiry/valid-until date is visible.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: [
      'merchant_name',
      'bill_date',
      'total_amount',
      'currency',
      'category_guess',
      'line_items',
      'is_warranty_document',
      'is_insurance_document',
      'detected_expiry_date',
      'confidence',
    ],
  },
};

function mockExtraction(): ExtractedBill {
  return {
    merchant_name: null,
    bill_date: null,
    total_amount: null,
    currency: 'INR',
    category_guess: 'Other',
    line_items: [],
    is_warranty_document: false,
    is_insurance_document: false,
    detected_expiry_date: null,
    confidence: 'low',
  };
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function guessMimeTypeFromPath(path: string): string {
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function contentBlockForFile(mimeType: string, base64: string) {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    };
  }
  const imageMediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
    ? mimeType
    : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: base64 } };
}

async function callClaude(
  apiKey: string,
  mimeType: string,
  base64: string,
): Promise<ExtractedBill> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      tools: [EXTRACT_BILL_TOOL],
      tool_choice: { type: 'tool', name: 'extract_bill' },
      messages: [
        {
          role: 'user',
          content: [
            contentBlockForFile(mimeType, base64),
            {
              type: 'text',
              text: 'Extract structured data from this bill, receipt, warranty card, or insurance document using the extract_bill tool. If a field is missing or illegible, use null rather than guessing.',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const toolUse = (data.content ?? []).find(
    (block: { type: string }) => block.type === 'tool_use',
  );
  if (!toolUse) throw new Error('Claude did not return a tool_use block');
  return toolUse.input as ExtractedBill;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

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

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    let extracted: ExtractedBill;
    let mode: 'claude' | 'mock' = 'mock';
    if (apiKey) {
      try {
        extracted = await callClaude(apiKey, mimeType, base64);
        mode = 'claude';
      } catch (error) {
        console.error('Claude extraction failed, falling back to mock extraction', error);
        extracted = mockExtraction();
      }
    } else {
      extracted = mockExtraction();
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
});
