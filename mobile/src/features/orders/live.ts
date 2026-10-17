import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useUserId } from '@/features/auth/store';
import { toNotification } from '@/features/notifications/api';
import { notificationKeys } from '@/features/notifications/hooks';
import i18n, { isLang } from '@/i18n';
import { localize } from '@/i18n/localize';
import { logger } from '@/lib/logger';
import { showToast } from '@/ui/Toast';

import { subscribeMyOrders } from './api';
import { orderKeys } from './hooks';

/**
 * One channel per logged-in user (plan §5, orders + notifications merged to save connections).
 * Events are hints only: data is always refetched through RLS-protected queries, and anything
 * missed while in the background is caught up on foreground / reconnect.
 */
export function useMyOrdersRealtime() {
  const qc = useQueryClient();
  const uid = useUserId();

  useEffect(() => {
    if (!uid) return;
    const refreshAll = () => {
      void qc.invalidateQueries({ queryKey: orderKeys.all });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeMyOrders(uid, {
        onOrderChange: () => void qc.invalidateQueries({ queryKey: orderKeys.all }),
        onNotification: (row) => {
          void qc.invalidateQueries({ queryKey: notificationKeys.all });
          const n = toNotification(row as Parameters<typeof toNotification>[0]);
          const lang = isLang(i18n.language) ? i18n.language : 'en';
          const title = localize(n.title, lang);
          if (title) showToast(title, 'info');
          // A status change also arrives as an orders event; refetch anyway in case it raced.
          if (n.type === 'order_status') void qc.invalidateQueries({ queryKey: orderKeys.all });
        },
        onReconnect: refreshAll,
        onError: (status) => logger.warn('realtime: my-orders channel', status),
      });
    } catch {
      return; // Supabase not configured: screens show the config error
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshAll();
    });
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [qc, uid]);
}

/** Mounted once in the root layout. */
export function OrdersLive() {
  useMyOrdersRealtime();
  return null;
}
