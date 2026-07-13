# Capture: camera / gallery / PDF / OS share-sheet

Three of the four bill-intake paths funnel through the **same offline upload queue** (`src/features/capture/offlineQueue.ts`); the fourth (WhatsApp Business number) is server-side only and never touches this queue — see `docs/edge-functions.md` → `whatsapp-webhook`.

```ts
// src/features/capture/types.ts
export type CaptureSource = 'camera' | 'share_extension';
```

Both in-app capture (camera snap, gallery pick, PDF pick) and the OS share-sheet hand-off produce a `QueuedCapture`, differing only in the `source` tag written onto the eventual `bills` row (`bill_source` also has a third value, `'whatsapp_business'`, set only by the webhook).

## `/(app)/capture` screen (`src/app/(app)/capture.tsx`)

Three buttons, each requesting the relevant permission first and then calling a shared `handleAsset(uri, mimeType)`:

- **Take photo** — `ImagePicker.requestCameraPermissionsAsync()` → `ImagePicker.launchCameraAsync({ quality: 0.8 })`.
- **Choose from gallery** — `ImagePicker.requestMediaLibraryPermissionsAsync()` → `ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] })`.
- **Choose PDF** — `DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })` (no permission prompt needed).

Any permission denial shows an `Alert` and aborts; a cancelled picker just clears the `busy` state. `handleAsset` calls `captureAndUpload(uri, mimeType)` (source defaults to `'camera'` for all three buttons — they're all "the user actively adding a bill in-app"):
- Non-null `billId` → `router.replace('/(app)/bills/${billId}')`, straight into the confirm/edit screen.
- `null` (device was offline, upload didn't happen inline) → an alert explaining the bill is queued and will appear as pending once back online, then `router.back()`.
- A thrown error (e.g. local file copy failed) → an alert with the error message; nothing is queued.

## Offline queue (`src/features/capture/offlineQueue.ts`)

Module-level in-memory `queue: QueuedCapture[]`, persisted to `AsyncStorage` under key `'capture-queue/v1'` and mirrored to local files in `Directory(Paths.document, 'captures')` (via the `expo-file-system` `Directory`/`File` API). Design goal: **a capture must survive the app being killed before the network call completes.**

- **`enqueueCapture(sourceUri, mimeType, source='camera')`**: generates a UUID (`expo-crypto`), copies the source file into the app-owned `captures/` directory as `${id}.${ext}` (extension derived from mime type: `application/pdf`→`pdf`, `image/png`→`png`, `image/heic`/`heif`→`heic`, else `jpg`), appends a `QueuedCapture` record (`id`, `localUri`, `mimeType`, `extension`, `source`, `createdAt`, `attempts: 0`) to the queue, and persists. The copy-then-enqueue ordering means the original picker/camera temp file can be cleared by the OS without losing the capture.
- **`uploadOne(item, userId)`** (internal): reads the local file's bytes, uploads to the `bills` storage bucket at `${userId}/${item.id}.${item.extension}` (`upsert: false`), inserts a `bills` row (`user_id`, `source`, `storage_path`, `status: 'pending_review'`), then deletes the local file copy on success. Throws (caller catches) on either the storage upload or the table insert failing.
- **`processQueue()`**: no-ops if already processing or the queue is empty (a simple in-flight guard, not a mutex — fine for a single-device client). Bails early with `{ uploaded: [] }` if there's no active Supabase session (nothing to attribute the bills to). Iterates the queue in order; each item that uploads successfully is removed from the queue and reported in `uploaded: {itemId, billId}[]`; each item that throws stays in the queue with `attempts` incremented and `lastError` recorded for the next retry — **a transient network blip never drops a capture**.
- **`watchNetworkAndProcess()`**: a `NetInfo.addEventListener` subscription that calls `processQueue()` whenever `state.isConnected && state.isInternetReachable !== false`. Returns the unsubscribe function.
- **`subscribeToQueue(listener)`** / **`getQueue()`**: expose the current queue (hydrating from `AsyncStorage` lazily, once, guarded by a `hydrating` promise so concurrent callers await the same hydration instead of racing).

### `useCaptureQueue()` (`src/features/capture/useCaptureQueue.ts`)

React hook mounted once near app start (inside the authenticated `(app)` layout): subscribes to queue changes, starts `watchNetworkAndProcess()`, and calls `processQueue()` once on mount (to drain anything queued while the app was fully closed). Returns `{ queue }` for any UI that wants to show pending-upload state.

Also exports the actual entry point every capture path calls:

```ts
export async function captureAndUpload(
  sourceUri: string,
  mimeType: string | undefined,
  source: CaptureSource = 'camera',
): Promise<string | null>
```

Enqueues, then immediately calls `processQueue()` and returns the resulting `billId` if this specific item uploaded inline (device online), or `null` if it's still sitting in the queue (device offline) — callers use the `null` case to show a "saved offline, will sync" message instead of navigating to a bill that doesn't exist in the DB yet.

## OS share-sheet capture (`src/features/capture/useShareIntentCapture.ts`)

```ts
export function useShareIntentCapture(onCaptured: (billId: string) => void): { processing: boolean }
```

Wraps `expo-share-intent`'s `useShareIntentContext()`. Mounted inside the authenticated `(app)` layout only (bills are user-owned, so this is meaningless pre-login). When `hasShareIntent` becomes true and there are files attached:
1. Guards against double-handling with a `handling` ref (the effect can re-run on context identity changes before the async work finishes).
2. For every shared file, calls `captureAndUpload(file.path, file.mimeType, 'share_extension')` — same queue, same offline-safety guarantees as in-app capture, just tagged with a different `source`.
3. Calls `resetShareIntent()` once all files are processed, then invokes `onCaptured(firstBillId)` with the first file that uploaded inline (if any) — the caller (the `(app)` root layout or index screen) uses this to navigate straight to that bill's confirm/edit screen. If every shared file stayed queued offline, `onCaptured` is never called — nothing to navigate to yet.

This is how "forward a bill from WhatsApp via the OS share sheet" works today, distinct from and independent of the WhatsApp Business Cloud API webhook path — a user can share an image from WhatsApp (or any other app) into Bill Organizer via the native share sheet without any WhatsApp Business/Meta setup at all.
