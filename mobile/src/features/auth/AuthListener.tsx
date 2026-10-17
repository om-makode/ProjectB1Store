import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { clearLocalCart, mergeGuestCartAfterLogin } from '@/features/cart/sync';
import { useDeliveryLocation } from '@/features/location/store';
import { syncProfileLanguage } from '@/features/profile/api';
import { flushPendingStockAlerts } from '@/features/stock-alerts/store';
import { logger } from '@/lib/logger';
import { useSettings } from '@/stores/settings';

import { subscribeToAuth } from './api';
import { useAuth } from './store';

/** Mirrors the Supabase session into useAuth and runs the "just logged in / out" side effects. */
export function AuthListener() {
  const qc = useQueryClient();
  const setSession = useAuth((s) => s.setSession);
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const language = useSettings((s) => s.language);

  useEffect(
    () =>
      subscribeToAuth((event, session) => {
        setSession(session);
        if (event === 'SIGNED_IN') {
          // Defer: calling Supabase inside the auth callback can deadlock its lock.
          setTimeout(() => {
            void flushPendingStockAlerts();
            void mergeGuestCartAfterLogin(); // phone cart → cart_items (larger qty wins)
            void qc.invalidateQueries({ queryKey: ['me'] });
          }, 0);
        }
        if (event === 'SIGNED_OUT') {
          clearLocalCart();
          qc.removeQueries({ queryKey: ['me'] });
          qc.removeQueries({ queryKey: ['orders'] });
          const loc = useDeliveryLocation.getState();
          if (loc.location?.source === 'address') loc.setLocation(null);
        }
      }),
    [qc, setSession],
  );

  // The language chosen on this phone is the one we use for notifications too.
  useEffect(() => {
    if (!userId) return;
    syncProfileLanguage(userId, language).catch((e) =>
      logger.warn('language sync failed', String(e)),
    );
  }, [userId, language]);

  return null;
}
