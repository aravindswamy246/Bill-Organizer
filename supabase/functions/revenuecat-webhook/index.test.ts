// Unit tests for the revenuecat-webhook edge function.
//
// Run with: supabase functions serve is NOT required — this uses Deno's
// built-in test runner directly against the exported handler:
//   deno test --allow-env supabase/functions/revenuecat-webhook/index.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import {
  createHandler,
  DOWNGRADING_EVENTS,
  ENTITLING_EVENTS,
  STORE_MAP,
  type ProfilesAndSubscriptionsClient,
} from './index.ts';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/revenuecat-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** A fake client that records every write instead of touching a database. */
function fakeClient() {
  const profileUpdates: { subscription_tier: string; id: string }[] = [];
  const subscriptionInserts: Record<string, unknown>[] = [];

  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === 'profiles') {
      return {
        update: (values: { subscription_tier: string }) => ({
          eq: async (_column: string, value: string) => {
            profileUpdates.push({ ...values, id: value });
            return { error: null };
          },
        }),
      };
    }
    return {
      insert: async (values: Record<string, unknown>) => {
        subscriptionInserts.push(values);
        return { error: null };
      },
    };
  };
  const client = { from } as unknown as ProfilesAndSubscriptionsClient;

  return { client, profileUpdates, subscriptionInserts };
}

Deno.test(
  'rejects with 401 when no Authorization header is sent and a secret is configured',
  async () => {
    Deno.env.set('REVENUECAT_WEBHOOK_SECRET', 'test-secret');
    try {
      const { client } = fakeClient();
      const handler = createHandler(() => client);
      const res = await handler(req({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'u1' } }));
      assertEquals(res.status, 401);
    } finally {
      Deno.env.delete('REVENUECAT_WEBHOOK_SECRET');
    }
  },
);

Deno.test('rejects with 401 when the wrong Authorization header is sent', async () => {
  Deno.env.set('REVENUECAT_WEBHOOK_SECRET', 'test-secret');
  try {
    const { client } = fakeClient();
    const handler = createHandler(() => client);
    const res = await handler(
      req(
        { event: { type: 'INITIAL_PURCHASE', app_user_id: 'u1' } },
        { authorization: 'wrong-secret' },
      ),
    );
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete('REVENUECAT_WEBHOOK_SECRET');
  }
});

Deno.test('accepts the correct Authorization header and flips the profile to premium', async () => {
  Deno.env.set('REVENUECAT_WEBHOOK_SECRET', 'test-secret');
  try {
    const { client, profileUpdates, subscriptionInserts } = fakeClient();
    const handler = createHandler(() => client);
    const res = await handler(
      req(
        {
          event: {
            type: 'INITIAL_PURCHASE',
            app_user_id: 'user-123',
            store: 'PLAY_STORE',
            purchased_at_ms: 1700000000000,
            expiration_at_ms: 1800000000000,
          },
        },
        { authorization: 'test-secret' },
      ),
    );
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json, { received: true, app_user_id: 'user-123', tier: 'premium' });
    assertEquals(profileUpdates, [{ subscription_tier: 'premium', id: 'user-123' }]);
    assertEquals(subscriptionInserts.length, 1);
    assertEquals(subscriptionInserts[0].tier, 'premium');
    assertEquals(subscriptionInserts[0].store, 'play_store');
  } finally {
    Deno.env.delete('REVENUECAT_WEBHOOK_SECRET');
  }
});

Deno.test('skips the auth check (with a warning) when no secret is configured', async () => {
  const { client } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(req({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1' } }));
  assertEquals(res.status, 200);
});

Deno.test('EXPIRATION event downgrades the profile to free', async () => {
  const { client, profileUpdates } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(req({ event: { type: 'EXPIRATION', app_user_id: 'user-9' } }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.tier, 'free');
  assertEquals(profileUpdates, [{ subscription_tier: 'free', id: 'user-9' }]);
});

Deno.test(
  'non-entitling event types (e.g. BILLING_ISSUE) are acknowledged without writing anything',
  async () => {
    const { client, profileUpdates, subscriptionInserts } = fakeClient();
    const handler = createHandler(() => client);
    const res = await handler(req({ event: { type: 'BILLING_ISSUE', app_user_id: 'user-5' } }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { received: true });
    assertEquals(profileUpdates, []);
    assertEquals(subscriptionInserts, []);
  },
);

Deno.test('rejects a request missing event.app_user_id or event.type', async () => {
  const { client } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(req({ event: { type: 'INITIAL_PURCHASE' } }));
  assertEquals(res.status, 400);
});

Deno.test('rejects invalid JSON bodies', async () => {
  const { client } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(
    new Request('http://localhost/revenuecat-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('rejects non-POST methods', async () => {
  const { client } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(new Request('http://localhost/revenuecat-webhook', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('answers CORS preflight requests', async () => {
  const { client } = fakeClient();
  const handler = createHandler(() => client);
  const res = await handler(
    new Request('http://localhost/revenuecat-webhook', { method: 'OPTIONS' }),
  );
  assertEquals(res.status, 200);
});

Deno.test('ENTITLING_EVENTS / DOWNGRADING_EVENTS / STORE_MAP classify events as expected', () => {
  assertEquals(ENTITLING_EVENTS.has('INITIAL_PURCHASE'), true);
  assertEquals(ENTITLING_EVENTS.has('RENEWAL'), true);
  assertEquals(ENTITLING_EVENTS.has('PRODUCT_CHANGE'), true);
  assertEquals(DOWNGRADING_EVENTS.has('EXPIRATION'), true);
  assertEquals(DOWNGRADING_EVENTS.has('CANCELLATION'), false);
  assertEquals(STORE_MAP.APP_STORE, 'app_store');
  assertEquals(STORE_MAP.MAC_APP_STORE, 'app_store');
  assertEquals(STORE_MAP.PLAY_STORE, 'play_store');
});
