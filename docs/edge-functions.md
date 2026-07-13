# Edge Functions

All four functions live under `supabase/functions/<name>/index.ts`, run on Deno, and follow the same shape for testability: the real logic lives in `export function createHandler(getClient = defaultGetClient) { return async (req) => {...} }`, `export const handler = createHandler()` is the real instance, and `if (import.meta.main) Deno.serve(handler)` means `Deno.serve` only runs when the file is the actual entrypoint — not when `index.test.ts` imports it. Every function injects a narrow hand-written client type (`BillsClient`, `WhatsAppSupabaseClient`, `RemindersClient`, `ProfilesAndSubscriptionsClient`) instead of the real `SupabaseClient`, so tests can pass a fake without a live Supabase project.

Local serving: `supabase functions serve` (all functions) or `supabase functions serve <name> --env-file supabase/.env.local` (one function with secrets). `supabase/config.toml` sets `verify_jwt = false` for `whatsapp-webhook` and `revenuecat-webhook` — both skip Supabase's gateway-level JWT check because they authenticate inbound requests with their own shared-secret schemes instead (Meta has no Supabase session; RevenueCat has no Supabase session either).

Every function shares the same CORS pattern (`Access-Control-Allow-Origin: *` + an explicit `Access-Control-Allow-Headers` list per function) and a `json(body, status)` helper wrapping `JSON.stringify` with `content-type: application/json`.

## `parse-bill`

Extracts structured data from an already-uploaded bill file using Claude's vision API. Called from the client (`src/features/bills/parseBill.ts`) after upload, and internally by `whatsapp-webhook` after it creates a bill row from an inbound WhatsApp message.

**Auth model**: runs with the *caller's own JWT*, not the service role. `defaultGetClient(authHeader)` creates a Supabase client with `Authorization: authHeader` forwarded, so every query is RLS-scoped — a user can only ever parse a bill they own. `whatsapp-webhook` calls it internally using the service-role key instead (see below).

**Request**: `POST { billId: string }`, requires an `Authorization` header (401 if missing).

**Flow**:
1. Look up `bills` row by id (`select('id, storage_path').eq('id', billId).single()`) — RLS means a non-owned id returns no row, not a permission error, so the response is `404 Bill not found` either way (no existence leak).
2. `400` if `storage_path` is null (nothing uploaded yet).
3. Download the file from the `bills` storage bucket, `500` on failure.
4. Base64-encode the bytes (`base64Encode`, chunked at 0x8000 to avoid `String.fromCharCode` argument-count blowups on large files).
5. If `ANTHROPIC_API_KEY` is set, call `callClaude()`; otherwise skip straight to `mockExtraction()`.
6. `callClaude(apiKey, mimeType, base64)` — `POST https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, `max_tokens: 1024`, a single forced tool call (`tool_choice: { type: 'tool', name: 'extract_bill' }`) against the `extract_bill` tool schema (merchant_name, bill_date, total_amount, currency, category_guess enum-matched to the 8 fixed categories, line_items array, is_warranty_document, is_insurance_document, detected_expiry_date, confidence `'high'|'medium'|'low'`). The image/PDF is sent as a `document` content block for `application/pdf` or an `image` block otherwise (`contentBlockForFile`). Throws if the HTTP call fails or Claude doesn't return a `tool_use` block.
7. If `callClaude` throws (missing/invalid key, transient API error, malformed response), the error is logged and `mockExtraction()` is used instead — **a parse failure never blocks the capture flow**. `mockExtraction()` returns all-null/empty fields, `currency: 'INR'`, `category_guess: 'Other'`, `confidence: 'low'`.
8. Writes `extracted_json: {...extracted, _mode}` plus the individual scalar fields (`merchant_name`, `bill_date`, `total_amount`, `currency` falling back to `'INR'`, `category`, `is_warranty_document`, `is_insurance_document`) back onto the `bills` row. Does **not** touch `status` — the client's confirm/edit screen is what flips `status` to `'confirmed'`.
9. Returns `{ billId, extracted, mode: 'claude' | 'mock' }`.

**Env vars**: `ANTHROPIC_API_KEY` (optional — mock mode without it), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (used to build the caller-scoped client).

## `whatsapp-webhook`

Meta WhatsApp Business Cloud API webhook receiver — the third bill-intake path alongside camera and OS share-sheet. Fully buildable/testable against synthetic Meta payloads before a real Meta Business/Cloud API number exists.

**Auth model**: runs entirely with the **service-role key** (`defaultGetClient(supabaseUrl, serviceRoleKey)`) — there is no end-user session on an inbound webhook call, so every query intentionally bypasses RLS. Correctness instead comes from explicitly matching the sender's phone number to a specific `profiles.id` before doing anything.

**GET — Meta verification handshake**: reads `hub.mode`, `hub.verify_token`, `hub.challenge` query params; if `mode === 'subscribe'` and `token` matches `WHATSAPP_VERIFY_TOKEN`, echoes back `challenge` as the raw response body (`200`); otherwise `403`.

**POST — inbound message payload**:
1. Reads the raw body as text first (needed for HMAC verification before JSON parsing).
2. `verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))` — computes `hmacSha256Hex(WHATSAPP_APP_SECRET, rawBody)` via Web Crypto (`crypto.subtle`) and compares to the header's `sha256=<hex>` value using `timingSafeEqualHex` (constant-time char-code XOR comparison, same pattern used by the other two webhook secrets). If `WHATSAPP_APP_SECRET` isn't set, verification is **skipped** (logged as a warning) rather than blocking — matches this codebase's mock/degrade pattern for not-yet-configured integrations. Invalid signature → `401`.
3. Parses the body as `WhatsAppWebhookPayload` (`400` on invalid JSON), flattens `entry[].changes[]` filtered to `field === 'messages'` down to a flat `WhatsAppMessage[]`.
4. For each message, calls `handleMessage()` inside its own try/catch so **one bad message never fails the whole batch** — errors are logged per-message.
5. `handleMessage(supabase, supabaseUrl, serviceRoleKey, message)`:
   - Only `message.image` or `message.document` are handled; anything else is logged and skipped.
   - Sender phone: Meta's `message.from` is digits-only with country code (e.g. `"919876543210"`); `digitsOnly()` strips non-digits and a leading `+` is prepended to match the E.164 format `profiles.phone_number` is stored in (see `src/features/auth/phone.ts` — bare 10-digit numbers get `+91` prepended at signup time, so a `+919876543210` profile value lines up with a `919876543210` WhatsApp `from`).
   - Looks up `profiles` by `phone_number` with `.maybeSingle()`. No match → logs it and sends a stub reply telling the sender to add that exact number under Profile in the app; **no bill is created**.
   - Match found → `downloadMedia(mediaId)`: two-step Graph API call (resolve media id → short-lived URL, then fetch bytes) using `WHATSAPP_ACCESS_TOKEN`. Returns `null` (logged) if the token is unset or either call fails — a broken download never crashes the webhook or leaves a half-created bill.
   - Uploads the downloaded bytes to the `bills` bucket at `${profile.id}/${uuid}.${ext}` (same path convention the client's offline queue uses — `extensionFromMimeType()` maps `application/pdf`→`pdf`, `image/png`→`png`, `image/heic`/`heif`→`heic`, else `jpg`).
   - Inserts a `bills` row: `user_id: profile.id`, `source: 'whatsapp_business'`, `storage_path`, `status: 'pending_review'` (merchant/amount/date/category all left null — filled in by the parse step next).
   - Sends a WhatsApp reply ("Got your bill — open Bill Organizer to review and confirm it.") via `sendWhatsAppReply()`, which no-ops (logged) if `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` aren't set.
   - Invokes `parse-bill` internally over HTTP (`POST ${SUPABASE_URL}/functions/v1/parse-bill` with `Authorization: Bearer ${serviceRoleKey}`) so the bill has extracted fields by the time the user opens the app to confirm it. Wrapped in try/catch — a parse-invocation failure is logged and never blocks ingestion, since the bill row + raw file are already saved either way.
6. Always returns `{ received: true }` with HTTP `200`, even if individual messages failed — **Meta retries, and eventually disables, a webhook that returns non-2xx**, so partial failures are logged, never surfaced as an error response.

**Env vars**: `WHATSAPP_VERIFY_TOKEN` (GET handshake), `WHATSAPP_APP_SECRET` (POST signature — optional, degrades to unverified), `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (media download + replies — optional, degrade to stubs/logs), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `WHATSAPP_GRAPH_API_BASE` is also readable (defaults to `https://graph.facebook.com/v21.0`) — exists purely so tests can point Graph API calls at a local stand-in; never set in real deployments.

## `send-reminders`

Cross-user sweep that flags reminders due for a 30/7/1-day-before-expiry push notification. A **secondary, redundant** channel — `expo-notifications` local scheduling (`src/lib/notifications.ts`) is the primary mechanism and already works with zero external accounts. This function exists so a reminder still fires even if a device missed its local notification (reinstall, cleared storage) once server push is wired up. Intended to run on a schedule (Supabase Cloud cron) once that infrastructure exists.

**Auth model**: runs with the service-role key (must scan every user's reminders, bypassing RLS by design). Guarded by a shared-secret header, `x-cron-secret`, checked against `CRON_SECRET` using `timingSafeEqualString` (constant-time comparison — added in the Phase 12 hardening pass so a mistimed 401 response can't leak the secret one character at a time). Skipped (no check) when `CRON_SECRET` is unset, for local testing.

**Flow**: for each of `OFFSETS = [{days:30,column:'notified_30d'}, {days:7,column:'notified_7d'}, {days:1,column:'notified_1d'}]`:
1. `thresholdIsoDate(offset.days)` computes today + N days as an ISO date (pure function, unit-tested independent of the system clock).
2. Queries `reminders` where `active = true`, `<column> = false`, `expiry_date` between today and the threshold date inclusive.
3. For each due reminder, calls `sendPushStub()` — logs what *would* be pushed via FCM; **never throws**, and doesn't actually send anything yet (FCM/device push tokens aren't wired up — see `CLAUDE.md`). Marking a reminder "notified" here means "this offset was processed," not "a push was delivered."
4. Flips the corresponding `notified_<N>d` column to `true`. A failed update is logged but doesn't stop the sweep.
5. Returns `{ processed: { notified_30d: n, notified_7d: n, notified_1d: n } }` — counts per offset.

**Env vars**: `CRON_SECRET` (optional — unguarded without it), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## `revenuecat-webhook`

Mirrors RevenueCat's entitlement state into `profiles.subscription_tier` and an audit trail in `subscriptions`. This function is the **only** writer of `subscription_tier` — `20260706100000_profiles_tier_column_grants.sql` revoked client-side `UPDATE` on that column specifically so a signed-in user can't self-upgrade with a direct `supabase.from('profiles').update(...)` call.

**Auth model**: runs with the service-role key. RevenueCat is configured to send a fixed value in its `Authorization` header on every webhook call; compared against `REVENUECAT_WEBHOOK_SECRET` via `timingSafeEqualString` (same constant-time-comparison fix applied in the Phase 12 hardening pass). Skipped (logged warning) when unset.

**Flow**:
1. `405` if not `POST`; `400` on invalid JSON or a missing `event.app_user_id`/`event.type`.
2. Classifies `event.type` into `ENTITLING_EVENTS` (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` → tier becomes `'premium'`) or `DOWNGRADING_EVENTS` (`EXPIRATION` → tier becomes `'free'`). Note: `CANCELLATION` is deliberately **not** in either set — it only means auto-renew was turned off, the user keeps premium until `expiration_at_ms`, and only the later `EXPIRATION` event actually ends access. Any other event type (`BILLING_ISSUE`, `TRANSFER`, etc.) is acknowledged (`{received:true}`) without writing anything.
3. `STORE_MAP` normalizes RevenueCat's store field (`APP_STORE`/`MAC_APP_STORE` → `'app_store'`, `PLAY_STORE` → `'play_store'`) to the `subscription_store` enum.
4. Updates `profiles.subscription_tier` for `event.app_user_id` (which is configured client-side, in `configurePurchases()`, to equal the Supabase auth user id — see `docs/architecture.md`). A failed update returns `500` with the DB error message.
5. Inserts an audit row into `subscriptions` (`user_id`, `tier`, `store`, `renewed_at`/`expires_at` from `purchased_at_ms`/`expiration_at_ms`). A failed insert here is logged but does **not** fail the whole webhook — the profile tier update is the part that actually matters for gating.
6. Returns `{ received: true, app_user_id, tier }`.

**Env vars**: `REVENUECAT_WEBHOOK_SECRET` (optional — unguarded without it), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Env var summary

| Function | Required for real behavior | Optional (degrades to mock/stub/skip if unset) |
|---|---|---|
| `parse-bill` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `ANTHROPIC_API_KEY` → mock extraction |
| `whatsapp-webhook` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_VERIFY_TOKEN` (GET handshake) | `WHATSAPP_APP_SECRET` → signature check skipped; `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` → media download & replies stubbed |
| `send-reminders` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `CRON_SECRET` → no auth check |
| `revenuecat-webhook` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `REVENUECAT_WEBHOOK_SECRET` → no auth check |

None of these edge-function secrets are in `.env.example` (which only covers client-side `EXPO_PUBLIC_*` vars) — they're set via `supabase secrets set` (cloud) or `--env-file` (local), and are documented in `CLAUDE.md` → "External setup required".
