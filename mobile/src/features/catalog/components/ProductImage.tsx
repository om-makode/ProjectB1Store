import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { hasImageFailed, markImageFailed } from '@/lib/imageFailures';
import { catalogImageUrl } from '@/lib/images';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Text } from '@/ui';

type Props = {
  path: string | null | undefined;
  /** Used for the placeholder when there's no photo yet. */
  name: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  tint?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  rounded?: number;
};

/**
 * Catalog photo with a friendly placeholder (tinted tile + category icon, else the first
 * letter) when the image is missing or fails to load, so the shelf never looks broken.
 */
export function ProductImage({ path, name, icon, tint, size, style, rounded = radius.md }: Props) {
  const { colors } = useTheme();
  const url = catalogImageUrl(path);
  // Re-render when this URL fails; the Set remembers it for every other cell/screen.
  const [, setFailedTick] = useState(0);
  const failed = hasImageFailed(url);
  const bg = tint ? `${tint}1F` : colors.surfaceAlt;
  const fg = tint ?? colors.textMuted;

  return (
    <View
      style={[
        {
          width: size ?? '100%',
          aspectRatio: 1,
          borderRadius: rounded,
          overflow: 'hidden',
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      accessibilityIgnoresInvertColors
    >
      {url && !failed ? (
        <Image
          source={{ uri: url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          transition={150}
          cachePolicy="disk"
          onError={() => {
            markImageFailed(url);
            setFailedTick((n) => n + 1);
          }}
          recyclingKey={url}
          accessible={false}
        />
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={(size ?? 72) * 0.45} color={fg} />
      ) : (
        <Text variant="h1" weight="bold" style={{ color: fg, opacity: 0.8 }}>
          {name.trim().charAt(0).toUpperCase() || '•'}
        </Text>
      )}
    </View>
  );
}
