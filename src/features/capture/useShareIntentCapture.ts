import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';

import { captureAndUpload } from './useCaptureQueue';

export type ShareIntentCaptureResult = {
  /** Bill id to navigate to, once at least one shared file uploaded inline. */
  billId: string | null;
  /** True while shared files are still being queued/uploaded. */
  processing: boolean;
};

/**
 * Consumes any pending OS share-sheet hand-off (e.g. an image forwarded from
 * WhatsApp) and feeds it through the same offline capture queue used by the
 * in-app camera/gallery/PDF pickers, tagged as `share_extension` instead of
 * `camera`. Only meaningful once a user is signed in (bills are user-owned),
 * so this should be mounted inside the authenticated `(app)` layout.
 */
export function useShareIntentCapture(onCaptured: (billId: string) => void) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [processing, setProcessing] = useState(false);
  const handling = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || handling.current) return;
    const files = shareIntent.files;
    if (!files || files.length === 0) return;

    handling.current = true;
    // Kicks off the one-time async upload of a freshly-received share intent,
    // not a cascading update in response to other state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProcessing(true);
    void (async () => {
      try {
        let firstBillId: string | null = null;
        for (const file of files) {
          const billId = await captureAndUpload(file.path, file.mimeType, 'share_extension');
          if (billId && !firstBillId) firstBillId = billId;
        }
        resetShareIntent();
        if (firstBillId) onCaptured(firstBillId);
      } finally {
        setProcessing(false);
        handling.current = false;
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, onCaptured]);

  return { processing };
}
