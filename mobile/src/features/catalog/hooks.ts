import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  fetchCategories,
  fetchCollectionSlugs,
  fetchHome,
  fetchProduct,
  fetchStoreStatus,
  listCollectionProducts,
  listProducts,
} from './api';
import { filtersKey, type Filters } from '../filters/filters';
import type { Category, SortKey } from './types';

/** All catalog query keys start with 'catalog' so Realtime/foreground can refresh them together. */
export const catalogKeys = {
  all: ['catalog'] as const,
  home: ['catalog', 'home'] as const,
  store: ['catalog', 'store'] as const,
  categories: ['catalog', 'categories'] as const,
  products: (categoryId: number, sort: SortKey, filters: Filters = {}) =>
    ['catalog', 'products', categoryId, sort, filtersKey(filters)] as const,
  collection: (slug: string) => ['catalog', 'collection', slug] as const,
  collectionSlugs: ['catalog', 'collection-slugs'] as const,
  product: (slug: string) => ['catalog', 'product', slug] as const,
};

export const useHome = () =>
  useQuery({ queryKey: catalogKeys.home, queryFn: fetchHome, staleTime: 5 * 60_000 });

/** Open/closed changes with the clock, so refresh every minute while visible. */
export const useStoreStatus = () =>
  useQuery({
    queryKey: catalogKeys.store,
    queryFn: fetchStoreStatus,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

export const useCategories = () =>
  useQuery({ queryKey: catalogKeys.categories, queryFn: fetchCategories, staleTime: 30 * 60_000 });

export type CategoryTree = {
  parents: Category[];
  childrenOf: (parentId: number) => Category[];
  bySlug: (slug: string) => Category | undefined;
  byId: (id: number) => Category | undefined;
};

export function useCategoryTree() {
  const q = useCategories();
  const tree = useMemo<CategoryTree | undefined>(() => {
    if (!q.data) return undefined;
    const all = q.data;
    const parents = all.filter((c) => c.parent_id === null);
    const kids = new Map<number, Category[]>();
    for (const c of all) {
      if (c.parent_id === null) continue;
      kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
    }
    return {
      parents,
      childrenOf: (id) => kids.get(id) ?? [],
      bySlug: (slug) => all.find((c) => c.slug === slug),
      byId: (id) => all.find((c) => c.id === id),
    };
  }, [q.data]);
  return { ...q, tree };
}

export const useCategoryProducts = (
  categoryId: number | undefined,
  sort: SortKey,
  filters: Filters = {},
) =>
  useInfiniteQuery({
    queryKey: catalogKeys.products(categoryId ?? 0, sort, filters),
    queryFn: ({ pageParam }) => listProducts(categoryId!, sort, pageParam, filters),
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    enabled: categoryId !== undefined,
    staleTime: 2 * 60_000,
  });

export const useCollectionProducts = (slug: string) =>
  useInfiniteQuery({
    queryKey: catalogKeys.collection(slug),
    queryFn: ({ pageParam }) => listCollectionProducts(slug, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last?.has_more ? last.page + 1 : undefined),
    staleTime: 2 * 60_000,
  });

/** Map of collection id → slug (for home rails configured with a collection_id). */
export function useCollectionSlugs() {
  const q = useQuery({
    queryKey: catalogKeys.collectionSlugs,
    queryFn: fetchCollectionSlugs,
    staleTime: 30 * 60_000,
  });
  return useMemo(() => new Map((q.data ?? []).map((c) => [c.id, c.slug])), [q.data]);
}

export const useProduct = (slug: string) =>
  useQuery({
    queryKey: catalogKeys.product(slug),
    queryFn: () => fetchProduct(slug),
    staleTime: 60_000,
  });
