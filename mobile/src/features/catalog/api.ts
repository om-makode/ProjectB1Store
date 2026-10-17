import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

import type { Filters } from '../filters/filters';

import type {
  Category,
  CollectionPage,
  HomePayload,
  ProductDetail,
  ProductPage,
  SortKey,
  StoreStatus,
} from './types';

// RPCs return jsonb, typed as `Json` by supabase gen types; the shapes are documented in ./types.

export const fetchHome = async (): Promise<HomePayload> =>
  (await unwrap(getSupabase().rpc('get_home', {}))) as unknown as HomePayload;

export const fetchStoreStatus = async (): Promise<StoreStatus | null> =>
  (await unwrap(getSupabase().rpc('store_status', {}))) as unknown as StoreStatus | null;

export const fetchCategories = async (): Promise<Category[]> =>
  (await unwrap(
    getSupabase()
      .from('categories')
      .select(
        'id, parent_id, slug, name, icon, image_path, color, sort_order, filters, attribute_schema',
      )
      .order('sort_order')
      .order('id'),
  )) as unknown as Category[];

export const PAGE_SIZE = 20;

export const listProducts = async (
  categoryId: number,
  sort: SortKey,
  page: number,
  filters: Filters = {},
): Promise<ProductPage> =>
  (await unwrap(
    getSupabase().rpc('list_products', {
      p_category_id: categoryId,
      p_filters: filters as Json,
      p_sort: sort,
      p_page: page,
      p_size: PAGE_SIZE,
    }),
  )) as unknown as ProductPage;

export const listCollectionProducts = async (
  slug: string,
  page: number,
): Promise<CollectionPage | null> =>
  (await unwrap(
    getSupabase().rpc('list_collection_products', {
      p_slug: slug,
      p_page: page,
      p_size: PAGE_SIZE,
    }),
  )) as unknown as CollectionPage | null;

export const fetchProduct = async (slugOrId: string): Promise<ProductDetail | null> => {
  let slug = slugOrId;
  // Notification links (e.g. wishlist price drops) carry the product id, not the slug.
  if (/^\d+$/.test(slugOrId)) {
    const rows = (await unwrap(
      getSupabase().from('products').select('slug').eq('id', Number(slugOrId)).limit(1),
    )) as { slug: string }[];
    if (!rows[0]) return null;
    slug = rows[0].slug;
  }
  return (await unwrap(
    getSupabase().rpc('get_product', { p_slug: slug }),
  )) as unknown as ProductDetail | null;
};

/** id → slug for active collections ("See all" on home rails that point at a collection). */
export const fetchCollectionSlugs = async (): Promise<{ id: number; slug: string }[]> =>
  (await unwrap(getSupabase().from('collections').select('id, slug').eq('is_active', true))) as {
    id: number;
    slug: string;
  }[];
