// Unit tests for the send-reminders edge function.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/send-reminders/index.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { createHandler, thresholdIsoDate, todayIsoDate, type RemindersClient } from './index.ts';

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/send-reminders', { method: 'POST', headers });
}

function fakeClient(due: { id: string; user_id: string; expiry_date: string }[]) {
  const flagged: { id: string; column: string }[] = [];
  const client: RemindersClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              lte: async () => ({ data: due, error: null }),
            }),
          }),
        }),
      }),
      update: (values: Record<string, boolean>) => ({
        eq: async (_column: string, id: string) => {
          const column = Object.keys(values)[0];
          flagged.push({ id, column });
          return { error: null };
        },
      }),
    }),
  };
  return { client, flagged };
}

Deno.test('rejects with 401 when the wrong x-cron-secret is sent and a secret is configured', async () => {
  Deno.env.set('CRON_SECRET', 'test-cron-secret');
  try {
    const { client } = fakeClient([]);
    const handler = createHandler(() => client);
    const res = await handler(req({ 'x-cron-secret': 'wrong' }));
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete('CRON_SECRET');
  }
});

Deno.test('accepts the correct x-cron-secret', async () => {
  Deno.env.set('CRON_SECRET', 'test-cron-secret');
  try {
    const { client } = fakeClient([]);
    const handler = createHandler(() => client);
    const res = await handler(req({ 'x-cron-secret': 'test-cron-secret' }));
    assertEquals(res.status, 200);
  } finally {
    Deno.env.delete('CRON_SECRET');
  }
});

Deno.test('skips the cron-secret check when none is configured', async () => {
  const { client } = fakeClient([]);
  const handler = createHandler(() => client);
  const res = await handler(req());
  assertEquals(res.status, 200);
});

Deno.test('flags each due reminder under its offset column and reports counts per offset', async () => {
  const due = [{ id: 'r1', user_id: 'u1', expiry_date: '2026-08-05' }];
  const { client, flagged } = fakeClient(due);
  const handler = createHandler(() => client);
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  // Every offset re-uses the same fake `due` list in this test, so each of
  // the 3 offsets (30d/7d/1d) sees 1 due reminder and flags it once.
  assertEquals(body.processed, { notified_30d: 1, notified_7d: 1, notified_1d: 1 });
  assertEquals(flagged.length, 3);
  assertEquals(
    flagged.map((f) => f.column).sort(),
    ['notified_1d', 'notified_30d', 'notified_7d'],
  );
});

Deno.test('reports zero counts when nothing is due', async () => {
  const { client } = fakeClient([]);
  const handler = createHandler(() => client);
  const res = await handler(req());
  const body = await res.json();
  assertEquals(body.processed, { notified_30d: 0, notified_7d: 0, notified_1d: 0 });
});

Deno.test('answers CORS preflight requests', async () => {
  const { client } = fakeClient([]);
  const handler = createHandler(() => client);
  const res = await handler(new Request('http://localhost/send-reminders', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
});

Deno.test('todayIsoDate formats a given date as YYYY-MM-DD (UTC)', () => {
  assertEquals(todayIsoDate(new Date('2026-07-06T15:30:00Z')), '2026-07-06');
});

Deno.test('thresholdIsoDate adds the offset in days', () => {
  const now = new Date('2026-07-06T00:00:00Z');
  assertEquals(thresholdIsoDate(30, now), '2026-08-05');
  assertEquals(thresholdIsoDate(7, now), '2026-07-13');
  assertEquals(thresholdIsoDate(1, now), '2026-07-07');
  assertEquals(thresholdIsoDate(0, now), '2026-07-06');
});
