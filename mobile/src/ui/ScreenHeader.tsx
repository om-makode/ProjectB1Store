import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { IconButton } from './IconButton';
import { Text } from './Text';

type Props = { title?: string; subtitle?: string; right?: ReactNode; tint?: string | null };

/** Back button + title for pushed screens (category, product, cart…). */
export function ScreenHeader({ title, subtitle, right, tint }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingRight: spacing.sm,
        backgroundColor: colors.surface,
        borderBottomWidth: tint ? 2 : 1,
        borderBottomColor: tint ?? colors.hairline,
      }}
    >
      <IconButton
        icon="arrow-left"
        accessibilityLabel={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <View style={{ flex: 1 }}>
        {title ? (
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}
