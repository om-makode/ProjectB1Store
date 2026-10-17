import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listAdminReviews,
  listCampaigns,
  setReviewHidden,
  type AdminReview,
  type ReviewFilter,
} from './api';

export * from './api';

/** Admin hooks for Phase 8: reviews moderation + campaigns. */

// ---------- hooks ----------

const keys = {
  reviews: (f: ReviewFilter) => ['admin', 'reviews', f] as const,
  campaigns: ['admin', 'campaigns'] as const,
};

export const useAdminReviews = (f: ReviewFilter) =>
  useQuery({ queryKey: keys.reviews(f), queryFn: () => listAdminReviews(f) });

export function useSetReviewHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { review: AdminReview; hidden: boolean; reason: string | null }) =>
      setReviewHidden(v.review, v.hidden, v.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}

export const useCampaigns = () => useQuery({ queryKey: keys.campaigns, queryFn: listCampaigns });
export const useInvalidateCampaigns = () => {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: keys.campaigns });
};
