import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { discountPercent, formatPrice } from '@/lib/format';
import { spacing } from '@/theme/tokens';

import { Text } from './Text';

export type PriceTagProps = {
  price: number;
  mrp?: number | null;
  size?: 'sm' | 'md';
  /** The card already shows a discount ribbon. */
  hideDiscount?: boolean;
  stacked?: boolean;
};

/** ₹price, with struck-through MRP and "12% OFF" only when there is a real discount. */
export function PriceTag({ price, mrp, size = 'sm', hideDiscount, stacked }: PriceTagProps) {
  const { t } = useTranslation();
  const pct = mrp ? discountPercent(price, mrp) : 0;
  const a11y = pct
    ? `${formatPrice(price)}, ${t('price.mrp', { price: formatPrice(mrp!) })}, ${t('price.off', { percent: pct })}`
    : formatPrice(price);

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={
        stacked
          ? { justifyContent: 'center', gap: 1 }
          : { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.xs }
      }
    >
      <Text
        variant={size === 'sm' ? 'body' : 'title'}
        weight="bold"
        numberOfLines={1}
        testID="price"
      >
        {formatPrice(price)}
      </Text>
      {pct > 0 ? (
        <>
          <Text
            variant="caption"
            color="textMuted"
            strike
            numberOfLines={1}
            testID="mrp"
          >
            {formatPrice(mrp!)}
          </Text>
          {hideDiscount ? null : (
            <Text
              variant="caption"
              weight="bold"
              color="discount"
              numberOfLines={1}
              testID="discount"
            >
              {t('price.off', { percent: pct })}
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
}
