import * as Crypto from 'expo-crypto';
export const hashPassword = (salt, password) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
export async function createRandomHex() {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
