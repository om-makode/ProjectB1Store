import { normalizeIndianPhone } from '@/features/profile/phone';

import { mapAuthError } from '../api';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));

describe('mapAuthError', () => {
  it('maps Supabase OTP and rate-limit errors to codes the login screen translates', () => {
    expect(mapAuthError({ message: 'Token has expired or is invalid' }).code).toBe('AUTH_BAD_CODE');
    expect(mapAuthError({ message: 'For security purposes…', status: 429 }).code).toBe(
      'AUTH_RATE_LIMIT',
    );
    expect(mapAuthError({ message: 'Network request failed' }).kind).toBe('network');
  });
});

describe('normalizeIndianPhone', () => {
  it('stores 10-digit Indian mobiles as +91…', () => {
    expect(normalizeIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normalizeIndianPhone('09876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('+91-9876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('12345')).toBeNull();
  });
});
