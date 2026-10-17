import { Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Card, ErrorState, ScreenHeader, showToast, Skeleton, Text } from '@/ui';

import { DEFAULT_PREFS, type NotificationPrefs } from './api';
import { useNotificationPrefs, useSaveNotificationPrefs } from './hooks';

export function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const prefs = q.data ?? DEFAULT_PREFS;

  const set = (patch: Partial<NotificationPrefs>) =>
    save.mutate({ ...prefs, ...patch }, { onError: () => showToast(t('errors.server'), 'danger') });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={t('notifSettings.title')} />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.md,
          gap: spacing.md,
        }}
      >
        {q.isPending ? (
          <Skeleton width="100%" height={160} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Card style={{ gap: spacing.md }}>
            <PrefRow
              label={t('notifSettings.orders')}
              hint={t('notifSettings.ordersHint')}
              value
              disabled
            />
            <PrefRow
              label={t('notifSettings.offers')}
              hint={t('notifSettings.offersHint')}
              value={prefs.offers}
              onChange={(v) => set({ offers: v })}
            />
            <PrefRow
              label={t('notifSettings.reviews')}
              hint={t('notifSettings.reviewsHint')}
              value={prefs.review_prompts}
              onChange={(v) => set({ review_prompts: v })}
            />
          </Card>
        )}
        <Text variant="caption" color="textMuted">
          {t('notifSettings.quietHours')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('notifSettings.stockAlerts')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function PrefRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{label}</Text>
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}
