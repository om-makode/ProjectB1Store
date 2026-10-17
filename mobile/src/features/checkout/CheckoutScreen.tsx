import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AddressRow } from '@/features/addresses/AddressRow';
import { useMyAddresses } from '@/features/addresses/hooks';
import { useIsLoggedIn, useUserId } from '@/features/auth/store';
import { openLogin } from '@/features/auth/useRequireLogin';
import type { Quote } from '@/features/cart/api';
import { BillDetails, BlockerList, QuoteLineRow } from '@/features/cart/components';
import { useCartQuote, usePlaceOrder } from '@/features/cart/hooks';
import {
  parseOrderError,
  recoveryFor,
  type OrderErrorCode,
  type Recovery,
} from '@/features/cart/orderErrors';
import { useGuestCart } from '@/features/cart/store';
import { useOrderingPaused } from '@/features/config/AppGate';
import { cartQuoteKey } from '@/features/cart/sync';
import { useDeliveryLocation } from '@/features/location/store';
import { canOpenCheckout } from '@/features/payments/checkout';
import { formatPrice } from '@/lib/format';
import { goBack } from '@/lib/navigation';
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
  TextField,
} from '@/ui';

const NOTE_MAX = 300;

export function CheckoutScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const loggedIn = useIsLoggedIn();
  const uid = useUserId();
  const addresses = useMyAddresses();
  const location = useDeliveryLocation((s) => s.location);
  const [picked, setAddressId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<OrderErrorCode | null>(null);
  const [chosen, setChosen] = useState<'cod' | 'upi'>('cod');
  const place = usePlaceOrder();
  const net = useNetInfo();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const pausedMessage = useOrderingPaused();
  // One key per checkout attempt: retries and double taps can never create a second order.
  const idempotencyKey = useRef<string | null>(null);
  const busy = useRef(false);

  // The address: what the user tapped, else the one chosen on Home, else default, else first.
  const addressId = useMemo(() => {
    const list = addresses.data ?? [];
    if (picked && list.some((a) => a.id === picked)) return picked;
    const fromHome = location?.source === 'address' ? location.addressId : null;
    return (
      (list.find((a) => a.id === fromHome) ?? list.find((a) => a.is_default) ?? list[0])?.id ?? null
    );
  }, [addresses.data, picked, location]);

  // Online payment only when the store has it on (stores.upi_enabled, Phase 10) AND this
  // build can open Razorpay Checkout; otherwise everything stays cash on delivery.
  const quote = useCartQuote({ addressId, enabled: loggedIn && !!addressId, method: chosen });
  const q = quote.data;
  const cod = q?.payment_methods.find((p) => p.method === 'cod');
  const upi = q?.payment_methods.find((p) => p.method === 'upi');
  const checkoutAvailable = canOpenCheckout();
  const upiAllowed = !!upi?.allowed && checkoutAvailable;
  const method: 'cod' | 'upi' = chosen === 'upi' && upiAllowed ? 'upi' : 'cod';
  const quoteKey =
    method === 'cod'
      ? [...cartQuoteKey, 'user', uid, addressId]
      : [...cartQuoteKey, 'user', uid, addressId, method];

  if (!loggedIn) {
    return (
      <Shell title={t('checkout.title')}>
        <EmptyState
          icon="account-lock-outline"
          title={t('checkout.loginTitle')}
          message={t('checkout.loginMessage')}
          action={{ label: t('checkout.loginToCheckout'), onPress: () => openLogin('checkout') }}
        />
      </Shell>
    );
  }

  const onPlace = async () => {
    if (!q || !addressId || busy.current) return;
    busy.current = true;
    setFailure(null);
    try {
      const order = await place.mutateAsync({
        addressId,
        method,
        note: note.trim(),
        idempotencyKey: (idempotencyKey.current ??= Crypto.randomUUID()),
        expectedTotal: q.grand_total,
      });
      idempotencyKey.current = null; // next checkout is a new attempt
      useGuestCart.getState().clear(); // the server already emptied cart_items
      void qc.invalidateQueries({ queryKey: cartQuoteKey });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      if (order.payment_method === 'upi') {
        // Pay from the order screen: if the app closes mid-payment, the customer comes back
        // to a screen that knows the order (awaiting_payment, with its countdown).
        router.replace({ pathname: '/order/[id]', params: { id: order.order_id, pay: '1' } });
        return;
      }
      router.replace({
        pathname: '/order/placed',
        params: {
          id: order.order_id,
          number: order.order_number,
          total: String(order.grand_total),
          eta: order.eta_minutes != null ? String(order.eta_minutes) : '',
          items: String(order.item_count),
        },
      });
    } catch (e) {
      const { code, quote: fresh } = parseOrderError(e);
      // The server sends the fresh quote with most refusals: show it without a refetch.
      if (fresh) qc.setQueryData(quoteKey, fresh);
      else void qc.invalidateQueries({ queryKey: cartQuoteKey });
      setFailure(code);
    } finally {
      busy.current = false;
    }
  };

  const recover = (r: Recovery) => {
    switch (r) {
      case 'reviewCart':
        return goBack('/cart');
      case 'addMore':
        return router.dismissTo('/');
      case 'viewOrders':
        return router.replace('/orders');
      case 'login':
        return openLogin('checkout');
      case 'help':
        return router.push('/account/help');
      case 'retry':
        return void onPlace();
      default:
        return undefined;
    }
  };

  return (
    <Shell title={t('checkout.title')}>
      {addresses.isPending ? (
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={160} />
        </View>
      ) : addresses.isError ? (
        <ErrorState error={addresses.error} onRetry={() => void addresses.refetch()} />
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
            keyboardShouldPersistTaps="handled"
          >
            {/* 1. Address */}
            <Card style={{ gap: spacing.sm }}>
              <SectionTitle icon="map-marker-radius-outline" title={t('checkout.deliverTo')} />
              {(addresses.data ?? []).map((a) => (
                <AddressRow
                  key={a.id}
                  address={a}
                  selected={a.id === addressId}
                  onPress={() => {
                    setAddressId(a.id);
                    setFailure(null);
                  }}
                />
              ))}
              {(addresses.data ?? []).length === 0 ? (
                <Text color="textMuted">{t('checkout.noAddress')}</Text>
              ) : null}
              <Button
                title={t('checkout.addAddress')}
                variant="ghost"
                icon="plus"
                onPress={() => router.push('/account/addresses/edit')}
              />
            </Card>

            {addressId && !q && quote.isPending ? <Skeleton width="100%" height={200} /> : null}
            {addressId && !q && quote.isError ? (
              <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
            ) : null}

            {q ? (
              <>
                {q.eta_minutes ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      padding: spacing.md,
                      borderRadius: radius.lg,
                      backgroundColor: colors.accentSoft,
                    }}
                  >
                    <MaterialCommunityIcons name="lightning-bolt" size={22} color={colors.text} />
                    <Text weight="bold" variant="bodyLg">
                      {t('checkout.eta', { minutes: q.eta_minutes })}
                    </Text>
                  </View>
                ) : null}

                {/* 2. Items */}
                <Card style={{ gap: spacing.md }}>
                  <SectionTitle
                    icon="basket-outline"
                    title={t('cart.items', { count: q.item_count })}
                  />
                  {q.lines.map((l) => (
                    <QuoteLineRow key={l.variant_id} line={l} editable={false} />
                  ))}
                </Card>

                {/* 3. Payment */}
                <Card style={{ gap: spacing.sm }}>
                  <SectionTitle icon="wallet-outline" title={t('checkout.payment')} />
                  <PayOption
                    icon="cash"
                    title={t('checkout.cod')}
                    subtitle={
                      cod?.allowed === false
                        ? cod.reason === 'COD_LIMIT_EXCEEDED'
                          ? t('checkout.codLimit', { amount: formatPrice(cod.limit ?? 0) })
                          : t('orderErrors.COD_NOT_ALLOWED')
                        : t('checkout.codHint')
                    }
                    selected={method === 'cod'}
                    onPress={() => {
                      setChosen('cod');
                      setFailure(null);
                    }}
                  />
                  <PayOption
                    icon="qrcode-scan"
                    title={t('checkout.upi')}
                    subtitle={
                      upiAllowed
                        ? t('payments.upiHint')
                        : upi?.allowed && !checkoutAvailable
                          ? t('payments.errors.needsUpdate')
                          : t('checkout.comingSoon')
                    }
                    selected={method === 'upi'}
                    disabled={!upiAllowed}
                    onPress={() => {
                      setChosen('upi');
                      setFailure(null);
                    }}
                  />
                </Card>

                {/* 4. Note */}
                <Card>
                  <TextField
                    label={t('checkout.note')}
                    hint={`${note.length}/${NOTE_MAX}`}
                    value={note}
                    onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
                    multiline
                    maxLength={NOTE_MAX}
                    placeholder={t('checkout.notePlaceholder')}
                  />
                </Card>

                <BillDetails quote={q} />
                <BlockerList blockers={q.blockers} />
                {failure ? (
                  <FailureCard code={failure} quote={q} onAction={(r) => recover(r)} />
                ) : null}
              </>
            ) : null}
          </ScrollView>

          {offline || pausedMessage ? (
            <View style={{ backgroundColor: colors.dangerSoft, padding: spacing.sm }}>
              <Text
                accessibilityRole="alert"
                color="danger"
                align="center"
                weight="semibold"
                testID="checkout-blocked"
              >
                {offline ? t('checkout.offline') : pausedMessage}
              </Text>
            </View>
          ) : null}
          <StickyBottomBar>
            {q ? (
              <View style={{ flex: 1 }}>
                <Text weight="bold" variant="title">
                  {formatPrice(q.grand_total)}
                </Text>
                <Text variant="caption" color="textMuted">
                  {method === 'upi' ? t('checkout.upi') : t('checkout.cod')}
                </Text>
              </View>
            ) : null}
            <View style={{ flex: 2 }}>
              <Button
                testID="place-order"
                size="lg"
                title={
                  q
                    ? method === 'upi'
                      ? t('payments.payAndPlace', { amount: formatPrice(q.grand_total) })
                      : t('checkout.placeOrder', { amount: formatPrice(q.grand_total) })
                    : t('checkout.placeOrderPlain')
                }
                loading={place.isPending}
                disabled={
                  !q ||
                  !q.can_checkout ||
                  place.isPending ||
                  quote.isFetching ||
                  offline ||
                  !!pausedMessage
                }
                onPress={() => void onPlace()}
              />
            </View>
          </StickyBottomBar>
        </>
      )}
    </Shell>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <Text variant="title" weight="bold" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={title} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>
    </SafeAreaView>
  );
}

function PayOption({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={`${title}. ${subtitle}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 64,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected
          ? colors.primarySoft
          : pressed
            ? colors.surfaceAlt
            : colors.surface,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? colors.surface : colors.surfaceAlt,
        }}
      >
        <MaterialCommunityIcons
          name={icon}
          size={22}
          color={selected ? colors.primary : colors.text}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="caption" color="textMuted">
          {subtitle}
        </Text>
      </View>
      <MaterialCommunityIcons
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={selected ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
}

function FailureCard({
  code,
  quote,
  onAction,
}: {
  code: OrderErrorCode;
  quote: Quote;
  onAction: (r: Recovery) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const r = recoveryFor(code);
  const message =
    code === 'PRICE_CHANGED'
      ? t('checkout.priceChangedConfirm', { amount: formatPrice(quote.grand_total) })
      : t(`orderErrors.${code}` as 'orderErrors.UNKNOWN');
  const actionLabel: Partial<Record<Recovery, string>> = {
    reviewCart: t('checkout.actions.reviewCart'),
    addMore: t('checkout.actions.addMore'),
    viewOrders: t('checkout.actions.viewOrders'),
    login: t('checkout.actions.login'),
    help: t('checkout.actions.help'),
    retry: t('common.retry'),
  };
  const showAction = code !== 'PRICE_CHANGED' && actionLabel[r];
  return (
    <View
      testID={`order-error-${code}`}
      accessibilityLiveRegion="polite"
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.danger,
        backgroundColor: colors.surface,
      }}
    >
      <Text color="danger" weight="semibold">
        {message}
      </Text>
      {showAction ? (
        <Button title={actionLabel[r]!} variant="secondary" onPress={() => onAction(r)} />
      ) : null}
    </View>
  );
}
