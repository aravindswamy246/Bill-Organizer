import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';

function RootNavigation() {
  const { session, onboardingComplete } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Session restore from secure storage hasn't resolved yet — wait rather
    // than redirecting prematurely to the login screen.
    if (session === undefined) return;

    const path: string[] = segments;
    const inAuthGroup = path[0] === '(auth)';
    const onOnboardingScreen = path[1] === 'onboarding';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && !onboardingComplete && !onOnboardingScreen) {
      router.replace('/(auth)/onboarding');
    } else if (session && onboardingComplete && inAuthGroup) {
      router.replace('/(app)');
    }
  }, [session, onboardingComplete, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ShareIntentProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemedView style={{ flex: 1 }}>
              <RootNavigation />
            </ThemedView>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ShareIntentProvider>
  );
}
