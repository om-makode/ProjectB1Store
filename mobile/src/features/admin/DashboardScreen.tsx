import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useLocalize, asLocalized } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { ErrorState, Skeleton, Text } from '@/ui';

import { REPORTS, type ReportName } from './api';
import { AdminShell, Section } from './components';
import { useDashboard, useReport } from './hooks';

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

function Tile({
  label,
  value,
  icon,
  tone,
  accent = 'primary',
  onPress,
}: {
  label: string;
  value: string;
  icon: Icon;
  /** Alert colour when the number needs attention. */
  tone?: 'danger' | 'warning';
  accent?: 'primary' | 'info' | 'success' | 'discount' | 'warning' | 'danger';
  onPress?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const c = colors[tone ?? accent];
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 190,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderWidth: tone ? 1.5 : isDark ? 1 : 0,
        borderColor: tone ? c : colors.border,
        shadowColor: '#000',
        shadowOpacity: isDark ? 0 : 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: isDark ? 0 : 1,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={icon} size={24} color={c} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="h2" weight="bold" color={tone ?? 'text'} numberOfLines={1}>
          {value}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {label}
        </Text>
      </View>
      {onPress ? (
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const openReport = (name: ReportName) => router.push(`/admin/reports/${name}` as Href);

export function DashboardScreen() {
  const { t } = useTranslation();
  const l = useLocalize();
  const d = useDashboard();
  const low = useReport('v_low_stock', 5);
  const zero = useReport('v_zero_result_searches', 5);
  const top = useReport('v_top_products', 5);

  return (
    <AdminShell title={t('admin.title')} subtitle={t('admin.ui.dashSubtitle')}>
      <Text variant="title" weight="bold">
        {t('admin.dash.today')}
      </Text>
      {d.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : d.error ? (
        <ErrorState error={d.error} onRetry={() => void d.refetch()} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <Tile
            icon="receipt-text-outline"
            accent="info"
            label={t('admin.dash.orders')}
            value={String(d.data.orders)}
            onPress={() => router.push('/store')}
          />
          <Tile
            icon="cash-multiple"
            label={t('admin.dash.orderValue')}
            value={formatPrice(d.data.order_value)}
          />
          <Tile
            icon="check-decagram-outline"
            accent="success"
            label={t('admin.dash.delivered')}
            value={formatPrice(d.data.delivered_revenue)}
          />
          <Tile
            icon="cart-outline"
            accent="discount"
            label={t('admin.dash.aov')}
            value={formatPrice(d.data.avg_order_value)}
          />
          <Tile
            icon="progress-clock"
            accent="info"
            label={t('admin.dash.inProgress')}
            value={String(d.data.in_progress)}
          />
          <Tile
            icon="close-circle-outline"
            label={t('admin.dash.cancelled')}
            value={String(d.data.cancelled)}
            tone={d.data.cancelled > 0 ? 'warning' : undefined}
            onPress={() => openReport('v_cancellations')}
          />
          <Tile
            icon="account-plus-outline"
            accent="success"
            label={t('admin.dash.newCustomers')}
            value={String(d.data.new_customers)}
          />
          <Tile
            icon="package-variant"
            label={t('admin.dash.lowStock')}
            value={String(d.data.low_stock)}
            tone={d.data.low_stock > 0 ? 'danger' : undefined}
            onPress={() => openReport('v_low_stock')}
          />
          <Tile
            icon="alert-circle-outline"
            label={t('admin.dash.openIssues')}
            value={String(d.data.open_issues)}
            tone={d.data.open_issues > 0 ? 'warning' : undefined}
            onPress={() => router.push('/store/issues')}
          />
          <Tile
            icon="magnify-close"
            accent="discount"
            label={t('admin.dash.zeroResults')}
            value={String(d.data.zero_result_searches_7d)}
            onPress={() => openReport('v_zero_result_searches')}
          />
        </View>
      )}

      <Section
        icon="package-variant"
        title={t('admin.reports.v_low_stock')}
        right={<SeeAll name="v_low_stock" />}
      >
        {(low.data ?? []).length === 0 ? (
          <Text color="textMuted">{t('admin.dash.nothing')}</Text>
        ) : (
          (low.data ?? []).map((r) => (
            <Row
              key={`${r.store_id}-${r.variant_id}`}
              left={`${l(asLocalized(r.name))} · ${l(asLocalized(r.label))}`}
              right={t('admin.dash.stockLeft', { count: r.stock ?? 0 })}
              danger={(r.stock ?? 0) === 0}
            />
          ))
        )}
      </Section>

      <Section
        icon="magnify-close"
        title={t('admin.reports.v_zero_result_searches')}
        right={<SeeAll name="v_zero_result_searches" />}
      >
        <Text variant="caption" color="textMuted">
          {t('admin.dash.zeroHint')}
        </Text>
        {(zero.data ?? []).length === 0 ? (
          <Text color="textMuted">{t('admin.dash.nothing')}</Text>
        ) : (
          (zero.data ?? []).map((r) => (
            <Row
              key={r.query ?? ''}
              left={`“${r.query ?? ''}”`}
              right={t('admin.dash.times', { count: r.searches ?? 0 })}
            />
          ))
        )}
      </Section>

      <Section
        icon="trophy-outline"
        title={t('admin.reports.v_top_products')}
        right={<SeeAll name="v_top_products" />}
      >
        {(top.data ?? []).length === 0 ? (
          <Text color="textMuted">{t('admin.dash.nothing')}</Text>
        ) : (
          (top.data ?? []).map((r) => (
            <Row
              key={r.product_id ?? 0}
              left={l(asLocalized(r.name))}
              right={`${r.units ?? 0} · ${formatPrice(Number(r.revenue ?? 0))}`}
            />
          ))
        )}
      </Section>

      <Section icon="chart-box-outline" title={t('admin.reports.title')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {REPORTS.map((name) => (
            <ReportLink key={name} name={name} />
          ))}
        </View>
      </Section>
    </AdminShell>
  );
}

function ReportLink({ name }: { name: ReportName }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => openReport(name)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        minHeight: 40,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      <MaterialCommunityIcons name="chart-line" size={16} color={colors.primary} />
      <Text weight="semibold" color="primary">
        {t(`admin.reports.${name}`)}
      </Text>
    </Pressable>
  );
}

function SeeAll({ name }: { name: ReportName }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityRole="link" onPress={() => openReport(name)}>
      <Text color="primary" weight="semibold">
        {t('admin.seeAll')}
      </Text>
    </Pressable>
  );
}

function Row({ left, right, danger }: { left: string; right: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ flex: 1 }} numberOfLines={1}>
        {left}
      </Text>
      <Text weight="semibold" color={danger ? 'danger' : 'text'}>
        {right}
      </Text>
    </View>
  );
}
