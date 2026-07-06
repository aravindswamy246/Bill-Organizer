import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { useCaptureQueue } from '@/features/capture/useCaptureQueue';
import { useShareIntentCapture } from '@/features/capture/useShareIntentCapture';
import { requestNotificationPermissions } from '@/lib/notifications';

export default function AppLayout() {
  const router = useRouter();
  useCaptureQueue();
  const onShareCaptured = useCallback(
    (billId: string) => router.push(`/(app)/bills/${billId}`),
    [router],
  );
  useShareIntentCapture(onShareCaptured);

  useEffect(() => {
    // Ask once up-front so reminders created later can schedule
    // notifications without an extra permission prompt mid-flow.
    void requestNotificationPermissions();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
