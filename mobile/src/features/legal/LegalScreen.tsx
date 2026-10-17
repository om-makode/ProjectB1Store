import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAppConfig, type AppConfig } from '@/features/config/hooks';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { layout, spacing } from '@/theme/tokens';
import { Button, Card, Screen, ScreenHeader, Skeleton, Text } from '@/ui';

import { useSellerInfo } from './hooks';

const POLICIES = ['privacy', 'terms', 'refunds'] as const;

const str = (config: AppConfig | undefined, key: string, field: string): string => {
  const v = config?.[key];
  const s =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)[field]
      : undefined;
  return typeof s === 'string' ? s.trim() : '';
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text selectable>{value}</Text>
    </View>
  );
}

/** Seller details + policies (Phase 9.8). Full policy pages live on the website (web/public). */
export function LegalScreen() {
  const { t } = useTranslation();
  const l = useLocalize();
  const seller = useSellerInfo();
  const config = useAppConfig().data;
  const s = seller.data;
  const supportEmail = str(config, 'support', 'email');
  const grievanceUrl = str(config, 'legal_urls', 'grievance');

  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={t('legal.title')} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text variant="title" accessibilityRole="header">
          {t('legal.sellerTitle')}
        </Text>
        <Card>
          {seller.isPending ? (
            <Skeleton width="100%" height={120} />
          ) : s ? (
            <View style={{ gap: spacing.md }}>
              <Row label={t('legal.sellerName')} value={l(asLocalized(s.name))} />
              <Row label={t('legal.sellerAddress')} value={l(asLocalized(s.address))} />
              <Row label={t('legal.phone')} value={s.phone} />
              <Row label="GSTIN" value={s.gstin} />
              <Row label={t('legal.fssai')} value={s.fssai_license} />
            </View>
          ) : (
            <Text color="textMuted">{t('errors.server')}</Text>
          )}
        </Card>

        <Text variant="title" accessibilityRole="header">
          {t('legal.grievanceTitle')}
        </Text>
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text color="textMuted">{t('legal.grievanceBody')}</Text>
            {supportEmail ? (
              <Button
                title={supportEmail}
                icon="email-outline"
                variant="secondary"
                onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
              />
            ) : null}
            {grievanceUrl ? (
              <Button
                title={t('legal.readMore')}
                variant="ghost"
                onPress={() => void Linking.openURL(grievanceUrl)}
              />
            ) : null}
          </View>
        </Card>

        {POLICIES.map((p) => {
          const url = str(config, 'legal_urls', p);
          return (
            <Card key={p}>
              <View style={{ gap: spacing.sm }}>
                <Text weight="semibold" accessibilityRole="header">
                  {t(`legal.${p}Title`)}
                </Text>
                <Text color="textMuted">{t(`legal.${p}Summary`)}</Text>
                {url ? (
                  <Button
                    title={t('legal.readMore')}
                    variant="ghost"
                    onPress={() => void Linking.openURL(url)}
                  />
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
