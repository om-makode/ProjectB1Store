import { parseEnv } from '@/config/env';

describe('parseEnv', () => {
  it('accepts a valid config', () => {
    const r = parseEnv({
      EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40),
      EXPO_PUBLIC_WEB_URL: 'http://localhost:8081',
    });
    expect(r.ok).toBe(true);
  });
  it('reports missing fields clearly', () => {
    const r = parseEnv({ EXPO_PUBLIC_WEB_URL: 'http://localhost:8081' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('EXPO_PUBLIC_SUPABASE_URL');
      expect(r.message).toContain('.env.example');
    }
  });
});
