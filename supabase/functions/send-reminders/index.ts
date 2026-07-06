// Supabase Edge Function: send-reminders
//
// Server-side, cross-user sweep for warranty/insurance reminders that are
// due for a 30/7/1-day-before-expiry push notification. This is a
// *secondary, redundant* channel — `expo-notifications` local scheduling
// (src/lib/notifications.ts) is the primary mechanism and already works
// with zero external accounts. This function exists so reminders still
// fire even if a device missed its locally-scheduled notification (e.g.
// reinstalled the app, cleared local storage) once server push is wired up.
//
// Intended to be invoked on a schedule (Supabase Cloud cron, once that
// exists — see CLAUDE.md "External setup required"). Runs with the
// service-role key since it must scan reminders across every user, bypassing
// RLS by design. Guarded by a shared-secret header so it can't be triggered
// by arbitrary callers once deployed; the check is skipped locally when no
// secret is configured, matching the mock/degrade pattern used by
// `parse-bill` for ANTHROPIC_API_KEY.
//
// FCM push itself is stubbed (logged, not sent) until a Firebase project
// and device push-token storage exist — see CLAUDE.md. Marking a reminder
// "notified" here only means "this offset was processed", not "a push was
// delivered".
import { createClient } from 'npm:@supabase/supabase-js@2';

export const OFFSETS = [
  { days: 30, column: 'notified_30d' },
  { days: 7, column: 'notified_7d' },
  { days: 1, column: 'notified_1d' },
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// Constant-time comparison so a mistimed response can't leak the configured
// secret one character at a time (mirrors whatsapp-webhook's timingSafeEqualHex).
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Stub: logs what would be pushed via FCM. Replace with a real
 * `@react-native-firebase/messaging` server send once device push tokens
 * are collected and a Firebase project exists. Never throws — a failed
 * push must not stop the rest of the sweep. */
export async function sendPushStub(
  reminder: {
    id: string;
    user_id: string;
    expiry_date: string;
  },
  offsetDays: number,
): Promise<void> {
  console.log(
    `[send-reminders] (stub) would push to user ${reminder.user_id}: reminder ${reminder.id} expires ${reminder.expiry_date} (${offsetDays}d out)`,
  );
  await Promise.resolve();
}

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The inclusive expiry_date upper bound for a given "N days before expiry"
 * offset, relative to `now`. Exported so its date arithmetic is
 * unit-testable independent of the actual system clock. */
export function thresholdIsoDate(offsetDays: number, now: Date = new Date()): string {
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + offsetDays);
  return threshold.toISOString().slice(0, 10);
}

// Minimal shape of the supabase-js calls this function makes — narrow
// enough that `index.test.ts` can pass a hand-written fake instead of a
// real `SupabaseClient`, so the sweep/flagging logic is unit-testable
// without a live Supabase project.
export type RemindersClient = {
  from(table: 'reminders'): {
    select(columns: string): {
      eq(
        column: string,
        value: boolean,
      ): {
        eq(
          column: string,
          value: boolean,
        ): {
          gte(
            column: string,
            value: string,
          ): {
            lte(
              column: string,
              value: string,
            ): Promise<{
              data: { id: string; user_id: string; expiry_date: string }[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
    update(values: Record<string, boolean>): {
      eq(column: string, value: string): Promise<{ error: unknown }>;
    };
  };
};

function defaultGetClient(): RemindersClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  ) as unknown as RemindersClient;
}

// Exported so `index.test.ts` can inject a fake client to exercise the full
// sweep without a live Supabase project. `Deno.serve` is only invoked when
// this module is run directly (the Supabase edge runtime's entrypoint /
// cron trigger), not on import.
export function createHandler(getClient: () => RemindersClient = defaultGetClient) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const cronSecret = Deno.env.get('CRON_SECRET');
    if (cronSecret) {
      const provided = req.headers.get('x-cron-secret');
      if (!provided || !timingSafeEqualString(provided, cronSecret)) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      const supabase = getClient();

      const today = todayIsoDate();
      const results: Record<string, number> = {};

      for (const offset of OFFSETS) {
        const thresholdDate = thresholdIsoDate(offset.days);

        const { data: due, error } = await supabase
          .from('reminders')
          .select('id, user_id, expiry_date')
          .eq('active', true)
          .eq(offset.column, false)
          .gte('expiry_date', today)
          .lte('expiry_date', thresholdDate);
        if (error) throw error;

        for (const reminder of due ?? []) {
          await sendPushStub(reminder, offset.days);
          const { error: updateError } = await supabase
            .from('reminders')
            .update({ [offset.column]: true })
            .eq('id', reminder.id);
          if (updateError) {
            console.error(`[send-reminders] failed to flag reminder ${reminder.id}`, updateError);
          }
        }
        results[offset.column] = (due ?? []).length;
      }

      return json({ processed: results });
    } catch (error) {
      console.error('send-reminders error', error);
      return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
  };
}

export const handler = createHandler();

if (import.meta.main) Deno.serve(handler);
