import type { LocalizedString } from '@/i18n/localize';

/** Shapes returned by the Phase 1 RPCs (see supabase/migrations/*_p1_catalog.sql, *_p1_home.sql). */

export type VariantOffer = {
  id: number;
  label: LocalizedString;
  mrp: number;
  price: number;
  discount_pct: number;
  /** least(stock, max_per_order), 0 when unavailable */
  available_qty: number;
  low_stock: boolean;
  max_per_order: number;
};

export type ProductCard = {
  id: number;
  slug: string;
  name: LocalizedString;
  brand: LocalizedString | null;
  is_veg: boolean | null;
  category_id: number;
  attributes: Record<string, unknown>;
  thumb_path: string | null;
  variant_count: number;
  variant: VariantOffer;
  /** From catalog_product_cards (migration 20261101121000); absent on buy-again cards. */
  rating_avg?: number | string | null;
  rating_count?: number | null;
};

export type ProductPage = { items: ProductCard[]; has_more: boolean; page: number };
export type CollectionPage = ProductPage & { collection: CollectionTile };

export type StoreStatus = {
  store_id: number;
  name: LocalizedString;
  city: string | null;
  phone: string | null;
  accepting: boolean;
  open_now: boolean;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
  eta_minutes: number;
  message: LocalizedString | null;
  fees: {
    min_order_value: number;
    delivery_fee: number;
    free_delivery_above: number;
    small_cart_threshold: number;
    small_cart_fee: number;
    packaging_fee: number;
  };
};

export type BannerLink = { type: 'category' | 'product' | 'collection' | 'search'; value: string };

export type Banner = {
  id: number;
  image_path: string | null;
  title: LocalizedString | null;
  link: BannerLink | null;
};

export type CategoryTile = {
  id: number;
  slug: string;
  name: LocalizedString;
  image_path: string | null;
  icon: string | null;
  color: string | null;
};

export type CollectionTile = {
  id: number;
  slug: string;
  title: LocalizedString;
  image_path: string | null;
};

type SectionBase = { id: number; title: LocalizedString | null; config: Record<string, unknown> };

export type HomeSection =
  | (SectionBase & { type: 'banner_carousel'; items: Banner[] })
  | (SectionBase & { type: 'category_grid'; items: CategoryTile[] })
  | (SectionBase & { type: 'product_rail'; items: ProductCard[] })
  | (SectionBase & { type: 'collection_rail'; items: CollectionTile[] })
  | (SectionBase & { type: 'buy_again'; items: ProductCard[] });

export type HomePayload = { store: StoreStatus | null; sections: HomeSection[] };

export type Category = {
  id: number;
  parent_id: number | null;
  slug: string;
  name: LocalizedString;
  icon: string | null;
  image_path: string | null;
  color: string | null;
  sort_order: number;
  /** Admin-defined filter config (parsed with parseFilterConfig). Sub-categories inherit the parent's. */
  filters?: unknown;
  /** { fields: AttributeField[] }; sub-categories add to the parent's fields. */
  attribute_schema?: { fields?: AttributeField[] } | null;
};

export type AttributeField = {
  key: string;
  type:
    | 'text'
    | 'localizedText'
    | 'number'
    | 'boolean'
    | 'select'
    | 'multiSelect'
    | 'localizedList'
    | 'date';
  label: LocalizedString;
  unit?: string;
  options?: { value: string; label: LocalizedString }[];
  deprecated?: boolean;
};

export type ProductDetailVariant = VariantOffer & {
  net_quantity: number;
  unit: string;
  is_default: boolean;
};

export type ProductDetail = {
  product: {
    id: number;
    slug: string;
    name: LocalizedString;
    description: LocalizedString | null;
    attributes: Record<string, unknown>;
    is_veg: boolean | null;
    tags: string[];
    hsn_code: string | null;
    gst_rate: number;
    country_of_origin: string;
    manufacturer: { name: string; address?: string } | null;
    shelf_life: string | null;
    category_id: number;
    /** Phase 8: kept by a trigger on reviews. */
    rating_avg?: number | string | null;
    rating_count?: number | null;
  };
  brand: { id: number; slug: string; name: LocalizedString; logo_path: string | null } | null;
  category: {
    id: number;
    slug: string;
    name: LocalizedString;
    parent_slug: string | null;
    parent_name: LocalizedString | null;
  };
  attribute_fields: AttributeField[];
  variants: ProductDetailVariant[];
  images: { id: number; variant_id: number | null; path: string; thumb_path: string | null }[];
  seller: {
    name: LocalizedString;
    address: LocalizedString;
    fssai_license: string | null;
    gstin: string | null;
  } | null;
};

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'newest';
export const SORT_KEYS: SortKey[] = ['relevance', 'price_asc', 'price_desc', 'discount', 'newest'];
