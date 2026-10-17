import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import { useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { radius, spacing, type ColorName } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Card, PriceTag, ProgressBar, Stepper, Text, VegMark } from '@/ui';

import type { Blocker, Quote, QuoteLine } from './api';
import { CHECKOUT_STEP_BLOCKERS } from './orderErrors';
import { useGuestCart } from './store';
import { cart } from './sync';

/** One line with live flags from the quote. */
export function QuoteLineRow({ line, editable = true }: { line: QuoteLine; editable?: boolean }) {
  const { t } = useTranslation();
  const l = useLocalize();
  // Quantity comes from the instant local cart; the quote can lag a moment behind taps.
  const localQty = useGuestCart((s) => s.lines[line.variant_id]?.qty ?? 0);
  const name = l(line.name);
  const out = line.flags.includes('out_of_stock');
  const cap = Math.min(line.max_per_order, 50);
  const max = out ? 0 : line.stock_left != null ? Math.min(line.stock_left, cap) : cap;
  if (editable && localQty === 0) return null; // just removed
  const qty = editable ? localQty : line.billable_quantity;

  const notes: { text: string; color: ColorName }[] = [];
  if (out) notes.push({ text: t('checkout.flag.outOfStock'), color: 'danger' });
  else if (line.flags.includes('low_stock'))
    notes.push({
      text: t('checkout.flag.lowStock', { count: line.billable_quantity }),
      color: 'warning',
    });
  if (line.flags.includes('over_limit'))
    notes.push({ text: t('cart.maxPerOrder', { max: line.max_per_order }), color: 'warning' });
  if (line.flags.includes('price_changed') && line.price_at_add != null)
    notes.push({
      text: t('checkout.flag.priceChanged', {
        from: formatPrice(line.price_at_add),
        to: formatPrice(line.price),
      }),
      color: 'info',
    });

  return (
    <View
      testID={`cart-line-${line.variant_id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        opacity: out ? 0.6 : 1,
      }}
    >
      <ProductImage path={line.image_path} name={name} size={56} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <VegMark isVeg={line.is_veg} size={12} />
          <Text weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
            {name}
          </Text>
        </View>
        <Text variant="caption" color="textMuted">
          {l(line.variant_label)}
        </Text>
        <PriceTag
          price={line.price * Math.max(qty, 1)}
          mrp={line.mrp > line.price ? line.mrp * Math.max(qty, 1) : null}
          hideDiscount
        />
        {notes.map((n) => (
          <Text key={n.text} variant="caption" weight="semibold" color={n.color}>
            {n.text}
          </Text>
        ))}
      </View>
      {editable ? (
        out ? (
          <Button
            title={t('checkout.remove')}
            variant="ghost"
            onPress={() => cart.setQty(line.variant_id, 0)}
          />
        ) : (
          <Stepper
            quantity={qty}
            max={max}
            onAdd={() => cart.increment(line.variant_id, max)}
            onIncrement={() => cart.increment(line.variant_id, max)}
            onDecrement={() => cart.decrement(line.variant_id)}
          />
        )
      ) : (
        <Text weight="semibold">×{line.billable_quantity}</Text>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  strike,
  bold,
  color,
  icon,
}: {
  label: string;
  value: string;
  strike?: string | null;
  bold?: boolean;
  color?: ColorName;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={colors.textMuted} /> : null}
      <Text
        weight={bold ? 'bold' : 'regular'}
        variant={bold ? 'bodyLg' : 'body'}
        color={color}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'baseline' }}>
        {strike ? (
          <Text variant="caption" color="textMuted" style={{ textDecorationLine: 'line-through' }}>
            {strike}
          </Text>
        ) : null}
        <Text weight={bold ? 'bold' : 'semibold'} variant={bold ? 'bodyLg' : 'body'} color={color}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** Bill details exactly as the server computed them. */
export function BillDetails({ quote }: { quote: Quote }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const free = t('checkout.free');
  return (
    <Card style={{ gap: spacing.md }}>
      <Text variant="title" weight="bold">
        {t('checkout.billDetails')}
      </Text>
      <Row
        icon="receipt-text-outline"
        label={t('cart.itemTotal')}
        value={formatPrice(quote.item_total)}
        strike={quote.mrp_total > quote.item_total ? formatPrice(quote.mrp_total) : null}
      />
      <Row
        icon="moped-outline"
        label={t('checkout.deliveryFee')}
        value={quote.delivery_fee > 0 ? formatPrice(quote.delivery_fee) : free}
        strike={quote.delivery_fee_waived > 0 ? formatPrice(quote.delivery_fee_waived) : null}
        color={quote.delivery_fee > 0 ? undefined : 'success'}
      />
      {quote.small_cart_fee > 0 ? (
        <Row
          icon="basket-outline"
          label={t('checkout.smallCartFee', {
            amount: formatPrice(quote.small_cart_threshold ?? 0),
          })}
          value={formatPrice(quote.small_cart_fee)}
        />
      ) : null}
      {quote.packaging_fee > 0 ? (
        <Row
          icon="package-variant"
          label={t('checkout.packagingFee')}
          value={formatPrice(quote.packaging_fee)}
        />
      ) : null}
      <View
        style={{
          borderTopWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.border,
          marginVertical: spacing.xs,
        }}
      />
      <Row label={t('checkout.grandTotal')} value={formatPrice(quote.grand_total)} bold />
      {quote.savings > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            backgroundColor: colors.primarySoft,
            borderRadius: radius.md,
            padding: spacing.sm,
            marginTop: spacing.xs,
          }}
        >
          <MaterialCommunityIcons name="tag-heart" size={18} color={colors.primary} />
          <Text color="primary" weight="bold" align="center">
            {t('checkout.totalSavings', { amount: formatPrice(quote.savings) })}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** "Add ₹55 more for FREE delivery" nudge with progress; "FREE delivery unlocked" once reached. */
export function FreeDeliveryHint({ quote }: { quote: Quote }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const need = quote.add_for_free_delivery;
  if (!quote.free_delivery_above) return null;
  const unlocked = !need || need <= 0;
  if (unlocked && quote.delivery_fee_waived <= 0) return null;
  const pct = Math.min(1, quote.item_total / quote.free_delivery_above);
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySoft,
          }}
        >
          <MaterialCommunityIcons
            name={unlocked ? 'check-decagram' : 'moped'}
            size={20}
            color={colors.primary}
          />
        </View>
        <Text weight="semibold" style={{ flex: 1 }}>
          {unlocked
            ? t('cart.freeDeliveryUnlocked')
            : t('checkout.addForFreeDelivery', { amount: formatPrice(need!) })}
        </Text>
      </View>
      {unlocked ? null : (
        <ProgressBar value={pct} accessibilityLabel={t('cart.freeDeliveryProgress')} />
      )}
    </Card>
  );
}

/** Problems that stop checkout, in plain words. */
export function BlockerList({
  blockers,
  skipCheckoutStep = false,
}: {
  blockers: Blocker[];
  skipCheckoutStep?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const shown = blockers.filter(
    (b) => !(skipCheckoutStep && CHECKOUT_STEP_BLOCKERS.has(b.code)) && b.code !== 'CART_EMPTY',
  );
  if (shown.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {shown.map((b) => {
        let text = i18n.exists(`orderErrors.${b.code}`)
          ? t(`orderErrors.${b.code}` as 'orderErrors.UNKNOWN')
          : t('orderErrors.UNKNOWN');
        if (b.code === 'BELOW_MIN_ORDER' && b.amount_needed != null)
          text = t('checkout.belowMin', {
            amount: formatPrice(b.amount_needed),
            min: formatPrice(b.min_order_value ?? 0),
          });
        if (b.code === 'STORE_CLOSED' && b.message) text = `${text} ${l(b.message)}`;
        return (
          <View
            key={b.code}
            testID={`blocker-${b.code}`}
            style={{
              flexDirection: 'row',
              gap: spacing.sm,
              alignItems: 'flex-start',
              padding: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: `${colors.warning}55`,
              backgroundColor: colors.warningSoft,
            }}
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.warning} />
            <Text style={{ flex: 1 }}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

export const needsReview = (q: Quote | undefined) =>
  !!q && q.lines.some((l) => l.flags.length > 0 || l.billable_quantity !== l.quantity);
