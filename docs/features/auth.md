# Auth & onboarding

## Auth model

Email/password via Supabase Auth — **not** phone OTP, despite `prompt.md`'s original spec (see `CLAUDE.md` → "Key product decisions"). Phone number is still collected, but only as a profile field used to match inbound WhatsApp messages to an account (`docs/edge-functions.md` → `whatsapp-webhook`).

## `AuthProvider` (`src/features/auth/AuthProvider.tsx`)

Wraps the app in a React context exposing:

```ts
{
  session: Session | null | undefined;  // undefined = still hydrating from secure storage
  profile: Profile | null;
  profileLoading: boolean;
  onboardingComplete: boolean;          // Boolean(profile?.name && profile?.phone_number)
  signUp(email, password): Promise<void>;
  signIn(email, password): Promise<void>;
  signOut(): Promise<void>;
  completeOnboarding(name, phoneNumber): Promise<void>;
  refreshProfile(): Promise<void>;
}
```

- On mount, calls `supabase.auth.getSession()` to hydrate `session` from secure storage (see `src/lib/supabase.ts`'s `largeSecureStore` in `docs/architecture.md`), then subscribes to `supabase.auth.onAuthStateChange` for the lifetime of the provider.
- Whenever a non-null session appears (initial hydration or a later sign-in), `fetchProfile(userId)` runs: `select('*').eq('id', userId).single()` against `profiles`, setting `profileLoading` around the call. A failed fetch logs the error and sets `profile: null` rather than throwing — the route guard in `src/app/_layout.tsx` treats a null/incomplete profile the same as "needs onboarding."
- `signUp`/`signIn` are thin wraps over `supabase.auth.signUp` / `signInWithPassword` that rethrow on error (there's no separate confirmation-code screen — Supabase's own email confirmation link is used, see below).
- `completeOnboarding(name, phoneNumber)` requires an existing session, does `update({ name, phone_number: phoneNumber }).eq('id', session.user.id).select().single()`, and sets local `profile` state directly from the response (no extra round-trip fetch).
- A `profiles` row always exists before any of this runs — the `handle_new_user` trigger (`docs/database.md`) inserts a bare row (`id` only) the moment `auth.users` gets the new row from `signUp`.

## Route guarding (see `docs/architecture.md` for the full 4-step redirect logic)

`onboardingComplete` is the single signal `src/app/_layout.tsx` uses to decide whether a signed-in user lands on `/(auth)/onboarding` or `/(app)`. It's `false` until **both** `name` and `phone_number` are non-null — a fresh signup always starts in that state since `handle_new_user` only sets `id`.

## Screens

### `/(auth)/signup` (`src/app/(auth)/signup.tsx`)

- Client-side validation only: password length ≥ 8, password === confirmPassword. No character-class requirements (per `vibesec` password guidance — length over complexity rules).
- On success, does not sign the user in immediately — Supabase Auth requires email confirmation by default, so the screen swaps to a "Check your email" state with a link back to `/(auth)/login`. The email itself is sent by Supabase Auth, not app code.

### `/(auth)/login` (`src/app/(auth)/login.tsx`)

- Email/password form calling `signIn`. On success, `AuthProvider`'s `onAuthStateChange` listener picks up the new session and the root layout's redirect logic takes over from there.

### `/(auth)/onboarding` (`src/app/(auth)/onboarding.tsx`)

- Only reachable once signed in and while `onboardingComplete` is still false (route guard).
- Collects **name** and **phone number**. Phone input accepts a bare 10-digit local number or a full `+<countrycode>` number; `normalizePhoneNumber()` (see below) rejects anything else with an inline error ("Enter a valid phone number, e.g. 9876543210 or +919876543210").
- Also displays the WhatsApp forward-number hint, sourced from `process.env.EXPO_PUBLIC_WHATSAPP_INTAKE_NUMBER` (falls back to the literal string `'Coming soon'` when unset, since the WhatsApp Business number doesn't exist until Meta verification is complete — see `CLAUDE.md` → "External setup required").
- Submits via `completeOnboarding(name.trim(), normalizedPhone)`.

## Phone normalization (`src/features/auth/phone.ts`)

```ts
export function normalizePhoneNumber(input: string): string | null
```

Minimal E.164 handling for the India-first v1:
1. Trims whitespace and strips internal spaces/hyphens.
2. If already `+<1-9 digit country code><7-14 more digits>` (regex `^\+[1-9]\d{7,14}$`), returned as-is.
3. If exactly 10 bare digits (regex `^\d{10}$`), prepends `+91` (India default).
4. Anything else (too short, too long, non-numeric, missing country code with wrong digit count) returns `null`, which the onboarding screen surfaces as a validation error.

This is the **only** place phone numbers are normalized client-side; `whatsapp-webhook` independently derives the same E.164 shape from Meta's `wa_id` format via `digitsOnly()` + a prepended `+` (see `docs/edge-functions.md`), so the two paths must stay in sync for phone-matching to work — both ultimately produce `+<countrycode><number>` with no separators.

## Session persistence

Handled entirely by `src/lib/supabase.ts`'s custom storage adapter (`largeSecureStore`), not by this feature — see `docs/architecture.md` for the AES-256-CTR / expo-secure-store / AsyncStorage split (worked around Android SecureStore's ~4KB per-key limit, since Supabase session blobs can exceed that).
