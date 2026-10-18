import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  scroll?: boolean;
};

/** Bottom sheet built on RN Modal (filters, variant picker, address picker). */
export function Sheet({ visible, onClose, title, children, scroll }: SheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={styles.keyboardWrap}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {title ? (
            <Text variant="title" accessibilityRole="header" style={{ marginBottom: spacing.md }}>
              {title}
            </Text>
          ) : null}
          {scroll ? (
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '100%',
    flexShrink: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
});
