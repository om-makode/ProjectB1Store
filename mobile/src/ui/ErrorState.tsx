import { useTranslation } from 'react-i18next';

import { toAppError, type AppErrorKind } from '@/lib/errors';

import { EmptyState } from './EmptyState';

const messageKey = {
  config: 'errors.config',
  network: 'errors.network',
  unauthorized: 'errors.forbidden',
  forbidden: 'errors.forbidden',
  notFound: 'errors.notFound',
  validation: 'errors.server',
  conflict: 'errors.server',
  server: 'errors.server',
} as const satisfies Record<AppErrorKind, string>;

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const e = toAppError(error);
  return (
    <EmptyState
      icon={
        e.kind === 'network' ? 'wifi-off' : e.kind === 'config' ? 'cog-off' : 'alert-circle-outline'
      }
      title={t('errors.title')}
      // In dev builds, show the underlying error so problems can be diagnosed from the screen.
      message={
        __DEV__ ? `${t(messageKey[e.kind])}\n\n[${e.kind}] ${e.message}` : t(messageKey[e.kind])
      }
      action={onRetry ? { label: t('common.retry'), onPress: onRetry } : undefined}
    />
  );
}
