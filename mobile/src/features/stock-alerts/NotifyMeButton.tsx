import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { toAppError } from '@/lib/errors';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { showToast, Text } from '@/ui';

import { toggleStockAlert, useStockAlerts } from './store';

type Props = { variantId: number; size?: 'sm' | 'md' };

/** Replaces ADD when a variant is out of stock. */
export function NotifyMeButton({ variantId, size = 'sm' }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const on = useStockAlerts((s) => s.on.includes(variantId));
  const [busy, setBusy] = useState(false);
  const h = size === 'sm' ? 34 : 44;

  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await toggleStockAlert(variantId);
      showToast(t(`notifyMe.${r}`), r === 'removed' ? 'info' : 'success');
    } catch (e) {
      const err = toAppError(e);
      showToast(
        err.message.includes('too_many_alerts') ? t('notifyMe.tooMany') : t('errors.server'),
        'danger',
      );
    } finally {
      setBusy(false);
    }
  };

  const fg = on ? colors.success : colors.primary;
  return (
    <Pressable
      testID={`notify-me-${variantId}`}
      accessibilityRole="button"
      accessibilityState={{ selected: on, busy }}
      accessibilityLabel={on ? t('notifyMe.onLabel') : t('notifyMe.label')}
      onPress={() => void press()}
      hitSlop={{ top: 7, bottom: 7, left: 7, right: 7 }}
      style={[
        styles.btn,
        { height: h, borderColor: fg, backgroundColor: on ? `${fg}14` : colors.surface },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          <MaterialCommunityIcons name={on ? 'bell-check' : 'bell-outline'} size={15} color={fg} />
          <Text variant="caption" weight="bold" style={{ color: fg }}>
            {on ? t('notifyMe.on') : t('notifyMe.short')}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 72,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
