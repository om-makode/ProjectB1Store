import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { useSettings } from '@/stores/settings';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Chip, EmptyState, ErrorState, Skeleton, Text } from '@/ui';

import { REPORTS, type ReportName } from './api';
import { AdminShell } from './components';
import { useReport } from './hooks';

type Col = { key: string; kind?: 'money' | 'loc' | 'date' | 'list' | 'num' };

/** Which view columns to show, in order (all views are admin-only, security_invoker). */
const COLUMNS: Record<ReportName, Col[]> = {
  v_sales_daily: [
    { key: 'day' },
    { key: 'orders', kind: 'num' },
    { key: 'cancelled', kind: 'num' },
    { key: 'order_value', kind: 'money' },
    { key: 'delivered_revenue', kind: 'money' },
    { key: 'avg_order_value', kind: 'money' },
    { key: 'customers', kind: 'num' },
  ],
  v_top_products: [
    { key: 'name', kind: 'loc' },
    { key: 'units', kind: 'num' },
    { key: 'orders', kind: 'num' },
    { key: 'revenue', kind: 'money' },
  ],
  v_low_stock: [
    { key: 'name', kind: 'loc' },
    { key: 'label', kind: 'loc' },
    { key: 'sku' },
    { key: 'stock', kind: 'num' },
    { key: 'low_stock_threshold', kind: 'num' },
    { key: 'sold_7d', kind: 'num' },
    { key: 'days_of_cover', kind: 'num' },
  ],
  v_zero_result_searches: [
    { key: 'query' },
    { key: 'searches', kind: 'num' },
    { key: 'users', kind: 'num' },
    { key: 'languages', kind: 'list' },
    { key: 'last_searched_at', kind: 'date' },
  ],
  v_cancellations: [
    { key: 'cancelled_by' },
    { key: 'reason' },
    { key: 'orders', kind: 'num' },
    { key: 'value', kind: 'money' },
    { key: 'last_at', kind: 'date' },
  ],
  v_payments_daily: [
    { key: 'day' },
    { key: 'payments_captured', kind: 'num' },
    { key: 'amount_captured', kind: 'money' },
    { key: 'payments_failed', kind: 'num' },
    { key: 'amount_refunded', kind: 'money' },
  ],
};

export const isReportName = (s: string | undefined): s is ReportName =>
  !!s && (REPORTS as readonly string[]).includes(s);

export function ReportScreen({ name }: { name: ReportName }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const lang = useSettings((s) => s.language);
  const q = useReport(name, 200);
  const cols = COLUMNS[name];

  const cell = (row: Record<string, unknown>, c: Col): string => {
    const v = row[c.key];
    if (v === null || v === undefined) return '—';
    switch (c.kind) {
      case 'money':
        return formatPrice(Number(v));
      case 'loc':
        return l(asLocalized(v));
      case 'date':
        return formatDateTime(String(v), lang);
      case 'list':
        return Array.isArray(v) ? v.join(', ') : String(v);
      default:
        return String(v);
    }
  };

  return (
    <AdminShell
      title={t(`admin.reports.${name}`)}
      subtitle={t(`admin.reports.${name}_hint`)}
      scroll={false}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {REPORTS.map((r) => (
          <Chip
            key={r}
            label={t(`admin.reports.${r}`)}
            selected={r === name}
            onPress={() => router.replace(`/admin/reports/${r}` as Href)}
          />
        ))}
      </View>
      {q.isPending ? (
        <Skeleton width="100%" height={240} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="chart-box-outline" title={t('admin.dash.nothing')} />
      ) : (
        <View
          style={{
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            flexShrink: 1,
          }}
        >
          <ScrollView horizontal style={{ flexGrow: 0 }}>
            <ScrollView style={{ maxHeight: 640 }} stickyHeaderIndices={[0]}>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: colors.surfaceAlt,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                {cols.map((c) => (
                  <Text
                    key={c.key}
                    variant="caption"
                    weight="bold"
                    color="textMuted"
                    align={c.kind === 'money' || c.kind === 'num' ? 'right' : 'left'}
                    style={{
                      width: 160,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t(`admin.cols.${c.key}` as 'admin.cols.day')}
                  </Text>
                ))}
              </View>
              {(q.data as Record<string, unknown>[]).map((row, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    backgroundColor: i % 2 ? colors.background : colors.surface,
                  }}
                >
                  {cols.map((c) => (
                    <Text
                      key={c.key}
                      align={c.kind === 'money' || c.kind === 'num' ? 'right' : 'left'}
                      weight={c.kind === 'money' ? 'semibold' : undefined}
                      style={{
                        width: 160,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                      numberOfLines={2}
                    >
                      {cell(row, c)}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          </ScrollView>
        </View>
      )}
    </AdminShell>
  );
}
