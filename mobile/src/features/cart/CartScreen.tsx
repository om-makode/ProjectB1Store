import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useIsLoggedIn } from '@/features/auth/store';
import { openLogin } from '@/features/auth/useRequireLogin';
import { useDeliveryLocation } from '@/features/location/store';
import { formatPrice } from '@/lib/format';
import { useStoreStatus } from '@/features/catalog/hooks';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  Skeleton,
  StickyBottomBar,
  Text,
} from '@/ui';

import {
  BillDetails,
  BlockerList,
  FreeDeliveryHint,
  QuoteLineRow,
  needsReview,
} from './components';
import { useCartQuote, useFixCart } from './hooks';
import { CHECKOUT_STEP_BLOCKERS } from './orderErrors';
import { useGuestCart } from './store';

/** Server-quoted cart: live prices/stock, fees, problems, then checkout. */
export function CartScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const loggedIn = useIsLoggedIn();
  const location = useDeliveryLocation((s) => s.location);
  const count = useGuestCart((s) => Object.values(s.lines).reduce((n, l) => n + l.qty, 0));
  const addressId = location?.source === 'address' ? location.addressId : null;
  const quote = useCartQuote({ addressId });
  const fix = useFixCart();
  const store = useStoreStatus();
  const q = quote.data;

  const cartBlockers = (q?.blockers ?? []).filter(
    (b) => !CHECKOUT_STEP_BLOCKERS.has(b.code) && b.code !== 'CART_EMPTY',
  );
  const canProceed = !!q && q.item_count > 0 && cartBlockers.length === 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        title={t('cart.title')}
        subtitle={count ? t('cart.items', { count }) : undefined}
      />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {count === 0 ? (
          <EmptyState
            icon="cart-outline"
            title={t('cart.empty')}
            message={t('cart.emptyMessage')}
            action={{ label: t('cart.startShopping'), onPress: () => router.dismissTo('/') }}
          />
        ) : !q && quote.isPending ? (
          <View style={{ padding: spacing.md, gap: spacing.md }}>
            <Skeleton width="100%" height={180} />
            <Skeleton width="100%" height={140} />
          </View>
        ) : !q ? (
          <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
        ) : (
          <>
            <ScrollView
              contentContainerStyle={{
                padding: spacing.md,
                gap: spacing.md,
                width: '100%',
                maxWidth: layout.readableMax,
                alignSelf: 'center',
              }}
            >
              {q.savings > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.lg,
                    backgroundColor: colors.primarySoft,
                  }}
                >
                  <MaterialCommunityIcons
                    name="piggy-bank-outline"
                    size={22}
                    color={colors.primary}
                  />
                  <Text weight="bold" color="primary" style={{ flex: 1 }}>
                    {t('cart.savedBanner', { amount: formatPrice(q.savings) })}
                  </Text>
                </View>
              ) : null}

              {location && !location.serviceable ? (
                <Card>
                  <Text color="danger" weight="semibold">
                    {t('orderErrors.NOT_SERVICEABLE')}
                  </Text>
                </Card>
              ) : null}

              {needsReview(q) ? (
                <Card style={{ gap: spacing.sm }}>
                  <Text weight="semibold">{t('checkout.reviewTitle')}</Text>
                  <Text color="textMuted">{t('checkout.reviewMessage')}</Text>
                  <Button
                    testID="fix-cart"
                    title={t('checkout.updateCart')}
                    variant="secondary"
                    loading={fix.isPending}
                    onPress={() => fix.mutate(q)}
                  />
                </Card>
              ) : null}

              <Card style={{ gap: spacing.lg }}>
                {store.data?.is_open && (store.data?.eta_minutes ?? 0) > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.accentSoft,
                      }}
                    >
                      <MaterialCommunityIcons name="timer-outline" size={22} color={colors.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text weight="bold" variant="bodyLg">
                        {t('home.deliveryIn', { minutes: store.data.eta_minutes })}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        {t('cart.shipmentOf', { count })}
                      </Text>
                    </View>
                  </View>
                ) : null}
                {q.lines.map((line) => (
                  <QuoteLineRow key={line.variant_id} line={line} />
                ))}
              </Card>

              <FreeDeliveryHint quote={q} />
              <BillDetails quote={q} />
              <BlockerList blockers={q.blockers} skipCheckoutStep />
              <Text variant="caption" color="textMuted" align="center">
                {t('checkout.pricesNote')}
              </Text>
            </ScrollView>

            <StickyBottomBar>
              <View style={{ flex: 1 }}>
                {location ? (
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {t('cart.deliverTo', { place: location.title })}
                  </Text>
                ) : null}
                <Text weight="bold" variant="title">
                  {formatPrice(q.grand_total)}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('checkout.toPay')}
                </Text>
              </View>
              <View style={{ flex: 1.6 }}>
                {loggedIn ? (
                  <Button
                    testID="proceed-checkout"
                    title={t('checkout.proceed')}
                    size="lg"
                    disabled={!canProceed || quote.isFetching}
                    onPress={() => router.push('/checkout')}
                  />
                ) : (
                  <Button
                    testID="login-to-checkout"
                    title={t('checkout.loginToCheckout')}
                    size="lg"
                    onPress={() => openLogin('checkout')}
                  />
                )}
              </View>
            </StickyBottomBar>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
