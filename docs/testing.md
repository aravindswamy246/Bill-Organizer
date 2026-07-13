# Testing

Two separate, independent test setups: **Jest** for everything under `src/` (client app), **Deno's built-in test runner** for everything under `supabase/functions/` (edge functions, which run on Deno, not Node — they can't share a test runner with the client).

## Client tests (Jest + jest-expo)

- Run: `npm test` (aliases to `jest`) or `npx jest`.
- Config lives in `package.json`'s `"jest"` block: `preset: "jest-expo"` (handles the React Native/Expo module transforms), `moduleNameMapper` maps the `@/` import alias to `<rootDir>/src/`, and `testPathIgnorePatterns` explicitly excludes `/supabase/functions/` so Jest never tries to run the Deno-flavored edge function tests (which use `jsr:` imports and `Deno.test`, meaningless to Jest).
- Test files live next to the code they test (`*.test.ts` siblings), not in a separate `__tests__` tree — e.g. `src/features/auth/phone.test.ts`, `src/lib/env.test.ts`, `src/lib/notifications.test.ts`, `src/lib/purchases.test.ts`, and `src/features/capture/offlineQueue.test.ts` / `src/features/export/exportBills.test.ts` for the more complex logic.
- Typecheck (`npx tsc --noEmit`) and lint (`npm run lint`, `expo lint`) are separate commands, not part of `npm test`.

### The `resetModules()` re-require pattern (`offlineQueue.test.ts`)

`src/features/capture/offlineQueue.ts` keeps its queue in **module-scope singleton state** (`let queue: QueuedCapture[] = []`), and its dependencies (`AsyncStorage`, `NetInfo`, `supabase`) are `jest.mock()`'d as singletons too. A naive test suite would leak queue state and mock call history between tests. The fix, at the top of `offlineQueue.test.ts`:

```ts
function loadQueueModule() {
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const NetInfo = require('@react-native-community/netinfo');
  const { supabase } = require('@/lib/supabase');
  const queueModule = require('./offlineQueue');
  // ... wire up mock helpers against these specific instances
  return { ...queueModule, AsyncStorage, NetInfo, ...helpers };
}
```

`jest.resetModules()` clears Jest's module registry, so the next `require('./offlineQueue')` gets a **fresh module instance** with fresh singleton state — but that only works if every dependency is *also* re-required after the reset, targeting the same fresh mock instances the fresh module will see. Each test calls `loadQueueModule()` at the top instead of top-level `import`, giving every test a clean slate. This pattern is specific to modules with module-scope mutable state; most other test files in this repo use plain top-level imports since their modules are pure functions or export hooks/classes without hidden singleton state.

Other notable mocks in that file: a hand-written `expo-file-system` fake (`FakeFile`/`FakeDirectory` classes backed by an in-memory `Map<string, Uint8Array>`) standing in for the real `Directory`/`File`/`Paths` class-based API, since there's no official Jest preset mock for it.

### What's covered

- `phone.test.ts` — `normalizePhoneNumber` edge cases (E.164 passthrough, bare 10-digit, invalid formats).
- `offlineQueue.test.ts` — enqueue/persist, upload success/failure/partial-batch-failure, network-restore sweep, no-session-stays-queued.
- `exportBills.test.ts` — CSV/HTML escaping (`csvEscape`, `escapeHtml`) and row generation (`billsToCsv`, `billsToHtml`) for injection-safety and formatting correctness.
- `env.test.ts` — `requireEnv()` throwing behavior for missing required env vars.
- `notifications.test.ts` — offset-skipping logic for already-past trigger dates, identifier determinism.
- `purchases.test.ts` — `REVENUECAT_CONFIGURED`'s platform-key detection (iOS vs. Android env var, unconfigured), `configurePurchases`'s once-per-session guard and platform key selection, mock-mode no-ops (`getCurrentOffering`/`getCustomerInfo` return `null` without touching the SDK when unconfigured), and `isEntitlementActive`'s pure logic. Uses the same fresh-module-per-test pattern as `env.test.ts` (module-scope `IOS_API_KEY`/`ANDROID_API_KEY` are read once at import time) plus a minimal `jest.doMock('react-native', ...)` override for `Platform.OS` — a full `jest.requireActual('react-native')` pulls in native modules that throw outside a real native runtime, so the mock only provides the one export (`Platform`) this file needs.

## Edge function tests (Deno)

- Run a single function's tests: `deno test --allow-env --allow-net supabase/functions/<name>/index.test.ts` (the exact invocation is documented in a comment at the top of each `index.test.ts`).
- Run all four: `deno test --allow-env --allow-net supabase/functions/`.
- Every function's production code is structured as `export function createHandler(getClient = defaultGetClient) { return async (req) => {...} }` specifically so tests can inject a **hand-written fake client** (`RemindersClient`, `BillsClient`, `WhatsAppSupabaseClient`, `ProfilesAndSubscriptionsClient` — one narrow type per function, matching only the exact chained method calls that function makes) instead of a real `SupabaseClient`. `Deno.serve(handler)` only runs `if (import.meta.main)`, so importing the module for tests never actually starts a server.
- Fake clients are built as plain object literals mimicking PostgREST's chainable builder shape, e.g. `send-reminders`'s fake:
  ```ts
  const client: RemindersClient = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: due, error: null }) }) }) }) }),
      update: (values) => ({ eq: async (_col, id) => { /* record the flip */ return { error: null }; } }),
    }),
  };
  ```
- Secrets under test are set/deleted directly via `Deno.env.set()`/`Deno.env.delete()` inside a `try/finally` per test, so one test's env doesn't leak into the next.
- `fetch` itself is mocked where a function calls an external API (Claude in `parse-bill`'s tests, the Graph API + internal `parse-bill` invocation in `whatsapp-webhook`'s tests) — no real network calls happen in the suite despite `--allow-net` being required (Deno needs the permission grant even for a same-process construction of a `Request`/`Response`, and some tests do exercise real crypto via `crypto.subtle` for the HMAC signature tests).
- What's covered per function: `docs/edge-functions.md` describes the exact contracts being tested — auth/secret validation (401 on wrong/missing secret, 200 on correct), the core business logic (offset sweep counts, tier classification, phone matching, mock-vs-claude extraction mode), and CORS/method handling (`OPTIONS`, wrong method → 405).

## Local Supabase (manual/integration verification, not part of either automated suite)

Database trigger behavior (e.g. `reminders_enforce_free_tier_limit`) was verified manually against a local Postgres instance via `psql` rather than an automated test — see `docs/security.md` for the exact verification steps taken during the Phase 12 hardening pass. There's no pgTAP or SQL-level automated test suite in this repo; migrations are trusted via manual review + this kind of ad hoc psql verification for anything non-obvious (trigger logic, RLS policies).
