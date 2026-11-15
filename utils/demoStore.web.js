// Browser-only, TEMPORARY DEMO DATA. Not a credential vault.
// Session storage is scoped to this tab; closes/clears when tab is closed.
// Never store raw password, personal identity or real financial information.
const prefix = 'solpay_public_demo_';

const access = () => {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
};

export async function getItemAsync(key) {
  try { return access()?.getItem(prefix + key) ?? null; }
  catch { return null; }
}
export async function setItemAsync(key, value) {
  const storage = access();
  if (!storage) throw new Error('브라우저 시연 저장소에 접근할 수 없습니다.');
  storage.setItem(prefix + key, String(value));
}
export async function deleteItemAsync(key) {
  try { access()?.removeItem(prefix + key); }
  catch { /* private mode or blocked storage */ }
}
