import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/store';

import { fetchMyProfile, updateMyProfile, type ProfilePatch } from './api';

export const profileKeys = { me: (uid: string | null) => ['me', 'profile', uid] as const };

export function useMyProfile() {
  const uid = useUserId();
  return useQuery({
    queryKey: profileKeys.me(uid),
    queryFn: () => fetchMyProfile(uid!),
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateProfile() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateMyProfile(uid!, patch),
    onSuccess: (p) => qc.setQueryData(profileKeys.me(uid), p),
  });
}
