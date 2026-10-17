import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Text } from '@/ui';

import type { OrderEvent, OrderStatus } from '../api';
import { timelineSteps } from '../timeline';

export function StatusTimeline({ status, events }: { status: OrderStatus; events: OrderEvent[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const steps = timelineSteps(status, events);

  return (
    <View accessibilityRole="list">
      {steps.map((step, i) => {
        const cancelled = step.status === 'cancelled';
        const color = cancelled
          ? colors.danger
          : step.state === 'todo'
            ? colors.border
            : colors.primary;
        const icon = cancelled
          ? 'close-circle'
          : step.state === 'done'
            ? 'check-circle'
            : step.state === 'current'
              ? 'progress-clock'
              : 'circle-outline';
        const label = t(`order.status.${step.status}` as 'order.status.placed');
        return (
          <View
            key={step.status}
            accessibilityLabel={`${label}${step.at ? `, ${formatDateTime(step.at, lang)}` : ''}`}
            style={{ flexDirection: 'row', gap: spacing.md }}
          >
            <View style={{ alignItems: 'center', width: 24 }}>
              <MaterialCommunityIcons name={icon} size={22} color={color} />
              {i < steps.length - 1 ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: 18,
                    backgroundColor: steps[i + 1]!.state === 'todo' ? colors.border : color,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.md }}>
              <Text
                weight={step.state === 'current' ? 'bold' : 'medium'}
                color={step.state === 'todo' ? 'textMuted' : cancelled ? 'danger' : 'text'}
              >
                {label}
              </Text>
              {step.at ? (
                <Text variant="caption" color="textMuted">
                  {formatDateTime(step.at, lang)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
