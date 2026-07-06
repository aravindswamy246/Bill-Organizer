import { Stack } from 'expo-router';

import { useCaptureQueue } from '@/features/capture/useCaptureQueue';

export default function AppLayout() {
  useCaptureQueue();
  return <Stack screenOptions={{ headerShown: false }} />;
}
