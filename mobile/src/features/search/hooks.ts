import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { Lang } from '@/i18n';

import { filtersKey, type Filters } from '../filters/filters';
import {
  fetchFilterOptions,
  fetchRelated,
  fetchSuggestions,
  fetchTrending,
  searchProducts,
} from './api';

/** Under 'catalog' so live stock/price updates and foreground refresh cover search too. */
export const searchKeys = {
  results: (q: string, lang: Lang, f: Filters) =>
    ['catalog', 'search', q, lang, filtersKey(f)] as const,
  suggest: (q: string) => ['catalog', 'suggest', q] as const,
  trending: ['catalog', 'trending'] as const,
  filterOptions: (categoryId: number) => ['catalog', 'filter-options', categoryId] as const,
  related: (productId: number, kind: string) => ['catalog', 'related', productId, kind] as const,
};

export const MIN_QUERY = 2;

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, ' ');

export const useSearchResults = (q: string, lang: Lang, filters: Filters) =>
  useInfiniteQuery({
    queryKey: searchKeys.results(q, lang, filters),
    queryFn: ({ pageParam }) => searchProducts(q, lang, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    enabled: q.length >= MIN_QUERY,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

export const useSuggestions = (q: string) =>
  useQuery({
    queryKey: searchKeys.suggest(q),
    queryFn: () => fetchSuggestions(q),
    enabled: q.length >= MIN_QUERY,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

export const useTrending = () =>
  useQuery({ queryKey: searchKeys.trending, queryFn: fetchTrending, staleTime: 30 * 60_000 });

export const useFilterOptions = (categoryId: number | undefined) =>
  useQuery({
    queryKey: searchKeys.filterOptions(categoryId ?? 0),
    queryFn: () => fetchFilterOptions(categoryId!),
    enabled: categoryId !== undefined,
    staleTime: 10 * 60_000,
  });

export const useRelated = (productId: number, kind: 'similar' | 'together') =>
  useQuery({
    queryKey: searchKeys.related(productId, kind),
    queryFn: () => fetchRelated(productId, kind),
    staleTime: 10 * 60_000,
  });
