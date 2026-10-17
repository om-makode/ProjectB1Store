import type { Lang } from '@/i18n';
import type { LocalizedString } from '@/i18n/localize';
import { unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

import type { ProductCard, ProductPage } from '../catalog/types';
import type { FilterOptions, Filters } from '../filters/filters';

/** Shapes from supabase/migrations/*_p2_search.sql */

export type SearchPage = ProductPage & {
  /** The words actually searched, after synonyms (e.g. "doodh" → ["doodh", "milk"]). */
  terms: string[];
  /** Matching categories, first page only. */
  categories: {
    id: number;
    slug: string;
    name: LocalizedString;
    image_path: string | null;
    parent_id: number | null;
  }[];
};

export type Suggestion = {
  kind: 'category' | 'brand' | 'product';
  slug: string;
  label: LocalizedString;
  image_path: string | null;
};

export const SEARCH_PAGE_SIZE = 20;

const asJson = (f: Filters) => f as unknown as Json;

export const searchProducts = async (
  q: string,
  lang: Lang,
  filters: Filters,
  page: number,
): Promise<SearchPage> =>
  (await unwrap(
    getSupabase().rpc('search_products', {
      p_q: q,
      p_lang: lang,
      p_filters: asJson(filters),
      p_page: page,
      p_size: SEARCH_PAGE_SIZE,
    }),
  )) as unknown as SearchPage;

export const fetchSuggestions = async (q: string): Promise<Suggestion[]> =>
  ((await unwrap(getSupabase().rpc('search_suggestions', { p_q: q, p_limit: 8 }))) ??
    []) as unknown as Suggestion[];

export const fetchTrending = async (): Promise<string[]> =>
  ((await unwrap(getSupabase().rpc('trending_searches', { p_limit: 8 }))) ??
    []) as unknown as string[];

/**
 * Analytics only, fire-and-forget: the owner sees what people search for and
 * (with `requested`) what they wanted but the store doesn't stock.
 */
export function logSearch(q: string, lang: Lang, resultsCount: number, requested = false) {
  void (async () => {
    try {
      await unwrap(
        getSupabase().rpc('log_search', {
          p_query: q,
          p_lang: lang,
          p_results_count: resultsCount,
          p_requested: requested,
        }),
      );
    } catch (e) {
      logger.warn('log_search failed', e);
    }
  })();
}

export const fetchFilterOptions = async (categoryId: number): Promise<FilterOptions> =>
  (await unwrap(
    getSupabase().rpc('category_filter_options', { p_category_id: categoryId }),
  )) as unknown as FilterOptions;

export const fetchRelated = async (
  productId: number,
  kind: 'similar' | 'together',
): Promise<ProductCard[]> =>
  ((await unwrap(
    getSupabase().rpc('related_products', { p_product_id: productId, p_kind: kind, p_limit: 12 }),
  )) ?? []) as unknown as ProductCard[];
