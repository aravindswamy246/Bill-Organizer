# WhatsApp Business Cloud API intake

The third bill-intake path (alongside in-app camera/gallery/PDF and the OS share-sheet — see `docs/features/capture.md`): a dedicated WhatsApp Business number that a user forwards bills to directly from their own WhatsApp app. Full implementation detail (Meta verification handshake, signature validation, media download, storage upload) lives in `docs/edge-functions.md` → `whatsapp-webhook`; this doc covers the feature end-to-end from a product/user perspective and how it connects to the rest of the app.

## Why phone number matters here

Unlike every other identity concern in this app (auth is email/password, see `docs/features/auth.md`), **phone number is the identity key for this one path**. There is no WhatsApp login/OAuth — Meta's webhook payload only tells you the sender's raw phone number (`wa_id`). The only way to attribute an inbound bill to a Bill Organizer account is to match that phone number against `profiles.phone_number`, which is why onboarding requires collecting it (`/(auth)/onboarding`, `docs/features/auth.md`) even though sign-in itself never uses it.

Both sides of the match must agree on the same normalized shape (E.164, digits only after a leading `+`, no spaces/hyphens):
- Client-side: `normalizePhoneNumber()` (`src/features/auth/phone.ts`) — bare 10-digit input gets `+91` prepended.
- Webhook-side: `digitsOnly(message.from)` with a `+` prepended (`supabase/functions/whatsapp-webhook/index.ts`).

If a user's stored `phone_number` doesn't match this shape (e.g. they entered it with a different country code than the WhatsApp account they forward from), the webhook can't find them — see "Unmatched sender" below.

## Onboarding hint

`/(auth)/onboarding` displays the forward-to number, sourced from `EXPO_PUBLIC_WHATSAPP_INTAKE_NUMBER` (falls back to the literal `'Coming soon'` when unset — true until a real Meta Cloud API number exists, per `CLAUDE.md` → "External setup required"). This is purely informational copy; the actual webhook doesn't read this env var (it only needs `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET`/`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`, all edge-function-side secrets, not client env vars).

## What happens when a matched user forwards a bill

1. Meta delivers the image/document message to the `whatsapp-webhook` POST endpoint.
2. Sender's phone matches a `profiles` row → the media is downloaded via the Graph API and uploaded to the private `bills` storage bucket at `${user_id}/${uuid}.${ext}` — the same path convention (and same private bucket, same signed-URL-only access) as every other capture path.
3. A `bills` row is inserted directly (`source: 'whatsapp_business'`, `status: 'pending_review'`) — this bypasses the client-side offline queue entirely (there's no "offline" concept server-side; the webhook either succeeds now or Meta retries the whole delivery later).
4. `parse-bill` is invoked internally (service-role key) so the bill already has extracted fields by the time the user next opens the app.
5. A WhatsApp reply is sent: "Got your bill — open Bill Organizer to review and confirm it."
6. The bill shows up in the user's bill list exactly like any other `pending_review` bill — opening it goes through the same confirm/edit screen as any other intake path (`docs/features/bills.md`), since by this point it's indistinguishable from a camera/share-sheet capture except for its `source` value.

## Unmatched sender

If no `profiles.phone_number` matches the sender, **no bill is created** — the webhook logs it and replies with a message telling the sender to add that exact number under Profile in the app, then forward again. This is a deliberate security boundary: without this check, anyone could message the shared Cloud API number and have arbitrary content attributed to an arbitrary account (or, absent a match requirement, create bills for no one). There is no account-creation-via-WhatsApp flow — a Bill Organizer account (email/password signup) must already exist with the matching phone number saved.

## Current status

Fully built and unit-tested against synthetic Meta payloads (`supabase/functions/whatsapp-webhook/index.test.ts`), but **not yet live** — it requires Meta Business verification and a provisioned WhatsApp Business Cloud API number, neither of which exist yet (`CLAUDE.md` → "External setup required"). Camera capture and the OS share-sheet path work completely independently of this and need no external setup at all.
