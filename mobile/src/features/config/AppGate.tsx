import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMyProfile } from '@/features/profile/hooks';
import { useLocalize } from '@/i18n/localize';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, Text } from '@/ui';

import { computeGate, storeUrl, type Gate } from './gate';
import { useAppConfig } from './hooks';

/** Current launch gate. Never blocks while config is loading or unreachable. */
export function useGate(): Gate {
  const config = useAppConfig();
  return config.data ? computeGate(config.data) : { kind: 'ok' };
}

/** Checkout uses this: maintenance with ordering_only pauses ordering but not browsing. */
export function useOrderingPaused(): string | null {
  const { t } = useTranslation();
  const gate = useGate();
  const l = useLocalize();
  if (gate.kind !== 'orderingPaused' && gate.kind !== 'maintenance') return null;
  return l(gate.message) || t('gate.orderingPaused');
}

function FullScreen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
      {children}
    </SafeAreaView>
  );
}

function UpdateBanner({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const url = storeUrl();
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.primary }}>
      <View
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        }}
      >
        <MaterialCommunityIcons name="update" size={18} color="#fff" />
        <Text variant="caption" weight="semibold" style={{ color: '#fff', flex: 1 }}>
          {t('gate.updateAvailable')}
        </Text>
        {url ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(url)}
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="caption" weight="bold" style={{ color: '#fff' }}>
              {t('gate.update')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('gate.dismiss')}
          onPress={onClose}
          hitSlop={12}
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Phase 9.9: blocks old builds below min_app_version, shows a full maintenance screen
 * (admins/staff still get in), and a dismissible "update available" banner.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const gate = useGate();
  const profile = useMyProfile();
  const [dismissed, setDismissed] = useState(false);
  const isStaff = profile.data?.role === 'staff' || profile.data?.role === 'admin';

  if (gate.kind === 'updateRequired') {
    const url = storeUrl();
    return (
      <FullScreen>
        <EmptyState
          icon="cellphone-arrow-down"
          title={t('gate.updateRequiredTitle')}
          message={t('gate.updateRequired')}
          action={
            url ? { label: t('gate.update'), onPress: () => void Linking.openURL(url) } : undefined
          }
        />
      </FullScreen>
    );
  }

  if (gate.kind === 'maintenance' && !isStaff) {
    return (
      <FullScreen>
        <EmptyState
          icon="tools"
          title={t('gate.maintenanceTitle')}
          message={l(gate.message) || t('gate.maintenance')}
        />
      </FullScreen>
    );
  }

  return (
    <>
      {gate.kind === 'updateAvailable' && !dismissed ? (
        <UpdateBanner onClose={() => setDismissed(true)} />
      ) : null}
      {children}
    </>
  );
}
