// Supabase Edge Function: revenuecat-webhook
//
// Receives RevenueCat's server webhook (prompt.md §4: "do not build custom
// billing/entitlement logic" — RevenueCat wraps App Store/Play Store
// subscriptions and is the source of truth for entitlement state; this
// function only mirrors that state into our own tables). RevenueCat's app
// user id must be configured client-side to equal the Supabase auth user id
// (see src/lib/purchases.ts `configurePurchases`), so `event.app_user_id`
// here maps directly to `profiles.id`.
//
// Runs with the service-role key — there is no end-user session on an
// inbound webhook call. This is also the ONLY writer of
// `profiles.subscription_tier`: 20260706100000_profiles_tier_column_grants
// revoked client UPDATE on that column specifically so a signed-in user
// can't bypass the paywall with a direct table update.
//
// Auth: RevenueCat lets you configure a fixed "Authorization header" value
// that it sends with every webhook call — compared against
// REVENUECAT_WEBHOOK_SECRET here. Skipped (logged) when unset, matching the
// mock/degrade pattern used by every other not-yet-configured integration
// in this codebase (parse-bill's ANTHROPIC_API_KEY, whatsapp-webhook's
// WHATSAPP_APP_SECRET).
//
// Reference: https://www.revenuecat.com/docs/integrations/webhooks
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// Event types that grant/renew premium access. PRODUCT_CHANGE covers a
// user switching between monthly/annual premium plans (still premium).
export const ENTITLING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

// CANCELLATION only means auto-renew was turned off — the user keeps
// premium until `expiration_at_ms`. Only EXPIRATION actually ends access.
export const DOWNGRADING_EVENTS = new Set(['EXPIRATION']);

export const STORE_MAP: Record<string, 'app_store' | 'play_store'> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
};

export type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  store?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
};

// Minimal shape of the supabase-js calls this function makes — narrow
// enough that `index.test.ts` can pass a hand-written fake instead of a
// real `SupabaseClient`, so the update/insert logic (including the tier
// classification) is unit-testable without a live database.
export type ProfilesAndSubscriptionsClient = {
  from(table: 'profiles'): {
    update(values: { subscription_tier: string }): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
    };
  };
} & {
  from(table: 'subscriptions'): {
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
};

function defaultGetClient(): ProfilesAndSubscriptionsClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  ) as unknown as ProfilesAndSubscriptionsClient;
}

// Exported so `index.test.ts` can inject a fake client and exercise the
// full request/response cycle without a live Supabase instance. `Deno.serve`
// is only invoked when this module is run directly (the Supabase edge
// runtime's entrypoint), not on import.
export function createHandler(getClient: () => ProfilesAndSubscriptionsClient = defaultGetClient) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
    if (webhookSecret) {
      const provided = req.headers.get('authorization');
      if (!provided || !timingSafeEqualString(provided, webhookSecret)) {
        return json({ error: 'Unauthorized' }, 401);
      }
    } else {
      console.warn('[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET not set — skipping auth check');
    }

    let body: { event?: RevenueCatEvent };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const event = body.event;
    if (!event?.app_user_id || !event.type) {
      return json({ error: 'Missing event.app_user_id or event.type' }, 400);
    }

    if (!ENTITLING_EVENTS.has(event.type) && !DOWNGRADING_EVENTS.has(event.type)) {
      // Other event types (BILLING_ISSUE, TRANSFER, etc.) don't change tier —
      // acknowledge without writing anything.
      console.log(`[revenuecat-webhook] ignoring event type: ${event.type}`);
      return json({ received: true });
    }

    const supabase = getClient();

    const tier = ENTITLING_EVENTS.has(event.type) ? 'premium' : 'free';
    const store = event.store ? (STORE_MAP[event.store] ?? null) : null;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ subscription_tier: tier })
      .eq('id', event.app_user_id);
    if (updateError) {
      console.error('[revenuecat-webhook] failed to update profile tier', updateError);
      return json({ error: updateError.message }, 500);
    }

    const { error: insertError } = await supabase.from('subscriptions').insert({
      user_id: event.app_user_id,
      tier,
      store,
      renewed_at: event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : null,
      expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    });
    if (insertError) {
      // The profile tier is already updated (the part that matters for
      // gating) — a failed audit-log insert shouldn't fail the whole webhook.
      console.error('[revenuecat-webhook] failed to insert subscriptions row', insertError);
    }

    return json({ received: true, app_user_id: event.app_user_id, tier });
  };
}

export const handler = createHandler();

if (import.meta.main) Deno.serve(handler);
