import { fetchStoreStatus } from '@/features/catalog/api';
import type { ProductCard, VariantOffer } from '@/features/catalog/types';
import { asLocalized, type LocalizedString } from '@/i18n/localize';
import { unwrap } from '@/lib/errors';
import { discountPercent } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';
import type { Lang } from '@/i18n';
import type { Tables } from '@/types/helpers';

/** Shapes from supabase/migrations/*_p8_engagement.sql. */

type Fns = Database['public']['Functions'];
export type BuyAgainRow = Fns['buy_again']['Returns'][number];
export type ReviewItem = Fns['order_review_items']['Returns'][number];

export type Review = {
  product_id: number;
  user_id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string;
  language: string | null;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
};

export const REVIEWS_PAGE = 20;
const LOW_STOCK = 5;

// ---------- wishlist ----------

/** Product ids on my wishlist (RLS: own rows). */
export const fetchWishlistIds = async (): Promise<number[]> => {
  const rows = (await unwrap(
    getSupabase().from('wishlist').select('product_id').order('created_at', { ascending: false }),
  )) as {
    product_id: number;
  }[];
  return rows.map((r) => r.product_id);
};

export const addToWishlist = async (userId: string, productId: number) =>
  unwrap(
    getSupabase()
      .from('wishlist')
      .upsert({ user_id: userId, product_id: productId }, { ignoreDuplicates: true }),
  );

export const removeFromWishlist = async (productId: number) =>
  unwrap(getSupabase().from('wishlist').delete().eq('product_id', productId));

/** Wishlist products as cards (same card shape as every other list). */
export const fetchWishlistCards = async (ids: number[]): Promise<ProductCard[]> => {
  if (ids.length === 0) return [];
  const store = await fetchStoreStatus();
  if (!store) return [];
  const cards = (await unwrap(
    getSupabase().rpc('catalog_product_cards', {
      p_store_id: store.store_id,
      p_product_ids: ids,
    }),
  )) as unknown as ProductCard[] | null;
  const byId = new Map((cards ?? []).map((c) => [c.id, c]));
  // Keep wishlist order (newest saved first = order of `ids`).
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
};

// ---------- buy again ----------

export const fetchBuyAgain = async (limit = 20): Promise<BuyAgainRow[]> =>
  (await unwrap(getSupabase().rpc('buy_again', { p_limit: limit }))) ?? [];

/** buy_again rows → the shared ProductCard shape, so ProductCard/ADD work unchanged. */
export function buyAgainToCard(r: BuyAgainRow): ProductCard {
  const available = r.in_stock ? Math.max(0, Math.min(r.stock, r.max_per_order)) : 0;
  const variant: VariantOffer = {
    id: r.variant_id,
    label: asLocalized(r.variant_label),
    mrp: Number(r.mrp),
    price: Number(r.price),
    discount_pct: discountPercent(Number(r.price), Number(r.mrp)),
    available_qty: available,
    low_stock: available > 0 && r.stock <= LOW_STOCK,
    max_per_order: r.max_per_order,
  };
  return {
    id: r.product_id,
    slug: r.product_slug,
    name: asLocalized(r.product_name),
    brand: null,
    is_veg: r.is_veg,
    category_id: 0,
    attributes: {},
    thumb_path: r.thumb_path,
    variant_count: 1,
    variant,
  };
}

// ---------- reviews ----------

/** Visible reviews for a product, newest first (RLS hides hidden ones except my own). */
export const fetchProductReviews = async (productId: number, page: number): Promise<Review[]> =>
  (await unwrap(
    getSupabase()
      .from('reviews')
      .select(
        'product_id, user_id, rating, comment, reviewer_name, language, is_hidden, hidden_reason, created_at',
      )
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .range(page * REVIEWS_PAGE, page * REVIEWS_PAGE + REVIEWS_PAGE - 1),
  )) as Review[];

/** Rating summary for one product (rating_avg / rating_count are kept by a trigger). */
export const fetchProductRating = async (
  slug: string,
): Promise<{
  id: number;
  name: LocalizedString;
  rating_avg: number;
  rating_count: number;
} | null> => {
  const rows = (await unwrap(
    getSupabase()
      .from('products')
      .select('id, name, rating_avg, rating_count')
      .eq('slug', slug)
      .limit(1),
  )) as { id: number; name: unknown; rating_avg: number; rating_count: number }[];
  const r = rows[0];
  return r ? { ...r, name: asLocalized(r.name), rating_avg: Number(r.rating_avg) } : null;
};

export const fetchOrderReviewItems = async (orderId: string): Promise<ReviewItem[]> =>
  (await unwrap(getSupabase().rpc('order_review_items', { p_order_id: orderId }))) ?? [];

export const submitReview = async (
  productId: number,
  rating: number,
  comment: string | null,
  language: Lang,
) =>
  unwrap(
    getSupabase().rpc('submit_review', {
      p_product_id: productId,
      p_rating: rating,
      p_comment: comment ?? undefined,
      p_language: language,
    }),
  );

// ---------- notification preferences ----------

export type NotificationPrefs = { offers: boolean; review_prompts: boolean };
export const DEFAULT_PREFS: NotificationPrefs = { offers: true, review_prompts: true };

export const fetchNotificationPrefs = async (): Promise<NotificationPrefs> => {
  const rows = (await unwrap(
    getSupabase().from('notification_preferences').select('offers, review_prompts').limit(1),
  )) as NotificationPrefs[];
  return rows[0] ?? DEFAULT_PREFS;
};

export const saveNotificationPrefs = async (userId: string, prefs: NotificationPrefs) =>
  unwrap(
    getSupabase()
      .from('notification_preferences')
      .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' }),
  );

// ========== admin (RLS: is_admin()) ==========

export type AdminReview = {
  product_id: number;
  user_id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
  products: { name: LocalizedString; slug: string } | null;
};

export type ReviewFilter = 'all' | 'low' | 'hidden';

export async function listAdminReviews(filter: ReviewFilter): Promise<AdminReview[]> {
  let q = getSupabase()
    .from('reviews')
    .select(
      'product_id, user_id, rating, comment, reviewer_name, is_hidden, hidden_reason, created_at, products(name, slug)',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (filter === 'low') q = q.lte('rating', 2);
  if (filter === 'hidden') q = q.eq('is_hidden', true);
  const rows = (await unwrap(q)) as unknown as AdminReview[];
  return rows.map((r) => ({
    ...r,
    products: r.products ? { ...r.products, name: asLocalized(r.products.name) } : null,
  }));
}

export const setReviewHidden = async (
  r: Pick<AdminReview, 'product_id' | 'user_id'>,
  hidden: boolean,
  reason: string | null,
) =>
  unwrap(
    getSupabase()
      .from('reviews')
      .update({ is_hidden: hidden, hidden_reason: hidden ? reason : null })
      .eq('product_id', r.product_id)
      .eq('user_id', r.user_id),
  );

// ---------- campaigns ----------

export type CampaignRow = Tables<'campaigns'>;

export type SegmentType =
  'all' | 'ordered_within_days' | 'lapsed' | 'never_ordered' | 'category_buyers' | 'wishlisted';
export const SEGMENT_TYPES: SegmentType[] = [
  'all',
  'ordered_within_days',
  'lapsed',
  'never_ordered',
  'category_buyers',
  'wishlisted',
];
/** Which extra number each segment needs. */
export const SEGMENT_PARAM: Partial<Record<SegmentType, 'days' | 'category_id' | 'product_id'>> = {
  ordered_within_days: 'days',
  lapsed: 'days',
  category_buyers: 'category_id',
  wishlisted: 'product_id',
};

export type Segment = {
  type: SegmentType;
  days?: number;
  category_id?: number;
  product_id?: number;
};

export type CampaignDraft = {
  id?: number;
  title: LocalizedString;
  body: LocalizedString;
  link: { type: 'product' | 'category' | 'collection' | 'search'; value: string } | null;
  segment: Segment;
};

export type AudiencePreview = {
  audience: number;
  will_receive: number;
  capped: number;
  quiet_hours_now: boolean;
};

export const listCampaigns = async (): Promise<CampaignRow[]> =>
  (await unwrap(
    getSupabase().from('campaigns').select('*').order('created_at', { ascending: false }).limit(50),
  )) as CampaignRow[];

/** Insert or update a draft; returns its id. */
export async function saveCampaign(d: CampaignDraft, userId: string | null): Promise<number> {
  const row = {
    title: d.title as Json,
    body: d.body as Json,
    link: (d.link?.value ? d.link : null) as Json,
    segment: d.segment as Json,
  };
  if (d.id) {
    await unwrap(getSupabase().from('campaigns').update(row).eq('id', d.id));
    return d.id;
  }
  const created = (await unwrap(
    getSupabase()
      .from('campaigns')
      .insert({ ...row, status: 'draft', created_by: userId })
      .select('id')
      .single(),
  )) as { id: number };
  return created.id;
}

export const previewAudience = async (segment: Segment): Promise<AudiencePreview> =>
  (await unwrap(
    getSupabase().rpc('admin_preview_campaign_audience', { p_segment: segment as Json }),
  )) as unknown as AudiencePreview;

export const sendCampaign = async (id: number, test: boolean) =>
  (await unwrap(
    getSupabase().rpc('admin_send_campaign', { p_campaign_id: id, p_test: test }),
  )) as unknown as { sent: number; test: boolean };

export const scheduleCampaign = async (id: number, at: Date) =>
  unwrap(
    getSupabase()
      .from('campaigns')
      .update({ status: 'scheduled', scheduled_at: at.toISOString() })
      .eq('id', id),
  );

export const cancelCampaign = async (id: number) =>
  unwrap(getSupabase().from('campaigns').update({ status: 'cancelled' }).eq('id', id));

/** "2026-11-14 10:30" (IST, as typed by the owner) → Date. Null when invalid or in the past. */
export function parseScheduleIST(text: string, now = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // IST is UTC+5:30 all year.
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000);
  return at.getTime() > now.getTime() ? at : null;
}
