import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';
import { EmptyState, Screen, ScreenHeader } from '@/ui';

import { useAuth } from './store';
import { openLogin, type LoginReason } from './useRequireLogin';
import { layout } from '@/theme/tokens';

/**
 * Wrap a screen that needs a logged-in user. Children (and their queries) only mount once
 * logged in, so deep links / refreshes on web never fire RLS-denied requests.
 */
export function LoginRequired({
  reason = 'generic',
  title,
  children,
}: {
  reason?: LoginReason;
  /** Header title shown on the login prompt. */
  title?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ready = useAuth((s) => s.ready);
  const loggedIn = useAuth((s) => !!s.session);

  if (loggedIn) return <>{children}</>;

  return (
    <Screen maxWidth={layout.readableMax} padded={false}>
      <ScreenHeader title={title} />
      {!ready ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <EmptyState
          icon="account-lock-outline"
          title={t(`auth.reason.${reason}`)}
          message={t('auth.loginRequiredBody')}
          action={{ label: t('account.login'), onPress: () => openLogin(reason) }}
        />
      )}
    </Screen>
  );
}

/** Route helper: `export default withLogin(MyScreen, 'addresses', 'address.title')`. */
export function withLogin<P extends object>(
  Component: (props: P) => ReactNode,
  reason: LoginReason,
  titleKey?: string,
) {
  function Guarded(props: P) {
    const { t } = useTranslation();
    return (
      <LoginRequired reason={reason} title={titleKey ? t(titleKey as never) : undefined}>
        <Component {...props} />
      </LoginRequired>
    );
  }
  Guarded.displayName = `withLogin(${Component.name || 'Screen'})`;
  return Guarded;
}
