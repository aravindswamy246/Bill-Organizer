import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

import type { CaptureSource, QueuedCapture } from './types';

const QUEUE_STORAGE_KEY = 'capture-queue/v1';
const captureDirectory = new Directory(Paths.document, 'captures');

type QueueListener = (queue: QueuedCapture[]) => void;

let queue: QueuedCapture[] = [];
let hydrated = false;
let hydrating: Promise<void> | null = null;
let processing = false;
const listeners = new Set<QueueListener>();

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (!hydrating) {
    hydrating = (async () => {
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      queue = raw ? (JSON.parse(raw) as QueuedCapture[]) : [];
      hydrated = true;
    })();
  }
  await hydrating;
}

async function persist(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  for (const listener of listeners) listener(queue);
}

export function subscribeToQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  void hydrate().then(() => listener(queue));
  return () => {
    listeners.delete(listener);
  };
}

export async function getQueue(): Promise<QueuedCapture[]> {
  await hydrate();
  return queue;
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

/**
 * Copies a picked/captured file into app-owned storage and enqueues it for
 * upload. Safe to call while offline — the file is persisted locally first,
 * so nothing is lost even if the app is killed before the upload completes.
 */
export async function enqueueCapture(
  sourceUri: string,
  mimeType: string | undefined,
  source: CaptureSource = 'camera',
): Promise<QueuedCapture> {
  await hydrate();
  if (!captureDirectory.exists) {
    captureDirectory.create({ intermediates: true });
  }

  const id = Crypto.randomUUID();
  const resolvedMimeType = mimeType ?? 'image/jpeg';
  const extension = extensionFromMimeType(resolvedMimeType);
  const destination = new File(captureDirectory, `${id}.${extension}`);
  await new File(sourceUri).copy(destination);

  const item: QueuedCapture = {
    id,
    localUri: destination.uri,
    mimeType: resolvedMimeType,
    extension,
    source,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  queue = [...queue, item];
  await persist();
  return item;
}

async function uploadOne(item: QueuedCapture, userId: string): Promise<string> {
  const file = new File(item.localUri);
  const bytes = await file.bytes();
  const storagePath = `${userId}/${item.id}.${item.extension}`;

  const { error: uploadError } = await supabase.storage
    .from('bills')
    .upload(storagePath, bytes, { contentType: item.mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabase
    .from('bills')
    .insert({
      user_id: userId,
      source: item.source,
      storage_path: storagePath,
      status: 'pending_review',
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  if (file.exists) file.delete();
  return data.id;
}

export type UploadedCapture = { itemId: string; billId: string };

/**
 * Uploads every queued capture in order. Items that fail stay in the queue
 * (with an incremented attempt count) for the next retry — a transient
 * network blip never drops a capture.
 */
export async function processQueue(): Promise<{ uploaded: UploadedCapture[] }> {
  await hydrate();
  if (processing || queue.length === 0) return { uploaded: [] };
  processing = true;
  const uploaded: UploadedCapture[] = [];
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { uploaded };

    const remaining: QueuedCapture[] = [];
    for (const item of queue) {
      try {
        const billId = await uploadOne(item, session.user.id);
        uploaded.push({ itemId: item.id, billId });
      } catch (error) {
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }
    queue = remaining;
    await persist();
  } finally {
    processing = false;
  }
  return { uploaded };
}

/** Retries the queue whenever connectivity is restored. Call once near app start. */
export function watchNetworkAndProcess(): () => void {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void processQueue();
    }
  });
}
