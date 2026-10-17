import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAuth } from './store';

export type LoginReason =
  | 'checkout'
  | 'wishlist'
  | 'addresses'
  | 'profile'
  | 'notify'
  | 'orders'
  | 'notifications'
  | 'generic';

/** Open the login screen when the user isn't logged in; after login they land back here. */
export function openLogin(reason: LoginReason = 'generic') {
  router.push({ pathname: '/auth/login', params: { reason } });
}

/**
 * `const requireLogin = useRequireLogin();  if (!requireLogin('checkout')) return;`
 * Returns true when already logged in.
 */
export function useRequireLogin() {
  return useCallback((reason: LoginReason = 'generic') => {
    if (useAuth.getState().session) return true;
    openLogin(reason);
    return false;
  }, []);
}
