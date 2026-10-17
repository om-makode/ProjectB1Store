import type { TFunction } from 'i18next';

import { toAppError } from '@/lib/errors';

export function locationErrorText(e: unknown, t: TFunction): string {
  const err = toAppError(e);
  if (err.code === 'LOCATION_DENIED') return t('location.denied');
  if (err.code === 'LOCATION_UNAVAILABLE') return t('location.unavailable');
  if (err.kind === 'network') return t('errors.network');
  return t('location.error');
}
