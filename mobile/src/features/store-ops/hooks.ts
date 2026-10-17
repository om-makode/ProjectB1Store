import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState, Vibration } from 'react-native';

import { useUserId } from '@/features/auth/store';
import { useStoreStatus } from '@/features/catalog/hooks';
import { orderKeys } from '@/features/orders/hooks';
import { useMyProfile } from '@/features/profile/hooks';

import {
  fetchStoreSettings,
  listBoard,
  listOpenIssues,
  listStock,
  listTransitions,
  subscribeStoreOrders,
  todaySummary,
  type OrderStatus,
  type StockFilter,
} from './api';

export const storeOpsKeys = {
  all: ['store-ops'] as const,
  board: (storeId: number) => ['store-ops', 'board', storeId] as const,
  summary: (storeId: number) => ['store-ops', 'summary', storeId] as const,
  transitions: ['store-ops', 'transitions'] as const,
  stock: (storeId: number, filter: StockFilter, q: string) =>
    ['store-ops', 'stock', storeId, filter, q] as const,
  settings: (storeId: number) => ['store-ops', 'settings', storeId] as const,
  issues: ['store-ops', 'issues'] as const,
};

/** 'loading' until the profile is known; staff and admin may enter Store mode. */
export function useStaffAccess(): 'loading' | 'denied' | 'staff' | 'admin' {
  const uid = useUserId();
  const profile = useMyProfile();
  if (!uid) return 'denied';
  if (profile.isPending) return 'loading';
  const role = profile.data?.role;
  return role === 'admin' ? 'admin' : role === 'staff' ? 'staff' : 'denied';
}

/** Single-store app: the store comes from store_status(). */
export const useStoreId = (): number | undefined => useStoreStatus().data?.store_id;

export function useBoard(storeId: number | undefined) {
  return useQuery({
    queryKey: storeOpsKeys.board(storeId ?? 0),
    queryFn: () => listBoard(storeId!),
    enabled: !!storeId,
    refetchInterval: 30_000, // safety net if a Realtime event is missed
  });
}

export function useTodaySummary(storeId: number | undefined) {
  return useQuery({
    queryKey: storeOpsKeys.summary(storeId ?? 0),
    queryFn: () => todaySummary(storeId!),
    enabled: !!storeId,
    refetchInterval: 60_000,
  });
}

export function useTransitions() {
  const q = useQuery({
    queryKey: storeOpsKeys.transitions,
    queryFn: listTransitions,
    staleTime: 60 * 60_000,
  });
  return (from: OrderStatus): OrderStatus[] =>
    (q.data ?? []).filter((t) => t.from_status === from).map((t) => t.to_status);
}

export function useStock(storeId: number | undefined, filter: StockFilter, q: string) {
  return useInfiniteQuery({
    queryKey: storeOpsKeys.stock(storeId ?? 0, filter, q),
    queryFn: ({ pageParam }) => listStock(storeId!, filter, q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < 50 ? undefined : pages.length),
    enabled: !!storeId,
  });
}

export function useStoreSettings(storeId: number | undefined) {
  return useQuery({
    queryKey: storeOpsKeys.settings(storeId ?? 0),
    queryFn: () => fetchStoreSettings(storeId!),
    enabled: !!storeId,
  });
}

export function useOpenIssues() {
  return useQuery({ queryKey: storeOpsKeys.issues, queryFn: listOpenIssues });
}

/**
 * Wraps a staff RPC: on success refetch the board, summary, this order and stock.
 * (Realtime would also trigger it, but the tapping tablet should update instantly.)
 */
export function useStaffAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: storeOpsKeys.all });
      void qc.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

/**
 * Live board: Realtime on this store's orders, plus refetch on foreground and reconnect.
 * The alarm watches the board's count of new orders, so events need no special handling.
 */
export function useStoreOrdersRealtime(storeId: number | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!storeId) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: storeOpsKeys.board(storeId) });
      void qc.invalidateQueries({ queryKey: storeOpsKeys.summary(storeId) });
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeStoreOrders(storeId, {
        onChange: (_event, row) => {
          refresh();
          if (typeof row.id === 'string') {
            void qc.invalidateQueries({ queryKey: orderKeys.detail(row.id) });
          }
        },
        onReconnect: refresh,
      });
    } catch {
      return;
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [qc, storeId]);
}

/** Short buzz pattern for a new order (no-op where unsupported, e.g. most desktops). */
export const buzz = () => {
  try {
    Vibration.vibrate([0, 400, 200, 400]);
  } catch {
    // not supported
  }
};

/** Re-renders every second while `active` (auto-cancel countdowns). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** "4:05" left until auto-cancel, or null when there is no deadline. */
export function countdown(autoCancelAt: string | null | undefined, now: number): string | null {
  if (!autoCancelAt) return null;
  const ms = new Date(autoCancelAt).getTime() - now;
  if (Number.isNaN(ms)) return null;
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
