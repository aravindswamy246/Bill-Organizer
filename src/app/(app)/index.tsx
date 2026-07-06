import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';

export default function HomeScreen() {
  const { profile, signOut } = useAuth();
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Hi{profile?.name ? `, ${profile.name}` : ''}</ThemedText>
        <ThemedText type="default">
          Your bills, analytics, and reminders will show up here.
        </ThemedText>
        <PrimaryButton
          title="Add a bill"
          onPress={() => router.push('/(app)/capture')}
          style={styles.button}
        />
        <PrimaryButton title="Log out" onPress={signOut} style={styles.button} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  button: {
    marginTop: Spacing.four,
    alignSelf: 'stretch',
  },
});
