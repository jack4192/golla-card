// Demo PIN only. Web Crypto and sessionStorage do not replace bank authentication.
const cryptoProvider = () => globalThis.crypto;

export async function createPinSalt() {
  const provider = cryptoProvider();
  if (!provider?.getRandomValues) throw new Error('HTTPS에서 웹 암호화 기능을 사용할 수 있어야 합니다.');
  const bytes = new Uint8Array(16);
  provider.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(salt, pin) {
  const provider = cryptoProvider();
  if (!provider?.subtle) throw new Error('HTTPS에서 웹 암호화 기능을 사용할 수 있어야 합니다.');
  const payload = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await provider.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
