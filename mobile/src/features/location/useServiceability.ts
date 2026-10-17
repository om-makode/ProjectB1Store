import { useQuery } from '@tanstack/react-query';

import { checkServiceability } from './api';

/** Rounded to ~100 m so small GPS jitter doesn't refetch. */
const r = (n: number) => Math.round(n * 1000) / 1000;

export function useServiceability(lat: number | null | undefined, lng: number | null | undefined) {
  return useQuery({
    queryKey: ['serviceability', lat == null ? null : r(lat), lng == null ? null : r(lng)],
    queryFn: () => checkServiceability(lat!, lng!),
    enabled: lat != null && lng != null,
    staleTime: 10 * 60_000,
  });
}
