// Supabase Edge Function: whatsapp-webhook
//
// Third bill-intake path (prompt.md §2.3): a dedicated WhatsApp Business
// Cloud API number that users forward bills to. This function is the Meta
// webhook receiver. It requires Meta Business verification + a live Cloud
// API number to actually receive traffic — until then it's fully built and
// unit-testable with synthetic/mocked Meta payloads (see CLAUDE.md
// "External setup required"). Camera capture and the OS Share Extension
// work standalone and never depend on this being live.
//
// GET  — Meta's webhook verification handshake
//        (?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...).
// POST — inbound message payloads. For each image/document message:
//   1. Match the sender's phone number (`wa_id`, digits-only with country
//      code, e.g. "919876543210") to `profiles.phone_number` (E.164 with a
//      leading "+", e.g. "+919876543210" — see src/features/auth/phone.ts).
//   2. Unmatched sender: log + send a stub auto-reply, no bill created.
//   3. Matched sender: download the media via the Graph API, upload it to
//      the private 'bills' storage bucket at the same `${user_id}/${uuid}.ext`
//      path convention the client's offline queue uses, insert a bill row
//      (source='whatsapp_business', status='pending_review'), then trigger
//      `parse-bill` for it.
//
// Runs entirely with the service-role key — there is no end-user session on
// an inbound webhook call, so every query here intentionally bypasses RLS.
//
// Security: POST bodies are validated against Meta's X-Hub-Signature-256
// (HMAC-SHA256 of the raw body, keyed by the app secret) when
// WHATSAPP_APP_SECRET is configured. Locally, with no Meta app secret yet,
// verification is skipped (logged) rather than blocking development — the
// same mock/degrade pattern used elsewhere in this codebase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH_API_VERSION = 'v21.0';
// Overridable so this function's Graph API calls can be pointed at a local
// stand-in during tests — defaults to the real Meta endpoint in every real
// deployment (the env var is never set outside test runs).
const GRAPH_API_BASE =
  Deno.env.get('WHATSAPP_GRAPH_API_BASE') ?? `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
};

type WhatsAppMessage = {
  from: string;
  id: string;
  type: string;
  image?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string };
};

type WhatsAppWebhookPayload = {
  entry?: {
    changes?: {
      field: string;
      value?: {
        messages?: WhatsAppMessage[];
      };
    }[];
  }[];
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Verifies Meta's X-Hub-Signature-256 header. Returns true (and logs a
 * warning) when WHATSAPP_APP_SECRET isn't configured yet, so local
 * development isn't blocked on a credential that doesn't exist. */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) {
    console.warn(
      '[whatsapp-webhook] WHATSAPP_APP_SECRET not set — skipping signature verification',
    );
    return true;
  }
  if (!signatureHeader) return false;
  const [algo, providedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !providedHex) return false;
  const expectedHex = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualHex(expectedHex, providedHex);
}

export function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

/** Sends a WhatsApp text reply via the Graph API. No-ops (logged) when
 * credentials aren't configured yet — matches this codebase's mock/degrade
 * pattern for every not-yet-live external integration. */
async function sendWhatsAppReply(to: string, body: string): Promise<void> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!accessToken || !phoneNumberId) {
    console.log(`[whatsapp-webhook] (stub) would reply to ${to}: ${body}`);
    return;
  }
  try {
    const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!response.ok) {
      console.error(
        `[whatsapp-webhook] send reply failed: ${response.status} ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error('[whatsapp-webhook] send reply threw', error);
  }
}

/** Downloads media from the Graph API (two-step: resolve media id to a
 * short-lived URL, then fetch the bytes). Returns null (logged) if
 * credentials are absent or either call fails — a broken/incomplete
 * download must never crash the webhook or leave a half-created bill. */
async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!accessToken) {
    console.log(
      `[whatsapp-webhook] (mock mode) WHATSAPP_ACCESS_TOKEN not set — skipping media ${mediaId}`,
    );
    return null;
  }
  try {
    const metaResponse = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaResponse.ok) {
      console.error(`[whatsapp-webhook] media metadata fetch failed: ${metaResponse.status}`);
      return null;
    }
    const meta = await metaResponse.json();
    const fileResponse = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileResponse.ok) {
      console.error(`[whatsapp-webhook] media download failed: ${fileResponse.status}`);
      return null;
    }
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    return { bytes, mimeType: meta.mime_type ?? 'image/jpeg' };
  } catch (error) {
    console.error('[whatsapp-webhook] media download threw', error);
    return null;
  }
}

// Minimal shape of the supabase-js calls this function makes — narrow
// enough that `index.test.ts` can pass a hand-written fake instead of a
// real `SupabaseClient`, so the phone-matching/upload/insert logic is
// unit-testable without a live Supabase project.
export type WhatsAppSupabaseClient = {
  from(table: 'profiles'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
} & {
  from(table: 'bills'): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
} & {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: unknown }>;
    };
  };
};

export async function handleMessage(
  supabase: WhatsAppSupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  message: WhatsAppMessage,
): Promise<void> {
  const media = message.image ?? message.document;
  if (!media) {
    console.log(`[whatsapp-webhook] ignoring unsupported message type: ${message.type}`);
    return;
  }

  const senderPhone = `+${digitsOnly(message.from)}`;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_number', senderPhone)
    .maybeSingle();
  if (profileError) {
    console.error('[whatsapp-webhook] profile lookup failed', profileError);
    return;
  }

  if (!profile) {
    console.log(
      `[whatsapp-webhook] no account matches ${senderPhone} — sending registration prompt`,
    );
    await sendWhatsAppReply(
      message.from,
      "We couldn't match this number to a Bill Organizer account. Add this exact number in the app under Profile, then forward your bill again.",
    );
    return;
  }

  const downloaded = await downloadMedia(media.id);
  if (!downloaded) return;

  const id = crypto.randomUUID();
  const extension = extensionFromMimeType(downloaded.mimeType);
  const storagePath = `${profile.id}/${id}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('bills')
    .upload(storagePath, downloaded.bytes, { contentType: downloaded.mimeType, upsert: false });
  if (uploadError) {
    console.error('[whatsapp-webhook] storage upload failed', uploadError);
    return;
  }

  const { data: bill, error: insertError } = await supabase
    .from('bills')
    .insert({
      user_id: profile.id,
      source: 'whatsapp_business',
      storage_path: storagePath,
      status: 'pending_review',
    })
    .select('id')
    .single();
  if (insertError || !bill) {
    console.error('[whatsapp-webhook] bill insert failed', insertError);
    return;
  }

  await sendWhatsAppReply(
    message.from,
    'Got your bill — open Bill Organizer to review and confirm it.',
  );

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/parse-bill`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ billId: bill.id }),
    });
    if (!response.ok) {
      console.error(`[whatsapp-webhook] parse-bill invocation failed: ${response.status}`);
    }
  } catch (error) {
    // A parse failure must never block ingestion — the bill is already
    // saved and reviewable/fillable-by-hand in the app either way.
    console.error('[whatsapp-webhook] parse-bill invocation threw', error);
  }
}

function defaultGetClient(supabaseUrl: string, serviceRoleKey: string): WhatsAppSupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey) as unknown as WhatsAppSupabaseClient;
}

// Exported so `index.test.ts` can inject a fake client and mock `fetch`
// (Meta Graph API + parse-bill invocation) to exercise the full
// request/response cycle without a live Supabase project or real Meta
// credentials. `Deno.serve` is only invoked when this module is run
// directly (the Supabase edge runtime's entrypoint), not on import.
export function createHandler(
  getClient: (
    supabaseUrl: string,
    serviceRoleKey: string,
  ) => WhatsAppSupabaseClient = defaultGetClient,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      const expectedToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');

      if (mode === 'subscribe' && expectedToken && token === expectedToken && challenge) {
        return new Response(challenge, { status: 200, headers: corsHeaders });
      }
      return json({ error: 'Verification failed' }, 403);
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const rawBody = await req.text();
    const signatureValid = await verifyMetaSignature(
      rawBody,
      req.headers.get('x-hub-signature-256'),
    );
    if (!signatureValid) {
      return json({ error: 'Invalid signature' }, 401);
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = getClient(supabaseUrl, serviceRoleKey);

    const messages = (payload.entry ?? [])
      .flatMap((entry) => entry.changes ?? [])
      .filter((change) => change.field === 'messages')
      .flatMap((change) => change.value?.messages ?? []);

    for (const message of messages) {
      try {
        await handleMessage(supabase, supabaseUrl, serviceRoleKey, message);
      } catch (error) {
        // One bad message must never fail the whole batch — Meta expects a
        // fast 200 regardless, and will retry the whole payload otherwise.
        console.error('[whatsapp-webhook] error handling message', message.id, error);
      }
    }

    // Always 200 — Meta retries (and eventually disables) the webhook on
    // non-2xx responses, so partial/failed processing is logged, not surfaced.
    return json({ received: true });
  };
}

export const handler = createHandler();

if (import.meta.main) Deno.serve(handler);
