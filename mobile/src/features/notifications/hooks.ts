import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useIsLoggedIn } from '@/features/auth/store';

import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  NOTIFICATIONS_PAGE,
} from './api';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

export function useUnreadCount() {
  const loggedIn = useIsLoggedIn();
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: fetchUnreadCount,
    enabled: loggedIn,
  });
}

export function useNotifications() {
  const loggedIn = useIsLoggedIn();
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length < NOTIFICATIONS_PAGE ? undefined : pages.length,
    enabled: loggedIn,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: number[]) => markNotificationsRead(ids),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
