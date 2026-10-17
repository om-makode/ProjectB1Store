import i18n from '@/i18n';
import { toAppError } from '@/lib/errors';

const CODES = [
  'FORBIDDEN',
  'ORDER_NOT_FOUND',
  'ORDER_LOCKED',
  'ORDER_NOT_ACCEPTED',
  'ITEMS_NOT_PICKED',
  'INVALID_TRANSITION',
  'ITEM_UNAVAILABLE',
  'ORDER_FINAL',
  'STOCK_NEGATIVE',
  'INVALID_QUANTITY',
  'INVALID_ETA',
  'INVALID_REASON',
] as const;
export type StaffErrorCode = (typeof CODES)[number];

/** Our staff RPCs raise a bare code (e.g. 'ORDER_LOCKED'); find it in the error message. */
export function staffErrorCode(e: unknown): StaffErrorCode | null {
  const msg = toAppError(e).message;
  return CODES.find((c) => msg.includes(c)) ?? null;
}

export function staffErrorMessage(e: unknown): string {
  const err = toAppError(e);
  if (err.kind === 'network') return i18n.t('errors.network');
  if (err.message.includes('POPUP_BLOCKED')) return i18n.t('storeOps.popupBlocked');
  const code = staffErrorCode(e);
  return code ? i18n.t(`storeOps.errors.${code}`) : i18n.t('storeOps.errors.generic');
}
