import type { Lang } from '@/i18n';

const localeOf = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' } as const;

/** Indian digit grouping: 1,00,000 (works even where Intl lacks en-IN data). */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** ₹1,00,000 ; paise shown only when non-zero (₹42.50). Latin digits, as on price stickers. */
export function formatPrice(n: number): string {
  const negative = n < 0;
  const abs = Math.abs(n);
  const hasPaise = Math.round(abs * 100) % 100 !== 0;
  const [int = '0', frac] = abs.toFixed(hasPaise ? 2 : 0).split('.');
  return `${negative ? '-' : ''}₹${groupIndian(int)}${frac ? `.${frac}` : ''}`;
}

/** Whole-percent discount, rounded down; 0 when there is no discount. */
export const discountPercent = (price: number, mrp: number) =>
  mrp > 0 && mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0;

/** 500 g, 1 kg, 1.5 l, 6 pc */
export const formatQuantity = (q: number, unit: string) => `${q} ${unit}`;

export const formatDateTime = (d: Date | string, lang: Lang) =>
  new Intl.DateTimeFormat(localeOf[lang], {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
    numberingSystem: 'latn',
  }).format(new Date(d));
