import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { formatPrice } from '@/lib/format';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Card, Text } from '@/ui';

type Params = { id: string; number: string; total: string; eta: string; items: string };

/** Shown once after place_order succeeds. */
export function OrderPlacedScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const p = useLocalSearchParams<Params>();
  const [scale] = useState(() => new Animated.Value(0.3));
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (Platform.OS !== 'web')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 400,
        delay: 150,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [scale, fade]);

  const eta = p.eta ? Number(p.eta) : null;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Animated.View
          style={{
            transform: [{ scale }],
            width: 112,
            height: 112,
            borderRadius: 56,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="check-bold" size={64} color={colors.primaryText} />
        </Animated.View>

        <Animated.View style={{ opacity: fade, alignItems: 'center', gap: spacing.sm }}>
          <Text variant="h1" align="center" accessibilityRole="header">
            {t('placed.title')}
          </Text>
          <Text color="textMuted" align="center">
            {t('placed.number', { number: p.number })}
          </Text>
          {eta ? (
            <Text weight="semibold" align="center">
              {t('placed.eta', { minutes: eta })}
            </Text>
          ) : null}
        </Animated.View>

        <Card style={{ alignSelf: 'stretch', gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>{t('cart.items', { count: Number(p.items) || 0 })}</Text>
            <Text weight="bold">{formatPrice(Number(p.total) || 0)}</Text>
          </View>
          <Text variant="caption" color="textMuted">
            {t('placed.cod')}
          </Text>
        </Card>
      </View>

      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Button
          testID="view-order"
          title={t('placed.viewOrder')}
          size="lg"
          onPress={() => router.replace({ pathname: '/order/[id]', params: { id: p.id } })}
        />
        <Button
          title={t('placed.continue')}
          variant="secondary"
          onPress={() => router.dismissTo('/')}
        />
      </View>
    </SafeAreaView>
  );
}
