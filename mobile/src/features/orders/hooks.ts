import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/store';

import {
  fetchActiveOrders,
  fetchOrderDetail,
  fetchOrderIssues,
  fetchPastOrders,
  PAGE_SIZE,
} from './api';

export const orderKeys = {
  all: ['orders'] as const,
  active: (uid: string | null) => ['orders', 'active', uid] as const,
  past: (uid: string | null) => ['orders', 'past', uid] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  issues: (id: string) => ['orders', 'issues', id] as const,
};

export function useActiveOrders() {
  const uid = useUserId();
  return useQuery({
    queryKey: orderKeys.active(uid),
    queryFn: () => fetchActiveOrders(uid!),
    enabled: !!uid,
  });
}

export function usePastOrders() {
  const uid = useUserId();
  return useInfiniteQuery({
    queryKey: orderKeys.past(uid),
    queryFn: ({ pageParam }) => fetchPastOrders(uid!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE_SIZE ? undefined : pages.length),
    enabled: !!uid,
  });
}

export const useOrderDetail = (id: string | undefined) =>
  useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => fetchOrderDetail(id!),
    enabled: !!id,
  });

export const useOrderIssues = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: orderKeys.issues(id ?? ''),
    queryFn: () => fetchOrderIssues(id!),
    enabled: !!id && enabled,
  });
