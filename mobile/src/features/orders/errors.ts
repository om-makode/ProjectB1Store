import i18n from '@/i18n';
import { toAppError } from '@/lib/errors';

/** Machine codes raised by the Phase 5 RPCs (cancel_order, report_order_issue, reorder_to_cart). */
const CODES = [
  'CANCEL_NOT_ALLOWED',
  'ORDER_FINAL',
  'ORDER_NOT_FOUND',
  'INVALID_REASON',
  'ISSUE_WINDOW_CLOSED',
  'ISSUE_LIMIT',
  'PHOTO_REQUIRED',
  'INVALID_PHOTO_PATH',
] as const;

export type OrderActionCode = (typeof CODES)[number];

export function orderActionCode(e: unknown): OrderActionCode | null {
  const msg = toAppError(e).message;
  return CODES.find((c) => msg.includes(c)) ?? null;
}

/** Friendly, localized message for a failed order action. */
export function orderActionMessage(e: unknown): string {
  const code = orderActionCode(e);
  if (code) return i18n.t(`orderErrors.${code}`);
  return toAppError(e).kind === 'network' ? i18n.t('errors.network') : i18n.t('errors.server');
}
