import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ADMIN_PRODUCTS_PAGE,
  fetchAdminProduct,
  fetchDashboard,
  fetchReport,
  fetchStoreRow,
  listAdminCategories,
  listAdminProducts,
  listBanners,
  listBrands,
  listCollections,
  listSections,
  listSynonyms,
  listUsers,
  type AppRole,
  type CategoryRow,
  type ReportName,
} from './api';
import type { AdminField } from './schema';

export const adminKeys = {
  all: ['admin'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  report: (name: ReportName) => ['admin', 'report', name] as const,
  categories: ['admin', 'categories'] as const,
  brands: ['admin', 'brands'] as const,
  products: (q: string, cat: number | null, status: string) =>
    ['admin', 'products', q, cat, status] as const,
  product: (id: number) => ['admin', 'product', id] as const,
  banners: (storeId: number) => ['admin', 'banners', storeId] as const,
  sections: (storeId: number) => ['admin', 'sections', storeId] as const,
  collections: ['admin', 'collections'] as const,
  synonyms: ['admin', 'synonyms'] as const,
  store: (storeId: number) => ['admin', 'store', storeId] as const,
  users: (q: string, role: AppRole | null) => ['admin', 'users', q, role] as const,
};

export const useDashboard = () =>
  useQuery({ queryKey: adminKeys.dashboard, queryFn: fetchDashboard, refetchInterval: 60_000 });

export const useReport = <N extends ReportName>(name: N, limit = 50) =>
  useQuery({
    queryKey: [...adminKeys.report(name), limit],
    queryFn: () => fetchReport(name, limit),
  });

export const useAdminCategories = () =>
  useQuery({ queryKey: adminKeys.categories, queryFn: listAdminCategories });

export const useBrands = () => useQuery({ queryKey: adminKeys.brands, queryFn: listBrands });

/** Parent categories with their children, in sort order. */
export function categoryTree(rows: CategoryRow[]) {
  const parents = rows.filter((c) => c.parent_id === null);
  return parents.map((p) => ({ parent: p, children: rows.filter((c) => c.parent_id === p.id) }));
}

export const fieldsOf = (c: CategoryRow | null | undefined): AdminField[] => {
  const s = c?.attribute_schema as { fields?: AdminField[] } | null | undefined;
  return Array.isArray(s?.fields) ? s.fields : [];
};

export function useAdminProducts(
  q: string,
  categoryIds: number[] | null,
  status: 'all' | 'active' | 'inactive',
) {
  return useInfiniteQuery({
    queryKey: [
      ...adminKeys.products(q, categoryIds?.[0] ?? null, status),
      categoryIds?.length ?? 0,
    ],
    queryFn: ({ pageParam }) => listAdminProducts({ q, categoryIds, status, page: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length < ADMIN_PRODUCTS_PAGE ? undefined : pages.length,
  });
}

export const useAdminProduct = (id: number | null) =>
  useQuery({
    queryKey: adminKeys.product(id ?? 0),
    queryFn: () => fetchAdminProduct(id!),
    enabled: !!id,
    staleTime: 0,
  });

export const useBanners = (storeId: number | undefined) =>
  useQuery({
    queryKey: adminKeys.banners(storeId ?? 0),
    queryFn: () => listBanners(storeId!),
    enabled: !!storeId,
  });

export const useSections = (storeId: number | undefined) =>
  useQuery({
    queryKey: adminKeys.sections(storeId ?? 0),
    queryFn: () => listSections(storeId!),
    enabled: !!storeId,
  });

export const useCollections = () =>
  useQuery({ queryKey: adminKeys.collections, queryFn: listCollections });

export const useSynonyms = () => useQuery({ queryKey: adminKeys.synonyms, queryFn: listSynonyms });

export const useStoreRow = (storeId: number | undefined) =>
  useQuery({
    queryKey: adminKeys.store(storeId ?? 0),
    queryFn: () => fetchStoreRow(storeId!),
    enabled: !!storeId,
  });

export function useAdminUsers(q: string, role: AppRole | null) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(q, role),
    queryFn: ({ pageParam }) => listUsers(q, role, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < 30 ? undefined : pages.length),
  });
}

/**
 * After an admin change, refresh admin lists and the customer-facing catalog/home caches
 * (Realtime only covers stock, prices and the store row).
 */
export function useRefreshCatalog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: adminKeys.all });
    void qc.invalidateQueries({ queryKey: ['catalog'] }); // home, categories, products, search
  };
}
