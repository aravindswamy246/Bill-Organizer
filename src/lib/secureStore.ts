import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';

/**
 * Supabase session tokens can exceed SecureStore's per-key size limit on
 * Android, so we can't store them in SecureStore directly. Instead: the
 * (small) AES-256 key lives in SecureStore, and the (large) encrypted
 * session blob lives in AsyncStorage. This is the storage adapter pattern
 * Supabase recommends for React Native — see
 * https://supabase.com/docs/guides/auth/quickstarts/react-native
 */
class LargeSecureStore {
  private async getEncryptionKey(keyName: string): Promise<Uint8Array> {
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing) {
      return aesjs.utils.hex.toBytes(existing);
    }
    const key = crypto.getRandomValues(new Uint8Array(32));
    await SecureStore.setItemAsync(keyName, aesjs.utils.hex.fromBytes(key));
    return key;
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;

    const keyName = `${key}-secure-key`;
    const encryptionKey = await this.getEncryptionKey(keyName);
    const [ivHex, dataHex] = encrypted.split(':');
    if (!ivHex || !dataHex) return null;

    const cipher = new aesjs.ModeOfOperation.ctr(
      encryptionKey,
      new aesjs.Counter(aesjs.utils.hex.toBytes(ivHex)),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(dataHex));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async setItem(key: string, value: string): Promise<void> {
    const keyName = `${key}-secure-key`;
    const encryptionKey = await this.getEncryptionKey(keyName);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(iv));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    const payload = `${aesjs.utils.hex.fromBytes(iv)}:${aesjs.utils.hex.fromBytes(encryptedBytes)}`;
    await AsyncStorage.setItem(key, payload);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(`${key}-secure-key`);
  }
}

export const largeSecureStore = new LargeSecureStore();
