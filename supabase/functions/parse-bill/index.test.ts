// Unit tests for the parse-bill edge function.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/parse-bill/index.test.ts
//
// (--allow-net is only needed because the module-level import of
// npm:@supabase/supabase-js resolves lazily; no test here makes a real
// network call — `fetch` to the Claude API is stubbed per-test.)
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  base64Encode,
  callClaude,
  contentBlockForFile,
  createHandler,
  guessMimeTypeFromPath,
  mockExtraction,
  type BillsClient,
} from './index.ts';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/parse-bill', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function fakeClient(opts: {
  bill?: { id: string; storage_path: string | null } | null;
  billError?: unknown;
  fileBlob?: Blob | null;
  downloadError?: unknown;
  updateError?: unknown;
}) {
  const updates: Record<string, unknown>[] = [];
  const client: BillsClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: opts.bill ?? null,
            error: opts.billError ?? null,
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(values);
          return { error: opts.updateError ?? null };
        },
      }),
    }),
    storage: {
      from: () => ({
        download: async () => ({
          data: opts.fileBlob ?? null,
          error: opts.downloadError ?? null,
        }),
      }),
    },
  };
  return { client, updates };
}

Deno.test('rejects a request with no billId', async () => {
  const { client } = fakeClient({});
  const handler = createHandler(() => client);
  const res = await handler(req({}, { Authorization: 'Bearer token' }));
  assertEquals(res.status, 400);
});

Deno.test('rejects a request with no Authorization header', async () => {
  const { client } = fakeClient({});
  const handler = createHandler(() => client);
  const res = await handler(req({ billId: 'bill-1' }));
  assertEquals(res.status, 401);
});

Deno.test('returns 404 when the bill is not found (e.g. RLS blocks another user\'s bill)', async () => {
  const { client } = fakeClient({ bill: null, billError: { message: 'not found' } });
  const handler = createHandler(() => client);
  const res = await handler(req({ billId: 'bill-1' }, { Authorization: 'Bearer token' }));
  assertEquals(res.status, 404);
});

Deno.test('returns 400 when the bill has no uploaded file yet', async () => {
  const { client } = fakeClient({ bill: { id: 'bill-1', storage_path: null } });
  const handler = createHandler(() => client);
  const res = await handler(req({ billId: 'bill-1' }, { Authorization: 'Bearer token' }));
  assertEquals(res.status, 400);
});

Deno.test('falls back to mock extraction when ANTHROPIC_API_KEY is not set, and still saves the bill', async () => {
  Deno.env.delete('ANTHROPIC_API_KEY');
  const fileBlob = new Blob(['fake image bytes'], { type: 'image/jpeg' });
  const { client, updates } = fakeClient({
    bill: { id: 'bill-1', storage_path: 'user-1/bill-1.jpg' },
    fileBlob,
  });
  const handler = createHandler(() => client);
  const res = await handler(req({ billId: 'bill-1' }, { Authorization: 'Bearer token' }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.mode, 'mock');
  assertEquals(body.extracted, mockExtraction());
  assertEquals(updates.length, 1);
  assertEquals(updates[0].category, 'Other');
});

Deno.test('falls back to mock extraction (never blocking the save) when the Claude call throws', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response('rate limited', { status: 429 }))) as typeof fetch;
  try {
    const fileBlob = new Blob(['fake image bytes'], { type: 'image/jpeg' });
    const { client } = fakeClient({
      bill: { id: 'bill-1', storage_path: 'user-1/bill-1.jpg' },
      fileBlob,
    });
    const handler = createHandler(() => client);
    const res = await handler(req({ billId: 'bill-1' }, { Authorization: 'Bearer token' }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.mode, 'mock');
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete('ANTHROPIC_API_KEY');
  }
});

Deno.test('uses the real extraction when Claude returns a tool_use block', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
  const extracted = {
    merchant_name: 'Big Bazaar',
    bill_date: '2026-07-01',
    total_amount: 499.5,
    currency: 'INR',
    category_guess: 'Dining & Grocery',
    line_items: [{ description: 'Milk', amount: 60 }],
    is_warranty_document: false,
    is_insurance_document: false,
    detected_expiry_date: null,
    confidence: 'high',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ content: [{ type: 'tool_use', name: 'extract_bill', input: extracted }] }),
        { status: 200 },
      ),
    )) as typeof fetch;
  try {
    const fileBlob = new Blob(['fake image bytes'], { type: 'image/jpeg' });
    const { client, updates } = fakeClient({
      bill: { id: 'bill-1', storage_path: 'user-1/bill-1.jpg' },
      fileBlob,
    });
    const handler = createHandler(() => client);
    const res = await handler(req({ billId: 'bill-1' }, { Authorization: 'Bearer token' }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.mode, 'claude');
    assertEquals(body.extracted.merchant_name, 'Big Bazaar');
    assertEquals(updates[0].merchant_name, 'Big Bazaar');
    assertEquals(updates[0].category, 'Dining & Grocery');
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete('ANTHROPIC_API_KEY');
  }
});

Deno.test('callClaude throws when Claude does not return a tool_use block', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ content: [] }), { status: 200 }))) as typeof fetch;
  try {
    await assertRejects(() => callClaude('test-key', 'image/jpeg', 'base64data'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('base64Encode round-trips through atob', () => {
  const bytes = new TextEncoder().encode('hello world');
  const encoded = base64Encode(bytes);
  assertEquals(atob(encoded), 'hello world');
});

Deno.test('guessMimeTypeFromPath maps known extensions', () => {
  assertEquals(guessMimeTypeFromPath('a/b.pdf'), 'application/pdf');
  assertEquals(guessMimeTypeFromPath('a/b.png'), 'image/png');
  assertEquals(guessMimeTypeFromPath('a/b.jpg'), 'image/jpeg');
  assertEquals(guessMimeTypeFromPath('a/b.heic'), 'image/jpeg');
});

Deno.test('contentBlockForFile builds a document block for PDFs and an image block otherwise', () => {
  assertEquals(contentBlockForFile('application/pdf', 'AAA'), {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'AAA' },
  });
  assertEquals(contentBlockForFile('image/png', 'BBB'), {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'BBB' },
  });
  // Unrecognized image mime types fall back to jpeg rather than passing
  // through an arbitrary string.
  assertEquals(contentBlockForFile('image/tiff', 'CCC'), {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'CCC' },
  });
});
