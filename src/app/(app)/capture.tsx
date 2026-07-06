import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { captureAndUpload } from '@/features/capture/useCaptureQueue';

type Busy = 'camera' | 'gallery' | 'file' | null;

export default function CaptureScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);

  const handleAsset = async (uri: string, mimeType: string | undefined) => {
    try {
      const billId = await captureAndUpload(uri, mimeType);
      if (billId) {
        router.replace(`/(app)/bills/${billId}`);
      } else {
        Alert.alert(
          'Saved offline',
          "This bill is queued and will finish uploading once you're back online — it will show up in your bill list as pending.",
        );
        router.back();
      }
    } catch (error) {
      Alert.alert(
        'Could not save bill',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const onTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera permission needed',
        'Enable camera access in Settings to capture bills.',
      );
      return;
    }
    setBusy('camera');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled) {
      setBusy(null);
      return;
    }
    await handleAsset(result.assets[0].uri, result.assets[0].mimeType);
  };

  const onPickGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo library permission needed',
        'Enable photo access in Settings to pick a bill image.',
      );
      return;
    }
    setBusy('gallery');
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      mediaTypes: ['images'],
    });
    if (result.canceled) {
      setBusy(null);
      return;
    }
    await handleAsset(result.assets[0].uri, result.assets[0].mimeType);
  };

  const onPickFile = async () => {
    setBusy('file');
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      setBusy(null);
      return;
    }
    await handleAsset(result.assets[0].uri, result.assets[0].mimeType ?? 'application/pdf');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} hitSlop={Spacing.two}>
          <ThemedText type="link" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>

        <ThemedText type="title" style={styles.title}>
          Add a bill
        </ThemedText>
        <ThemedText type="default">
          Capture a photo, pick one from your gallery, or choose a PDF. You&apos;ll be able to
          review and edit the details before it&apos;s saved.
        </ThemedText>

        <ThemedView style={styles.buttons}>
          <PrimaryButton title="Take photo" loading={busy === 'camera'} onPress={onTakePhoto} />
          <PrimaryButton
            title="Choose from gallery"
            loading={busy === 'gallery'}
            onPress={onPickGallery}
          />
          <PrimaryButton title="Choose PDF" loading={busy === 'file'} onPress={onPickFile} />
        </ThemedView>
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
  },
  buttons: {
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
});
