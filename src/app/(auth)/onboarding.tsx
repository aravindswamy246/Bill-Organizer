import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField } from '@/components/form-field';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { normalizePhoneNumber } from '@/features/auth/phone';

const WHATSAPP_INTAKE_NUMBER = process.env.EXPO_PUBLIC_WHATSAPP_INTAKE_NUMBER ?? 'Coming soon';

export default function OnboardingScreen() {
  const { completeOnboarding } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      setError('Enter a valid phone number, e.g. 9876543210 or +919876543210');
      return;
    }
    setLoading(true);
    try {
      await completeOnboarding(name.trim(), normalizedPhone);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.form}
        >
          <ThemedText type="title" style={styles.title}>
            Tell us about you
          </ThemedText>
          <ThemedText type="default">
            Your phone number is how we match bills you forward from WhatsApp to your account.
          </ThemedText>

          <FormField label="Name" autoComplete="name" value={name} onChangeText={setName} />
          <FormField
            label="Phone number"
            placeholder="9876543210"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <PrimaryButton title="Continue" loading={loading} onPress={onSubmit} />

          <ThemedView type="backgroundElement" style={styles.hint}>
            <ThemedText type="smallBold">Forward bills over WhatsApp</ThemedText>
            <ThemedText type="small">
              Once set up, save {WHATSAPP_INTAKE_NUMBER} and forward any bill you receive — it will
              show up here automatically.
            </ThemedText>
          </ThemedView>
        </KeyboardAvoidingView>
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
    paddingHorizontal: Spacing.four,
  },
  form: {
    gap: Spacing.three,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
  },
  error: {
    color: '#D64545',
  },
  hint: {
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
});
