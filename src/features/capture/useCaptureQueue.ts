import { useEffect, useState } from 'react';

import {
  enqueueCapture,
  processQueue,
  subscribeToQueue,
  watchNetworkAndProcess,
} from './offlineQueue';
import type { CaptureSource, QueuedCapture } from './types';

/**
 * Subscribes to the offline capture queue and keeps it draining: once on
 * mount (in case items were queued while the app was closed) and again
 * whenever connectivity is restored.
 */
export function useCaptureQueue() {
  const [queue, setQueue] = useState<QueuedCapture[]>([]);

  useEffect(() => {
    const unsubscribeQueue = subscribeToQueue(setQueue);
    const unsubscribeNetwork = watchNetworkAndProcess();
    void processQueue();
    return () => {
      unsubscribeQueue();
      unsubscribeNetwork();
    };
  }, []);

  return { queue };
}

/**
 * Enqueues a captured file and immediately attempts to upload it. Returns
 * the new bill id when the upload succeeds inline (device is online), or
 * `null` when it stays queued for later (device is offline) — the caller
 * should tell the user the capture is saved and will finish syncing on its
 * own rather than block on the confirm screen.
 */
export async function captureAndUpload(
  sourceUri: string,
  mimeType: string | undefined,
  source: CaptureSource = 'camera',
): Promise<string | null> {
  const item = await enqueueCapture(sourceUri, mimeType, source);
  const { uploaded } = await processQueue();
  return uploaded.find((entry) => entry.itemId === item.id)?.billId ?? null;
}
