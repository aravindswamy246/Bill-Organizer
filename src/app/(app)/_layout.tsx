import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { useCaptureQueue } from '@/features/capture/useCaptureQueue';
import { useShareIntentCapture } from '@/features/capture/useShareIntentCapture';
import { requestNotificationPermissions } from '@/lib/notifications';
import { configurePurchases } from '@/lib/purchases';

export default function AppLayout() {
  const router = useRouter();
  const { session } = useAuth();
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

  useEffect(() => {
    // Sets RevenueCat's app_user_id to match the Supabase auth user id so
    // revenuecat-webhook can map purchase events back to profiles.id.
    // No-ops entirely in mock mode (no RevenueCat API key configured yet).
    if (session) configurePurchases(session.user.id);
  }, [session]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
