import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { AppError, unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

import { getGoogleIdToken, googleSignOut } from './google';

const throwIf = (error: unknown) => {
  if (error) throw error;
};

export async function sendEmailOtp(email: string) {
  // shouldCreateUser: the code both signs up and logs in.
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw mapAuthError(error);
}

export async function verifyEmailOtp(email: string, token: string) {
  const { error } = await getSupabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw mapAuthError(error);
}

/** Development only: password login for test accounts created in the Supabase dashboard. */
export async function signInWithPassword(email: string, password: string) {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw mapAuthError(error);
}

/** Returns false if the user closed the Google sheet. */
export async function signInWithGoogle(): Promise<boolean> {
  const idToken = await getGoogleIdToken();
  if (!idToken) return false;
  const { error } = await getSupabase().auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw mapAuthError(error);
  return true;
}

/** Lazy: keeps push (expo-notifications, router) out of auth's import graph. */
const unregisterPush = async () => (await import('@/features/notifications/push')).unregisterPush();

export async function signOut() {
  await unregisterPush(); // needs the session, so before signing out
  await googleSignOut();
  const { error } = await getSupabase().auth.signOut();
  throwIf(error);
}

/** Fails with ACTIVE_ORDERS_EXIST while an order is open (Phase 4 rule). */
export async function deleteMyAccount() {
  await unregisterPush();
  await unwrap(getSupabase().rpc('delete_my_account'));
  await googleSignOut();
  await getSupabase().auth.signOut({ scope: 'local' });
}

type AuthLikeError = { message?: string; status?: number; code?: string };

/** Turn Supabase Auth errors into AppError codes the login screen can translate. */
export function mapAuthError(e: AuthLikeError): AppError {
  const msg = e.message ?? '';
  const code = e.code ?? '';
  if (/rate limit|too many|over_email_send_rate_limit/i.test(msg + code) || e.status === 429)
    return new AppError('validation', msg, 'AUTH_RATE_LIMIT');
  if (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg + code))
    return new AppError('validation', msg, 'AUTH_BAD_CODE');
  if (/email/i.test(msg) && /invalid/i.test(msg))
    return new AppError('validation', msg, 'AUTH_BAD_EMAIL');
  if (/Network request failed|fetch/i.test(msg)) return new AppError('network', msg);
  return new AppError('server', msg, code || 'AUTH_FAILED');
}

/** Reads the stored session and subscribes to changes. Returns an unsubscribe function. */
export function subscribeToAuth(
  onChange: (event: AuthChangeEvent | 'INITIAL', session: Session | null) => void,
): () => void {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    onChange('INITIAL', null); // .env missing: the app shows its config error elsewhere
    return () => undefined;
  }
  void supabase.auth.getSession().then(({ data }) => onChange('INITIAL', data.session));
  const { data } = supabase.auth.onAuthStateChange(onChange);
  return () => data.subscription.unsubscribe();
}
