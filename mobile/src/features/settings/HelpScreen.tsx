import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useStoreStatus } from '@/features/catalog/hooks';
import { useLocalize } from '@/i18n/localize';
import { layout, spacing } from '@/theme/tokens';
import { Button, Card, Screen, ScreenHeader, Text } from '@/ui';

const FAQ = [
  ['help.faqPayQ', 'help.faqPayA'],
  ['help.faqCancelQ', 'help.faqCancelA'],
] as const;

export function HelpScreen() {
  const { t } = useTranslation();
  const l = useLocalize();
  const store = useStoreStatus().data;

  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={t('help.title')} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        {store ? (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <Text variant="caption" color="textMuted">
                {t('help.seller')}
              </Text>
              <Text variant="title">{l(store.name)}</Text>
              {store.city ? <Text color="textMuted">{store.city}</Text> : null}
              {store.phone ? (
                <Button
                  title={`${t('help.callStore')} · ${store.phone}`}
                  icon="phone"
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${store.phone}`)}
                />
              ) : null}
            </View>
          </Card>
        ) : null}

        <Text variant="title" accessibilityRole="header">
          {t('help.faqTitle')}
        </Text>
        {FAQ.map(([q, a]) => (
          <Card key={q}>
            <View style={{ gap: spacing.xs }}>
              <Text weight="semibold">{t(q)}</Text>
              <Text color="textMuted">{t(a)}</Text>
            </View>
          </Card>
        ))}
        <Button
          title={t('legal.title')}
          icon="scale-balance"
          variant="secondary"
          onPress={() => router.push('/account/legal')}
        />
      </View>
    </Screen>
  );
}
