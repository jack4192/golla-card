export const DEMO_EMAIL = 'demo@example.com';
export const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
export const isValidEmail = value => {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
};
