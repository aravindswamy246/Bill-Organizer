// Unit tests for the Sarvam vision provider.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/parse-bill/providers/sarvam.test.ts
//
// No test here makes a real network call — `fetch` is stubbed per-test,
// mirroring the pattern in ../index.test.ts. Every test that stubs fetch
// or sets an env var restores/cleans it up in a `finally` block.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  extractFieldsFromText,
  extractOcrText,
  normaliseExtractedBill,
  ocrDocument,
  sarvamProvider,
} from './sarvam.ts';
import { EXTRACT_BILL_NAME, mockExtraction, type ExtractedBill } from './types.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const VALID_EXTRACTED: ExtractedBill = {
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

function toolCallResponse(args: string) {
  return jsonResponse({
    choices: [
      {
        message: {
          tool_calls: [{ function: { name: EXTRACT_BILL_NAME, arguments: args } }],
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------
// isConfigured
// ---------------------------------------------------------------------

Deno.test('isConfigured is false with no SARVAM_API_KEY and true once one is set', () => {
  Deno.env.delete('SARVAM_API_KEY');
  try {
    assertEquals(sarvamProvider.isConfigured(), false);
    Deno.env.set('SARVAM_API_KEY', 'test-key');
    assertEquals(sarvamProvider.isConfigured(), true);
  } finally {
    Deno.env.delete('SARVAM_API_KEY');
  }
});

// ---------------------------------------------------------------------
// ocrDocument — submit / poll / results
// ---------------------------------------------------------------------

Deno.test('ocrDocument submits, polls through a running state, and returns the OCR text', async () => {
  let statusCalls = 0;
  const restore = stubFetch((url) => {
    if (url.includes('/results')) {
      return jsonResponse({ markdown: '# Big Bazaar\nTotal: 499.50' });
    }
    if (url.includes('/status')) {
      statusCalls++;
      return jsonResponse({ status: statusCalls === 1 ? 'running' : 'completed' });
    }
    return jsonResponse({ job_id: 'job-1', status: 'pending' });
  });
  try {
    const text = await ocrDocument('test-key', 'image/jpeg', 'AAA', { maxAttempts: 5, delayMs: 1 });
    assertEquals(text, '# Big Bazaar\nTotal: 499.50');
    assertEquals(statusCalls, 2);
  } finally {
    restore();
  }
});

Deno.test('ocrDocument throws a descriptive timeout error when it never leaves a running state', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('/status')) return jsonResponse({ status: 'running' });
    return jsonResponse({ job_id: 'job-1', status: 'pending' });
  });
  try {
    await assertRejects(
      () => ocrDocument('test-key', 'image/jpeg', 'AAA', { maxAttempts: 3, delayMs: 1 }),
      Error,
      'did not complete within 3 polls',
    );
  } finally {
    restore();
  }
});

Deno.test('ocrDocument throws with the HTTP status when the submit call is not ok', async () => {
  const restore = stubFetch(() => new Response('bad request', { status: 400 }));
  try {
    await assertRejects(
      () => ocrDocument('test-key', 'image/jpeg', 'AAA', { maxAttempts: 1, delayMs: 1 }),
      Error,
      '400',
    );
  } finally {
    restore();
  }
});

Deno.test('ocrDocument throws with the HTTP status when a status poll is not ok', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('/status')) return new Response('server error', { status: 500 });
    return jsonResponse({ job_id: 'job-1', status: 'pending' });
  });
  try {
    await assertRejects(
      () => ocrDocument('test-key', 'image/jpeg', 'AAA', { maxAttempts: 3, delayMs: 1 }),
      Error,
      '500',
    );
  } finally {
    restore();
  }
});

Deno.test('ocrDocument throws when the job reaches a failed state', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('/status')) return jsonResponse({ status: 'failed' });
    return jsonResponse({ job_id: 'job-1', status: 'pending' });
  });
  try {
    await assertRejects(
      () => ocrDocument('test-key', 'image/jpeg', 'AAA', { maxAttempts: 3, delayMs: 1 }),
      Error,
      'failed',
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------
// extractOcrText
// ---------------------------------------------------------------------

Deno.test('extractOcrText reads markdown/html/text fields, nested result, and page arrays', () => {
  assertEquals(extractOcrText({ markdown: 'hi' }), 'hi');
  assertEquals(extractOcrText({ result: { html: '<p>hi</p>' } }), '<p>hi</p>');
  assertEquals(
    extractOcrText({ pages: [{ text: 'page one' }, { text: 'page two' }] }),
    'page one\n\npage two',
  );
});

Deno.test('extractOcrText throws on a response with no recognisable text field', () => {
  let threw = false;
  try {
    extractOcrText({ unexpected: true });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ---------------------------------------------------------------------
// extractFieldsFromText
// ---------------------------------------------------------------------

Deno.test('extractFieldsFromText returns a well-formed ExtractedBill from a stubbed tool call', async () => {
  const restore = stubFetch(() => toolCallResponse(JSON.stringify(VALID_EXTRACTED)));
  try {
    const result = await extractFieldsFromText('test-key', 'ocr text');
    assertEquals(result, VALID_EXTRACTED);
  } finally {
    restore();
  }
});

Deno.test('extractFieldsFromText throws when the response has no tool call', async () => {
  const restore = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'no tool call' } }] }));
  try {
    await assertRejects(() => extractFieldsFromText('test-key', 'ocr text'));
  } finally {
    restore();
  }
});

Deno.test('extractFieldsFromText throws when the tool call arguments are not valid JSON', async () => {
  const restore = stubFetch(() => toolCallResponse('{not valid json'));
  try {
    await assertRejects(() => extractFieldsFromText('test-key', 'ocr text'));
  } finally {
    restore();
  }
});

Deno.test('extractFieldsFromText throws with the HTTP status on a non-ok response', async () => {
  const restore = stubFetch(() => new Response('rate limited', { status: 429 }));
  try {
    await assertRejects(() => extractFieldsFromText('test-key', 'ocr text'), Error, '429');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------
// normaliseExtractedBill
// ---------------------------------------------------------------------

Deno.test('normaliseExtractedBill falls back an unknown category_guess to Other', () => {
  const result = normaliseExtractedBill({ ...VALID_EXTRACTED, category_guess: 'Not A Real Category' });
  assertEquals(result.category_guess, 'Other');
});

Deno.test('normaliseExtractedBill defaults missing line_items to []', () => {
  const { line_items: _omit, ...withoutLineItems } = VALID_EXTRACTED;
  const result = normaliseExtractedBill(withoutLineItems);
  assertEquals(result.line_items, []);
});

Deno.test('normaliseExtractedBill defaults a non-array line_items to []', () => {
  const result = normaliseExtractedBill({ ...VALID_EXTRACTED, line_items: 'not an array' });
  assertEquals(result.line_items, []);
});

Deno.test('normaliseExtractedBill throws on a non-object result', () => {
  let threw = false;
  try {
    normaliseExtractedBill('just a string');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('normaliseExtractedBill fills in safe defaults for a sparse/malformed object', () => {
  const result = normaliseExtractedBill({});
  assertEquals(result, mockExtraction());
});

// ---------------------------------------------------------------------
// sarvamProvider.extract — end to end, both legs stubbed
// ---------------------------------------------------------------------

Deno.test('extract() runs OCR then chat extraction end-to-end', async () => {
  Deno.env.set('SARVAM_API_KEY', 'test-key');
  const restore = stubFetch((url) => {
    if (url.includes('/status')) return jsonResponse({ status: 'completed' });
    if (url.includes('/results')) return jsonResponse({ markdown: 'OCR TEXT HERE' });
    if (url.includes('/chat/completions')) return toolCallResponse(JSON.stringify(VALID_EXTRACTED));
    return jsonResponse({ job_id: 'job-1', status: 'pending' });
  });
  try {
    const result = await sarvamProvider.extract('image/jpeg', 'AAA');
    assertEquals(result, VALID_EXTRACTED);
  } finally {
    restore();
    Deno.env.delete('SARVAM_API_KEY');
  }
});

Deno.test('extract() propagates a descriptive error when the OCR leg fails, without swallowing it', async () => {
  Deno.env.set('SARVAM_API_KEY', 'test-key');
  const restore = stubFetch(() => new Response('bad request', { status: 400 }));
  try {
    await assertRejects(() => sarvamProvider.extract('image/jpeg', 'AAA'), Error, '400');
  } finally {
    restore();
    Deno.env.delete('SARVAM_API_KEY');
  }
});
