import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/store';

import {
  addToWishlist,
  buyAgainToCard,
  fetchBuyAgain,
  fetchNotificationPrefs,
  fetchOrderReviewItems,
  fetchProductRating,
  fetchProductReviews,
  fetchWishlistCards,
  fetchWishlistIds,
  removeFromWishlist,
  REVIEWS_PAGE,
  saveNotificationPrefs,
  submitReview,
  type NotificationPrefs,
} from './api';
import type { Lang } from '@/i18n';

/** Per-user keys include the user id so logout/login never shows someone else's data. */
export const engagementKeys = {
  wishlist: (uid: string | null) => ['me', uid, 'wishlist'] as const,
  wishlistCards: (uid: string | null, ids: number[]) =>
    ['me', uid, 'wishlist', 'cards', ids.join(',')] as const,
  buyAgain: (uid: string | null) => ['me', uid, 'buy-again'] as const,
  prefs: (uid: string | null) => ['me', uid, 'notification-prefs'] as const,
  reviewItems: (orderId: string) => ['me', 'review-items', orderId] as const,
  reviews: (productId: number) => ['catalog', 'reviews', productId] as const,
  rating: (slug: string) => ['catalog', 'rating', slug] as const,
};

// ---------- wishlist ----------

export function useWishlistIds() {
  const uid = useUserId();
  return useQuery({
    queryKey: engagementKeys.wishlist(uid),
    queryFn: fetchWishlistIds,
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function useIsWishlisted(productId: number) {
  const q = useWishlistIds();
  return !!q.data?.includes(productId);
}

/** Optimistic heart toggle. */
export function useToggleWishlist() {
  const uid = useUserId();
  const qc = useQueryClient();
  const key = engagementKeys.wishlist(uid);
  return useMutation({
    mutationFn: async ({ productId, on }: { productId: number; on: boolean }) => {
      if (!uid) throw new Error('login required');
      if (on) await addToWishlist(uid, productId);
      else await removeFromWishlist(productId);
    },
    onMutate: async ({ productId, on }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<number[]>(key);
      const base = (prev ?? []).filter((id) => id !== productId);
      qc.setQueryData<number[]>(key, on ? [productId, ...base] : base);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useWishlistCards() {
  const uid = useUserId();
  const ids = useWishlistIds();
  const list = ids.data ?? [];
  const cards = useQuery({
    queryKey: engagementKeys.wishlistCards(uid, list),
    queryFn: () => fetchWishlistCards(list),
    enabled: !!uid && ids.isSuccess,
    placeholderData: (prev) => prev,
  });
  return { ids, cards };
}

// ---------- buy again ----------

export function useBuyAgain(limit = 20) {
  const uid = useUserId();
  return useQuery({
    queryKey: [...engagementKeys.buyAgain(uid), limit],
    queryFn: async () => (await fetchBuyAgain(limit)).map(buyAgainToCard),
    enabled: !!uid,
    staleTime: 10 * 60_000,
  });
}

// ---------- reviews ----------

export const useProductRating = (slug: string) =>
  useQuery({
    queryKey: engagementKeys.rating(slug),
    queryFn: () => fetchProductRating(slug),
    staleTime: 10 * 60_000,
  });

export const useProductReviews = (productId: number | undefined) =>
  useInfiniteQuery({
    queryKey: engagementKeys.reviews(productId ?? 0),
    queryFn: ({ pageParam }) => fetchProductReviews(productId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < REVIEWS_PAGE ? undefined : all.length),
    enabled: !!productId,
  });

export const useOrderReviewItems = (orderId: string) =>
  useQuery({
    queryKey: engagementKeys.reviewItems(orderId),
    queryFn: () => fetchOrderReviewItems(orderId),
  });

export function useSubmitReview(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: number; rating: number; comment: string | null; lang: Lang }) =>
      submitReview(v.productId, v.rating, v.comment, v.lang),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: engagementKeys.reviewItems(orderId) });
      void qc.invalidateQueries({ queryKey: engagementKeys.reviews(v.productId) });
      void qc.invalidateQueries({ queryKey: ['catalog', 'rating'] });
    },
  });
}

// ---------- notification preferences ----------

export function useNotificationPrefs() {
  const uid = useUserId();
  return useQuery({
    queryKey: engagementKeys.prefs(uid),
    queryFn: fetchNotificationPrefs,
    enabled: !!uid,
  });
}

export function useSaveNotificationPrefs() {
  const uid = useUserId();
  const qc = useQueryClient();
  const key = engagementKeys.prefs(uid);
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) => saveNotificationPrefs(uid!, prefs),
    onMutate: (prefs) => {
      const prev = qc.getQueryData<NotificationPrefs>(key);
      qc.setQueryData(key, prefs);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
  });
}
