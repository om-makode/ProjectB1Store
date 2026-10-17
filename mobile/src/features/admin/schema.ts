import { z } from 'zod';

import type { AttributeField } from '@/features/catalog/types';
import type { LocalizedString } from '@/i18n/localize';

/**
 * Admin side of the no-code attribute engine. Mirrors the server rules in
 * validate_category_schema() and validate_attributes() (supabase/migrations/*_p7_admin.sql),
 * so the form shows problems before saving; the server checks again.
 */

export const FIELD_TYPES = [
  'text',
  'localizedText',
  'number',
  'boolean',
  'select',
  'multiSelect',
  'localizedList',
  'date',
] as const satisfies readonly AttributeField['type'][];

export type FieldType = (typeof FIELD_TYPES)[number];

/** Builder-side field: the catalog type plus admin-only flags stored in the same JSON. */
export type AdminField = AttributeField & {
  required?: boolean;
  filterable?: boolean;
  badge?: boolean;
  min?: number;
  max?: number;
};

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** "Fat %" → "fat"; "Milk type" → "milk_type" (a starting point the admin can edit). */
export function keyFromLabel(label: string): string {
  const k = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 40);
  return k || 'field';
}

/** Same as the server's slugify(): lowercase, a-z0-9 joined by single hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parent fields first, then the sub-category's; a child field with the same key wins. */
export function effectiveAdminFields(
  parent: AdminField[] | null | undefined,
  child: AdminField[] | null | undefined,
): AdminField[] {
  const out = new Map<string, AdminField>();
  for (const f of parent ?? []) out.set(f.key, f);
  for (const f of child ?? []) out.set(f.key, f);
  return [...out.values()];
}

export type SchemaProblem =
  | { code: 'badKey'; key: string }
  | { code: 'duplicateKey'; key: string }
  | { code: 'noLabel'; key: string }
  | { code: 'noOptions'; key: string }
  | { code: 'deleted'; key: string }
  | { code: 'typeChanged'; key: string };

/** Problems the server would reject (keys can't be deleted or change type once saved). */
export function schemaProblems(saved: AdminField[], next: AdminField[]): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  const seen = new Set<string>();
  for (const f of next) {
    if (!FIELD_KEY_RE.test(f.key)) problems.push({ code: 'badKey', key: f.key });
    if (seen.has(f.key)) problems.push({ code: 'duplicateKey', key: f.key });
    seen.add(f.key);
    if (!f.label?.en?.trim()) problems.push({ code: 'noLabel', key: f.key });
    if ((f.type === 'select' || f.type === 'multiSelect') && !(f.options?.length ?? 0))
      problems.push({ code: 'noOptions', key: f.key });
  }
  for (const old of saved) {
    const now = next.find((f) => f.key === old.key);
    if (!now) problems.push({ code: 'deleted', key: old.key });
    else if (now.type !== old.type) problems.push({ code: 'typeChanged', key: old.key });
  }
  return problems;
}

const localized = z.object({ en: z.string().trim().min(1) }).passthrough();

function fieldZod(f: AdminField): z.ZodType {
  const values = (f.options ?? []).map((o) => o.value);
  switch (f.type) {
    case 'text':
    case 'date':
      return f.type === 'date' ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/) : z.string().min(1);
    case 'localizedText':
      return localized;
    case 'number': {
      let n = z.number();
      if (typeof f.min === 'number') n = n.min(f.min);
      if (typeof f.max === 'number') n = n.max(f.max);
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.string().refine((v) => values.includes(v), { message: 'notAnOption' });
    case 'multiSelect':
      return z.array(z.string().refine((v) => values.includes(v), { message: 'notAnOption' }));
    case 'localizedList':
      return z.array(localized);
  }
}

/**
 * Runtime zod schema for a product's `attributes`, built from the category's effective fields.
 * Required (non-deprecated) fields must be present; everything else is optional. Unknown keys fail,
 * like on the server.
 */
export function buildAttributesSchema(fields: AdminField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const base = fieldZod(f);
    shape[f.key] = f.required && !f.deprecated ? base : base.optional().nullable();
  }
  return z.object(shape).strict();
}

/** Drop empty values so optional fields aren't saved as "" / [] / {}. */
export function cleanAttributes(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const l = v as LocalizedString;
      if (!l.en?.trim() && !l.mr?.trim() && !l.hi?.trim()) continue;
    }
    out[k] = v;
  }
  return out;
}

/** Map zod issues to "key: message" lines for the form. */
export function attributeErrors(fields: AdminField[], values: Record<string, unknown>) {
  const res = buildAttributesSchema(fields).safeParse(cleanAttributes(values));
  if (res.success) return {} as Record<string, string>;
  const errs: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? '_');
    errs[key] ??=
      issue.code === 'invalid_type' && issue.input === undefined ? 'required' : 'invalid';
  }
  return errs;
}

/** Filter config entries the category screen understands (parseFilterConfig in features/filters). */
export type FilterEntry =
  | { type: 'brand' }
  | { type: 'veg'; quick?: boolean }
  | { type: 'in_stock'; quick?: boolean }
  | { type: 'price'; buckets: number[] }
  | { type: 'attribute'; key: string; quick?: boolean };

/** "0, 50, 100" → [0, 50, 100] (sorted, unique, non-negative). */
export function parseBuckets(text: string): number[] {
  const nums = text
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export type HoursRange = { open: string; close: string };

/** "07:00-13:00, 16:00-22:30" ⇄ [{open,close}, …]; empty = closed all day. */
export const hoursToText = (ranges: HoursRange[] | undefined) =>
  (ranges ?? []).map((r) => `${r.open}-${r.close}`).join(', ');
export function textToHours(text: string): HoursRange[] | null {
  if (!text.trim()) return [];
  const out: HoursRange[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/.exec(part);
    if (!m) return null;
    out.push({ open: `${m[1]}:${m[2]}`, close: `${m[3]}:${m[4]}` });
  }
  return out;
}

/** "444601, 444602 444603" → sorted unique valid pincodes + the invalid entries. */
export function parsePincodes(text: string): { ok: string[]; bad: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ok = [...new Set(parts.filter((p) => /^[1-9]\d{5}$/.test(p)))].sort();
  const bad = parts.filter((p) => !/^[1-9]\d{5}$/.test(p));
  return { ok, bad };
}
