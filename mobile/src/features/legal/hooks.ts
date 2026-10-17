import { useQuery } from '@tanstack/react-query';

import { fetchSellerInfo } from './api';

// Under 'catalog' so it's saved for offline use like other store data.
export const useSellerInfo = () =>
  useQuery({ queryKey: ['catalog', 'seller'], queryFn: fetchSellerInfo, staleTime: 60 * 60_000 });
