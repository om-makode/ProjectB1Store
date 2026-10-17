/**
 * Small RFC 4180 CSV reader/writer for the product import/export (no dependency).
 * Format (one row per variant; product columns are read from the first row of each product_slug):
 * see PRODUCT_COLUMNS + optional `attr.<key>` columns (localizedText: `attr.<key>_en/_mr/_hi`).
 */

export const PRODUCT_COLUMNS = [
  'product_slug',
  'category_slug',
  'brand_slug',
  'brand_name',
  'name_en',
  'name_mr',
  'name_hi',
  'description_en',
  'description_mr',
  'description_hi',
  'is_veg',
  'tags',
  'hsn_code',
  'gst_rate',
  'country_of_origin',
  'manufacturer_name',
  'manufacturer_address',
  'shelf_life',
  'is_active',
  'sku',
  'barcode',
  'variant_label_en',
  'variant_label_mr',
  'variant_label_hi',
  'net_quantity',
  'unit',
  'mrp',
  'price',
  'max_per_order',
  'is_default',
  'stock',
  'low_stock_threshold',
] as const;

export const MAX_ROWS_PER_CALL = 300;

/** Parse CSV text into rows of cells. Handles quotes, "" escapes, CRLF and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // drop fully empty lines
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type CsvRecord = Record<string, string> & { _row: string };

/** Header row → objects. `_row` is the line number in the file (header = line 1). */
export function toRecords(rows: string[][]): { header: string[]; records: CsvRecord[] } {
  const [head, ...body] = rows;
  const header = (head ?? []).map((h) => h.trim());
  const records = body.map((cells, i) => {
    const rec: Record<string, string> = { _row: String(i + 2) };
    header.forEach((h, j) => {
      if (h) rec[h] = (cells[j] ?? '').trim();
    });
    return rec as CsvRecord;
  });
  return { header, records };
}

/** Missing required columns, so the user is told before anything is sent. */
export function missingColumns(header: string[]): string[] {
  const required = ['product_slug', 'category_slug', 'name_en', 'sku', 'mrp', 'price', 'unit'];
  return required.filter((c) => !header.includes(c));
}

/**
 * Pack whole products into chunks of at most `max` rows (a product never spans two calls,
 * because the server builds each product from all of its rows).
 */
export function chunkByProduct(records: CsvRecord[], max = MAX_ROWS_PER_CALL): CsvRecord[][] {
  const groups = new Map<string, CsvRecord[]>();
  for (const r of records) {
    const key = r.product_slug?.trim() || `__missing_${r._row}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const chunks: CsvRecord[][] = [];
  let current: CsvRecord[] = [];
  for (const g of groups.values()) {
    if (current.length > 0 && current.length + g.length > max) {
      chunks.push(current);
      current = [];
    }
    current.push(...g); // a single product larger than max still goes alone; the server reports it
    if (current.length >= max) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const needsQuotes = /[",\r\n]/;
const escapeCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return needsQuotes.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Objects → CSV text (with a BOM so Excel opens Devanagari correctly). */
export function toCsv(header: string[], rows: Record<string, unknown>[]): string {
  const lines = [header.map(escapeCell).join(',')];
  for (const r of rows) lines.push(header.map((h) => escapeCell(r[h])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

type Loc = { en?: string | null; mr?: string | null; hi?: string | null } | null | undefined;

/** One attribute value → CSV cells (keys are column names). */
export function attributeCells(key: string, value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) {
    const parts = value.map((v) =>
      v && typeof v === 'object' ? ((v as Loc)?.en ?? '') : String(v),
    );
    return { [`attr.${key}`]: parts.filter(Boolean).join('|') };
  }
  if (typeof value === 'object') {
    const l = value as NonNullable<Loc>;
    return {
      [`attr.${key}_en`]: l.en ?? '',
      [`attr.${key}_mr`]: l.mr ?? '',
      [`attr.${key}_hi`]: l.hi ?? '',
    };
  }
  if (typeof value === 'boolean') return { [`attr.${key}`]: value ? 'yes' : 'no' };
  return { [`attr.${key}`]: String(value) };
}
