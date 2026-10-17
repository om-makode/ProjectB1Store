import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';
import type { Enums, Tables, TablesInsert } from '@/types/helpers';

import type { CsvRecord } from './csv';

/**
 * Admin data access. Writes to merchandising tables go straight through RLS ("<table>: admin
 * write"); anything touching products, prices, stores or roles goes through the admin_* RPCs
 * (validation + audit log). See supabase/migrations/*_p7_admin.sql.
 */

type Fns = Database['public']['Functions'];
type Views = Database['public']['Views'];

export type AppRole = Enums<'app_role'>;
export type AdminUser = Fns['admin_list_users']['Returns'][number];
export type CategoryRow = Tables<'categories'>;
export type BrandRow = Tables<'brands'>;
export type BannerRow = Tables<'banners'>;
export type HomeSectionRow = Tables<'home_sections'>;
export type CollectionRow = Tables<'collections'>;
export type SynonymRow = Tables<'search_synonyms'>;
export type StoreRow = Tables<'stores'>;
export type SectionType = Enums<'section_type'>;

export type Dashboard = {
  orders: number;
  order_value: number;
  delivered_revenue: number;
  avg_order_value: number;
  cancelled: number;
  in_progress: number;
  new_customers: number;
  low_stock: number;
  open_issues: number;
  zero_result_searches_7d: number;
};

export const REPORTS = [
  'v_sales_daily',
  'v_top_products',
  'v_low_stock',
  'v_zero_result_searches',
  'v_cancellations',
  'v_payments_daily',
] as const;
export type ReportName = (typeof REPORTS)[number];
export type ReportRow<N extends ReportName> = Views[N]['Row'];

const sb = () => getSupabase();

// ---------- dashboard & reports ----------

export const fetchDashboard = async (): Promise<Dashboard> =>
  (await unwrap(sb().rpc('admin_dashboard_today'))) as unknown as Dashboard;

const reportOrder: Record<ReportName, { column: string; ascending: boolean }> = {
  v_sales_daily: { column: 'day', ascending: false },
  v_top_products: { column: 'units', ascending: false },
  v_low_stock: { column: 'stock', ascending: true },
  v_zero_result_searches: { column: 'searches', ascending: false },
  v_cancellations: { column: 'orders', ascending: false },
  v_payments_daily: { column: 'day', ascending: false },
};

export async function fetchReport<N extends ReportName>(name: N, limit = 50) {
  const o = reportOrder[name];
  return (await unwrap(
    sb().from(name).select('*').order(o.column, { ascending: o.ascending }).limit(limit),
  )) as unknown as ReportRow<N>[];
}

// ---------- categories & brands ----------

export const listAdminCategories = async (): Promise<CategoryRow[]> =>
  unwrap(sb().from('categories').select('*').order('sort_order').order('id'));

export async function saveCategory(
  id: number | null,
  values: Omit<TablesInsert<'categories'>, 'id' | 'created_at' | 'updated_at' | 'schema_version'>,
): Promise<CategoryRow> {
  if (id) {
    return unwrap(sb().from('categories').update(values).eq('id', id).select('*').single());
  }
  return unwrap(sb().from('categories').insert(values).select('*').single());
}

export const reorderRows = async (
  table: 'categories' | 'banners' | 'home_sections' | 'collections' | 'brands',
  ids: number[],
) => unwrap(sb().rpc('admin_reorder', { p_table: table, p_ids: ids }));

export const productsMissingAttribute = async (categoryId: number, key: string) =>
  unwrap(sb().rpc('admin_products_missing_attribute', { p_category_id: categoryId, p_key: key }));

export const listBrands = async (): Promise<BrandRow[]> =>
  unwrap(sb().from('brands').select('*').order('slug'));

export const createBrand = async (slug: string, name: Json): Promise<BrandRow> =>
  unwrap(sb().from('brands').insert({ slug, name }).select('*').single());

// ---------- products ----------

export type AdminProductListItem = {
  id: number;
  slug: string;
  name: Json;
  category_id: number;
  is_active: boolean;
  attributes: Json;
  product_variants: {
    id: number;
    sku: string;
    price: number;
    mrp: number;
    is_default: boolean;
    is_active: boolean;
  }[];
  product_images: { thumb_path: string | null; sort_order: number }[];
};

export const ADMIN_PRODUCTS_PAGE = 40;

export async function listAdminProducts(opts: {
  q: string;
  categoryIds: number[] | null;
  status: 'all' | 'active' | 'inactive';
  page: number;
}): Promise<AdminProductListItem[]> {
  let query = sb()
    .from('products')
    .select(
      'id, slug, name, category_id, is_active, attributes, ' +
        'product_variants(id, sku, price, mrp, is_default, is_active), product_images(thumb_path, sort_order)',
    )
    .order('updated_at', { ascending: false })
    .range(opts.page * ADMIN_PRODUCTS_PAGE, (opts.page + 1) * ADMIN_PRODUCTS_PAGE - 1);
  const q = opts.q.trim().toLowerCase();
  if (q)
    query = query.or(
      `search_text.ilike.%${q.replace(/[%,()]/g, ' ')}%,slug.ilike.%${q.replace(/[%,()]/g, ' ')}%`,
    );
  if (opts.categoryIds) query = query.in('category_id', opts.categoryIds);
  if (opts.status !== 'all') query = query.eq('is_active', opts.status === 'active');
  return (await unwrap(query)) as unknown as AdminProductListItem[];
}

export type AdminProduct = Tables<'products'> & {
  product_variants: (Tables<'product_variants'> & {
    inventory: { stock: number; low_stock_threshold: number; store_id: number }[];
  })[];
  product_images: Tables<'product_images'>[];
};

export const fetchAdminProduct = async (id: number): Promise<AdminProduct> =>
  (await unwrap(
    sb()
      .from('products')
      .select(
        '*, product_variants(*, inventory(stock, low_stock_threshold, store_id)), product_images(*)',
      )
      .eq('id', id)
      .single(),
  )) as unknown as AdminProduct;

export type UpsertResult = { product_id: number; slug: string; removed_image_paths: string[] };

export async function upsertProduct(payload: Record<string, unknown>): Promise<UpsertResult> {
  const res = (await unwrap(
    sb().rpc('admin_upsert_product', { payload: payload as Json }),
  )) as unknown as UpsertResult;
  // Deleted images: remove the files too (best effort; the rows are already gone).
  if (res.removed_image_paths?.length) {
    await sb().storage.from('catalog').remove(res.removed_image_paths);
  }
  return res;
}

// ---------- CSV import / export ----------

export type ImportResult = {
  dry_run: boolean;
  created: number;
  updated: number;
  errors: { product_slug: string | null; rows: number[]; message: string }[];
};

export const importProducts = async (rows: CsvRecord[], dryRun: boolean): Promise<ImportResult> =>
  (await unwrap(
    sb().rpc('admin_import_products', { p_rows: rows as unknown as Json, p_dry_run: dryRun }),
  )) as unknown as ImportResult;

export type ExportProduct = Tables<'products'> & {
  categories: { slug: string } | null;
  brands: { slug: string; name: Json } | null;
  product_variants: (Tables<'product_variants'> & {
    inventory: { stock: number; low_stock_threshold: number }[];
  })[];
};

/** Every product with its variants and stock (pages of 500 to stay under the API row cap). */
export async function fetchAllProductsForExport(): Promise<ExportProduct[]> {
  const out: ExportProduct[] = [];
  for (let from = 0; ; from += 500) {
    const page = (await unwrap(
      sb()
        .from('products')
        .select(
          '*, categories(slug), brands(slug, name), product_variants(*, inventory(stock, low_stock_threshold))',
        )
        .order('id')
        .range(from, from + 499),
    )) as unknown as ExportProduct[];
    out.push(...page);
    if (page.length < 500) return out;
  }
}

// ---------- images ----------

export async function uploadCatalogFile(
  path: string,
  uri: string,
  contentType: string,
): Promise<string> {
  // fetch(uri) reads file:// on native and blob:/data: on web.
  const body = await (await fetch(uri)).arrayBuffer();
  // Every path has a fresh UUID, so never upsert: upsert also needs SELECT + UPDATE storage
  // policies, while the catalog bucket only grants admins INSERT (plus update/delete).
  await unwrap(sb().storage.from('catalog').upload(path, body, { contentType, upsert: false }));
  return path;
}

// ---------- merchandising ----------

export const listBanners = async (storeId: number): Promise<BannerRow[]> =>
  unwrap(sb().from('banners').select('*').eq('store_id', storeId).order('sort_order').order('id'));

export const saveBanner = async (
  id: number | null,
  values: Omit<TablesInsert<'banners'>, 'id' | 'created_at' | 'updated_at'>,
) =>
  id
    ? unwrap(sb().from('banners').update(values).eq('id', id))
    : unwrap(sb().from('banners').insert(values));

export const deleteBanner = async (id: number) =>
  unwrap(sb().from('banners').delete().eq('id', id));

export const listSections = async (storeId: number): Promise<HomeSectionRow[]> =>
  unwrap(
    sb().from('home_sections').select('*').eq('store_id', storeId).order('sort_order').order('id'),
  );

export const saveSection = async (
  id: number | null,
  values: Omit<TablesInsert<'home_sections'>, 'id' | 'created_at' | 'updated_at'>,
) =>
  id
    ? unwrap(sb().from('home_sections').update(values).eq('id', id))
    : unwrap(sb().from('home_sections').insert(values));

export const deleteSection = async (id: number) =>
  unwrap(sb().from('home_sections').delete().eq('id', id));

export const listCollections = async (): Promise<
  (CollectionRow & { collection_products: { product_id: number; sort_order: number }[] })[]
> =>
  (await unwrap(
    sb().from('collections').select('*, collection_products(product_id, sort_order)').order('id'),
  )) as unknown as (CollectionRow & {
    collection_products: { product_id: number; sort_order: number }[];
  })[];

export const saveCollection = async (
  id: number | null,
  values: Omit<TablesInsert<'collections'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<CollectionRow> =>
  id
    ? unwrap(sb().from('collections').update(values).eq('id', id).select('*').single())
    : unwrap(sb().from('collections').insert(values).select('*').single());

export const setCollectionProducts = async (collectionId: number, productIds: number[]) =>
  unwrap(
    sb().rpc('admin_set_collection_products', {
      p_collection_id: collectionId,
      p_product_ids: productIds,
    }),
  );

export const fetchProductsByIds = async (ids: number[]) =>
  ids.length
    ? ((await unwrap(sb().from('products').select('id, slug, name').in('id', ids))) as {
        id: number;
        slug: string;
        name: Json;
      }[])
    : [];

export const listSynonyms = async (): Promise<SynonymRow[]> =>
  unwrap(sb().from('search_synonyms').select('*').order('maps_to').order('term'));

export const addSynonym = async (term: string, mapsTo: string) =>
  unwrap(sb().from('search_synonyms').insert({ term, maps_to: mapsTo }));

export const deleteSynonym = async (id: number) =>
  unwrap(sb().from('search_synonyms').delete().eq('id', id));

// ---------- store settings ----------

export const fetchStoreRow = async (storeId: number): Promise<StoreRow> =>
  unwrap(sb().from('stores').select('*').eq('id', storeId).single());

export const updateStoreSettings = async (storeId: number, patch: Record<string, unknown>) =>
  unwrap(sb().rpc('admin_update_store_settings', { p_store_id: storeId, p_patch: patch as Json }));

// ---------- users & roles ----------

export const listUsers = async (q: string, role: AppRole | null, page: number) =>
  unwrap(
    sb().rpc('admin_list_users', {
      p_query: q.trim() || undefined,
      p_role: role ?? undefined,
      p_limit: 30,
      p_offset: page * 30,
    }),
  );

export const setUserRole = async (userId: string, role: AppRole) =>
  unwrap(sb().rpc('admin_set_role', { p_user_id: userId, p_role: role }));

export const setUserBlocked = async (
  userId: string,
  blocked: boolean,
  codAllowed: boolean | null,
  note?: string,
) =>
  unwrap(
    sb().rpc('admin_set_user_blocked', {
      p_user_id: userId,
      p_blocked: blocked,
      p_cod_allowed: codAllowed ?? undefined,
      p_note: note,
    }),
  );
