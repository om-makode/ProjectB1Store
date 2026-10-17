import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/store';

import {
  createAddress,
  deleteAddress,
  listMyAddresses,
  updateAddress,
  type AddressInput,
} from './api';

export const addressKeys = { mine: (uid: string | null) => ['me', 'addresses', uid] as const };

export function useMyAddresses() {
  const uid = useUserId();
  return useQuery({
    queryKey: addressKeys.mine(uid),
    queryFn: listMyAddresses,
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function useSaveAddress() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AddressInput }) =>
      id ? updateAddress(id, input) : createAddress(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: addressKeys.mine(uid) }),
  });
}

export function useDeleteAddress() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: addressKeys.mine(uid) }),
  });
}
