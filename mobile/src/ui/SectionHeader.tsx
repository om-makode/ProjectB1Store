import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

/** Section title with an optional "See all ›" link (home rails, product detail, account). */
export function SectionHeader({
  title,
  subtitle,
  onSeeAll,
  inset = true,
}: {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  /** Horizontal page padding (off when the parent already pads). */
  inset?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!title) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingHorizontal: inset ? spacing.lg : 0,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="title" weight="bold" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onSeeAll ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${t('common.seeAll')}: ${title}`}
          onPress={onSeeAll}
          hitSlop={10}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 32,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text variant="body" weight="semibold" color="primary">
            {t('common.seeAll')}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}
