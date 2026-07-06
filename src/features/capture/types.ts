/**
 * All manual in-app capture entry points (camera snap, gallery pick, PDF
 * pick) share the `camera` bill source — they're the same intake channel
 * (the user actively adding a bill in-app), distinct from the passive
 * `share_extension` and `whatsapp_business` channels.
 */
export type QueuedCapture = {
  id: string;
  /** file:// URI of the app-owned local copy (survives the OS clearing picker temp files). */
  localUri: string;
  mimeType: string;
  extension: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
};
