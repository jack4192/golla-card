import * as Crypto from 'expo-crypto';
export const hashPin = (salt, pin) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
export async function createPinSalt() {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
