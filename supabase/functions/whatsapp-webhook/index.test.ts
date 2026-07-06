// Unit tests for the whatsapp-webhook edge function.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/whatsapp-webhook/index.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import {
  createHandler,
  digitsOnly,
  extensionFromMimeType,
  handleMessage,
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyMetaSignature,
  type WhatsAppSupabaseClient,
} from './index.ts';

function fakeClient(opts: {
  profile?: { id: string } | null;
  profileError?: unknown;
  uploadError?: unknown;
  bill?: { id: string } | null;
  insertError?: unknown;
}) {
  const uploads: { path: string; contentType: string }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.profile ?? null,
                error: opts.profileError ?? null,
              }),
            }),
          }),
        };
      }
      return {
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          return {
            select: () => ({
              single: async () => ({
                data: opts.bill ?? { id: 'new-bill-id' },
                error: opts.insertError ?? null,
              }),
            }),
          };
        },
      };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: Uint8Array, options: { contentType: string }) => {
          uploads.push({ path, contentType: options.contentType });
          return { error: opts.uploadError ?? null };
        },
      }),
    },
    // deno-lint-ignore no-explicit-any
  } as any as WhatsAppSupabaseClient;
  return { client, uploads, inserts };
}

function metaGetReq(params: Record<string, string>): Request {
  const url = new URL('http://localhost/whatsapp-webhook');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, { method: 'GET' });
}

function metaPostReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/whatsapp-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// --- Pure helper tests -------------------------------------------------

Deno.test('digitsOnly strips everything but digits', () => {
  assertEquals(digitsOnly('+91 98765-43210'), '919876543210');
});

Deno.test('timingSafeEqualHex compares equal-length strings correctly', () => {
  assertEquals(timingSafeEqualHex('abcd', 'abcd'), true);
  assertEquals(timingSafeEqualHex('abcd', 'abce'), false);
  assertEquals(timingSafeEqualHex('abc', 'abcd'), false);
});

Deno.test('hmacSha256Hex produces the expected HMAC-SHA256 hex digest', async () => {
  // Known-answer test vector (HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")).
  const digest = await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
  assertEquals(digest, 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
});

Deno.test('extensionFromMimeType maps known types and defaults to jpg', () => {
  assertEquals(extensionFromMimeType('application/pdf'), 'pdf');
  assertEquals(extensionFromMimeType('image/png'), 'png');
  assertEquals(extensionFromMimeType('image/heic'), 'heic');
  assertEquals(extensionFromMimeType('image/heif'), 'heic');
  assertEquals(extensionFromMimeType('image/jpeg'), 'jpg');
  assertEquals(extensionFromMimeType('application/octet-stream'), 'jpg');
});

Deno.test('verifyMetaSignature skips verification (returns true) when WHATSAPP_APP_SECRET is unset', async () => {
  Deno.env.delete('WHATSAPP_APP_SECRET');
  const valid = await verifyMetaSignature('{"a":1}', null);
  assertEquals(valid, true);
});

Deno.test('verifyMetaSignature rejects a missing signature header when a secret is configured', async () => {
  Deno.env.set('WHATSAPP_APP_SECRET', 'app-secret');
  try {
    const valid = await verifyMetaSignature('{"a":1}', null);
    assertEquals(valid, false);
  } finally {
    Deno.env.delete('WHATSAPP_APP_SECRET');
  }
});

Deno.test('verifyMetaSignature accepts a correctly computed signature and rejects a tampered one', async () => {
  Deno.env.set('WHATSAPP_APP_SECRET', 'app-secret');
  try {
    const body = '{"entry":[]}';
    const correctHex = await hmacSha256Hex('app-secret', body);
    assertEquals(await verifyMetaSignature(body, `sha256=${correctHex}`), true);
    assertEquals(await verifyMetaSignature(body, `sha256=${'0'.repeat(64)}`), false);
    assertEquals(await verifyMetaSignature('{"entry":["tampered"]}', `sha256=${correctHex}`), false);
  } finally {
    Deno.env.delete('WHATSAPP_APP_SECRET');
  }
});

// --- GET verification handshake ----------------------------------------

Deno.test('GET verification handshake echoes the challenge when the verify token matches', async () => {
  Deno.env.set('WHATSAPP_VERIFY_TOKEN', 'my-verify-token');
  try {
    const { client } = fakeClient({});
    const handler = createHandler(() => client);
    const res = await handler(
      metaGetReq({ 'hub.mode': 'subscribe', 'hub.verify_token': 'my-verify-token', 'hub.challenge': 'xyz123' }),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'xyz123');
  } finally {
    Deno.env.delete('WHATSAPP_VERIFY_TOKEN');
  }
});

Deno.test('GET verification handshake rejects a wrong verify token', async () => {
  Deno.env.set('WHATSAPP_VERIFY_TOKEN', 'my-verify-token');
  try {
    const { client } = fakeClient({});
    const handler = createHandler(() => client);
    const res = await handler(
      metaGetReq({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'xyz123' }),
    );
    assertEquals(res.status, 403);
  } finally {
    Deno.env.delete('WHATSAPP_VERIFY_TOKEN');
  }
});

// --- POST signature guard (runs before any Supabase access) ------------

Deno.test('POST rejects an invalid X-Hub-Signature-256 without touching Supabase', async () => {
  Deno.env.set('WHATSAPP_APP_SECRET', 'app-secret');
  try {
    const { client } = fakeClient({});
    const handler = createHandler(() => client);
    const res = await handler(
      metaPostReq({ entry: [] }, { 'x-hub-signature-256': 'sha256=deadbeef' }),
    );
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete('WHATSAPP_APP_SECRET');
  }
});

Deno.test('POST always returns 200 to Meta even when a message fails to process', async () => {
  const { client } = fakeClient({ profileError: { message: 'boom' } });
  const handler = createHandler(() => client);
  const payload = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messages: [{ from: '919876543210', id: 'wamid.1', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
            },
          },
        ],
      },
    ],
  };
  const res = await handler(metaPostReq(payload));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { received: true });
});

// --- handleMessage: phone-matching, upload, insert ----------------------

Deno.test('handleMessage ignores unsupported message types (e.g. text)', async () => {
  const { client, inserts } = fakeClient({});
  await handleMessage(client, 'http://localhost', 'service-role-key', {
    from: '919876543210',
    id: 'wamid.1',
    type: 'text',
  });
  assertEquals(inserts, []);
});

Deno.test('handleMessage does not create a bill when no profile matches the sender phone number', async () => {
  const { client, inserts } = fakeClient({ profile: null });
  await handleMessage(client, 'http://localhost', 'service-role-key', {
    from: '919876543210',
    id: 'wamid.1',
    type: 'image',
    image: { id: 'media-1', mime_type: 'image/jpeg' },
  });
  assertEquals(inserts, []);
});

Deno.test('handleMessage matches the sender phone as E.164 (+ and digits only)', async () => {
  // downloadMedia returns null when WHATSAPP_ACCESS_TOKEN is unset (mock
  // mode), so this test only needs to verify the profile lookup shape —
  // the bill insert is skipped after a null download, by design (never a
  // half-created bill).
  Deno.env.delete('WHATSAPP_ACCESS_TOKEN');
  let lookedUpPhone: string | undefined;
  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_column: string, value: string) => {
              lookedUpPhone = value;
              return { maybeSingle: async () => ({ data: { id: 'user-1' }, error: null }) };
            },
          }),
        };
      }
      return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) };
      // deno-lint-ignore no-explicit-any
    },
  } as any as WhatsAppSupabaseClient;

  await handleMessage(client, 'http://localhost', 'service-role-key', {
    from: '91 98765-43210',
    id: 'wamid.1',
    type: 'image',
    image: { id: 'media-1', mime_type: 'image/jpeg' },
  });
  assertEquals(lookedUpPhone, '+919876543210');
});
