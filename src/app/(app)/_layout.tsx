import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useCaptureQueue } from '@/features/capture/useCaptureQueue';
import { useShareIntentCapture } from '@/features/capture/useShareIntentCapture';

export default function AppLayout() {
  const router = useRouter();
  useCaptureQueue();
  const onShareCaptured = useCallback(
    (billId: string) => router.push(`/(app)/bills/${billId}`),
    [router],
  );
  useShareIntentCapture(onShareCaptured);
  return <Stack screenOptions={{ headerShown: false }} />;
}
