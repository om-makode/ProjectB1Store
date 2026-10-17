import { router } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { Badge, Card, Text, type BadgeTone } from '@/ui';

import type { OrderListItem, OrderStatus } from '../api';

export const statusTone = (s: OrderStatus): BadgeTone =>
  s === 'cancelled'
    ? 'danger'
    : s === 'delivered'
      ? 'success'
      : s === 'awaiting_payment'
        ? 'warning'
        : 'info';

export function OrderListCard({ order }: { order: OrderListItem }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const l = useLocalize();
  const count = order.order_items.reduce((s, i) => s + i.quantity, 0);
  const names = order.order_items
    .slice(0, 3)
    .map((i) => l(asLocalized(i.name_snapshot)))
    .join(', ');
  const status = t(`order.status.${order.status}` as 'order.status.placed');

  return (
    <Card
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
      accessibilityLabel={`${order.order_number}, ${status}, ${formatPrice(Number(order.grand_total))}`}
    >
      <View style={{ gap: spacing.sm }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text weight="semibold">{order.order_number}</Text>
          <Badge label={status} tone={statusTone(order.status)} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {order.order_items.slice(0, 4).map((i, idx) => (
            <ProductImage
              key={idx}
              path={i.image_path}
              name={l(asLocalized(i.name_snapshot))}
              size={44}
            />
          ))}
        </View>
        <Text color="textMuted" numberOfLines={1}>
          {names}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color="textMuted">
            {order.placed_at ? formatDateTime(order.placed_at, lang) : ''} ·{' '}
            {t('orders.items', { count })}
          </Text>
          <Text weight="semibold">{formatPrice(Number(order.grand_total))}</Text>
        </View>
      </View>
    </Card>
  );
}
