import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { orderKeys } from '@/features/orders/hooks';
import { useTheme } from '@/theme/useTheme';

import {
  adminResolveRefund,
  createPayment,
  fetchAdminRefunds,
  fetchOrderPayments,
  PaymentError,
  switchOrderToCod,
  verifyPayment,
  type VerifyResult,
} from './api';
import { openCheckout } from './checkout';

/** Under ['orders', …] so the live order channel's invalidation refreshes it too. */
export const paymentKeys = {
  order: (id: string) => ['orders', 'payments', id] as const,
  adminRefunds: (filter: string) => ['admin', 'refunds', filter] as const,
};

export const useOrderPayments = (orderId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: paymentKeys.order(orderId ?? ''),
    queryFn: () => fetchOrderPayments(orderId!),
    enabled: !!orderId && enabled,
  });

export type PayState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'pending' } // paid at Razorpay; waiting for confirmation (webhook)
  | { kind: 'done'; result: VerifyResult['result'] }
  | { kind: 'error'; error: PaymentError };

/**
 * create-payment → Razorpay Checkout → verify-payment. The webhook is the safety net:
 * whatever happens here, the order screen follows the order row (Realtime).
 */
export function usePayOrder(orderId: string) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [state, setState] = useState<PayState>({ kind: 'idle' });

  const pay = useCallback(async () => {
    setState({ kind: 'working' });
    try {
      const session = await createPayment(orderId);
      const res = await openCheckout(session, {
        name: 'NearKart',
        description: t('payments.checkoutDescription', { number: session.orderNumber }),
        color: colors.primary,
      });
      setState({ kind: 'pending' });
      const v = await verifyPayment(res).catch(() => ({ result: 'pending' as const, orderId }));
      setState(v.result === 'pending' ? { kind: 'pending' } : { kind: 'done', result: v.result });
    } catch (e) {
      setState({
        kind: 'error',
        error: e instanceof PaymentError ? e : new PaymentError('provider_error', String(e)),
      });
    } finally {
      void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      void qc.invalidateQueries({ queryKey: paymentKeys.order(orderId) });
      void qc.invalidateQueries({ queryKey: orderKeys.all });
    }
  }, [orderId, qc, t, colors.primary]);

  return { pay, state, reset: () => setState({ kind: 'idle' }) };
}

export function useSwitchToCod(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => switchOrderToCod(orderId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      void qc.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export const useAdminRefunds = (filter: 'attention' | 'all') =>
  useQuery({
    queryKey: paymentKeys.adminRefunds(filter),
    queryFn: () => fetchAdminRefunds(filter),
  });

export function useResolveRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminResolveRefund(id, note),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin', 'refunds'] }),
  });
}
