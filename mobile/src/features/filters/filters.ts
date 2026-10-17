import type { LocalizedString } from '@/i18n/localize';

import type { AttributeField } from '../catalog/types';

/**
 * Filters sent to list_products / search_products as `p_filters`
 * (matched by public.product_matches_filters in the p1 catalog migration).
 * price_max is exclusive.
 */
export type Filters = {
  brand_ids?: number[];
  price_min?: number;
  price_max?: number;
  veg?: boolean;
  in_stock?: boolean;
  attrs?: Record<string, string[] | boolean>;
};

/** One entry of categories.filters (admin-defined, no-code). */
export type FilterConfig =
  | { type: 'brand' }
  | { type: 'price'; buckets: number[] }
  | { type: 'veg'; quick?: boolean }
  | { type: 'in_stock'; quick?: boolean }
  | { type: 'attribute'; key: string; quick?: boolean };

/** category_filter_options() result: what actually exists on the shelf, with counts. */
export type FilterOptions = {
  brands: { id: number; name: LocalizedString; count: number }[];
  attributes: Record<string, { value: string; count: number }[]>;
  price: { min: number | null; max: number | null } | null;
  veg_count: number;
};

/** Used for search results, which have no category to take filters from. */
export const DEFAULT_SEARCH_FILTERS: FilterConfig[] = [
  { type: 'veg', quick: true },
  { type: 'price', buckets: [0, 50, 100, 250, 500] },
];

export type PriceRange = { min: number; max?: number };

/** [0, 30, 60, 100] → <30, 30–60, 60–100, 100+ */
export function priceRanges(buckets: number[]): PriceRange[] {
  const b = [...new Set(buckets)].filter((n) => n >= 0).sort((x, y) => x - y);
  if (b.length === 0) return [];
  const ranges: PriceRange[] = [];
  for (let i = 0; i < b.length - 1; i++) ranges.push({ min: b[i]!, max: b[i + 1]! });
  ranges.push({ min: b[b.length - 1]! });
  return ranges;
}

export const isPriceSelected = (f: Filters, r: PriceRange) =>
  f.price_min === r.min && f.price_max === r.max;

export function setPrice(f: Filters, r: PriceRange | null): Filters {
  const { price_min: _a, price_max: _b, ...rest } = f;
  if (!r || isPriceSelected(f, r)) return rest;
  return { ...rest, price_min: r.min, ...(r.max !== undefined ? { price_max: r.max } : {}) };
}

export function toggleBrand(f: Filters, id: number): Filters {
  const cur = f.brand_ids ?? [];
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  const { brand_ids: _b, ...rest } = f;
  return next.length ? { ...rest, brand_ids: next } : rest;
}

export function toggleFlag(f: Filters, key: 'veg' | 'in_stock'): Filters {
  const { [key]: on, ...rest } = f;
  return on ? rest : { ...rest, [key]: true };
}

/** Boolean attributes are on/off; select/multiSelect attributes are multi-choice. */
export function toggleAttr(f: Filters, key: string, value: string | true): Filters {
  const attrs = { ...(f.attrs ?? {}) };
  if (value === true) {
    if (attrs[key] === true) delete attrs[key];
    else attrs[key] = true;
  } else {
    const cur = Array.isArray(attrs[key]) ? (attrs[key] as string[]) : [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    if (next.length) attrs[key] = next;
    else delete attrs[key];
  }
  const { attrs: _a, ...rest } = f;
  return Object.keys(attrs).length ? { ...rest, attrs } : rest;
}

export function isAttrSelected(f: Filters, key: string, value: string | true): boolean {
  const v = f.attrs?.[key];
  return value === true ? v === true : Array.isArray(v) && v.includes(value);
}

export function activeCount(f: Filters): number {
  return (
    (f.brand_ids?.length ?? 0) +
    (f.price_min !== undefined ? 1 : 0) +
    (f.veg ? 1 : 0) +
    (f.in_stock ? 1 : 0) +
    Object.values(f.attrs ?? {}).reduce<number>(
      (n, v) => n + (v === true ? 1 : Array.isArray(v) ? v.length : 0),
      0,
    )
  );
}

/** Stable key so equal filters share one TanStack Query cache entry. */
export function filtersKey(f: Filters): string {
  const attrs = Object.fromEntries(
    Object.entries(f.attrs ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
  );
  return JSON.stringify({
    b: [...(f.brand_ids ?? [])].sort((x, y) => x - y),
    p: [f.price_min ?? null, f.price_max ?? null],
    v: !!f.veg,
    s: !!f.in_stock,
    a: attrs,
  });
}

/** Attribute filters only make sense for select / multiSelect / boolean fields. */
export function attributeFilterField(
  fields: AttributeField[],
  key: string,
): AttributeField | undefined {
  const f = fields.find((x) => x.key === key && !x.deprecated);
  return f && ['select', 'multiSelect', 'boolean'].includes(f.type) ? f : undefined;
}

/** Parse categories.filters jsonb defensively (admin-edited data). */
export function parseFilterConfig(raw: unknown): FilterConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterConfig[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const quick = o.quick === true;
    switch (o.type) {
      case 'brand':
        out.push({ type: 'brand' });
        break;
      case 'price':
        if (Array.isArray(o.buckets) && o.buckets.every((n) => typeof n === 'number'))
          out.push({ type: 'price', buckets: o.buckets as number[] });
        break;
      case 'veg':
      case 'in_stock':
        out.push({ type: o.type, quick });
        break;
      case 'attribute':
        if (typeof o.key === 'string') out.push({ type: 'attribute', key: o.key, quick });
        break;
    }
  }
  return out;
}
