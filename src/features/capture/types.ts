/**
 * All manual in-app capture entry points (camera snap, gallery pick, PDF
 * pick) share the `camera` bill source — they're the same intake channel
 * (the user actively adding a bill in-app). `share_extension` covers bills
 * shared in from other apps (e.g. WhatsApp) via the OS share sheet. Both
 * flow through this same local queue; `whatsapp_business` (the Cloud API
 * intake number) does not — it's handled server-side by a webhook.
 */
export type CaptureSource = 'camera' | 'share_extension';

export type QueuedCapture = {
  id: string;
  /** file:// URI of the app-owned local copy (survives the OS clearing picker temp files). */
  localUri: string;
  mimeType: string;
  extension: string;
  source: CaptureSource;
  createdAt: string;
  attempts: number;
  lastError?: string;
};
