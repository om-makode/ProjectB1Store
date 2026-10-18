import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { asLocalized, localize } from '@/i18n/localize';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useSettings } from '@/stores/settings';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Card, Chip, ErrorState, Skeleton, Text, TextField, showToast } from '@/ui';

import { setStoreOpen, type StoreSettings } from './api';
import { staffErrorMessage } from './errors';
import { useStaffAction, useStoreId, useStoreSettings } from './hooks';
import { StoreNav } from './StoreGate';

const ETA_PRESETS = [0, 10, 20, 30, 45] as const;
const BUSY_PRESETS = ['rain', 'busy', 'staff'] as const;

function StoreForm({
  storeId,
  s,
  onDirtyChange,
}: {
  storeId: number;
  s: StoreSettings;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((x) => x.language);
  const save = useStaffAction(setStoreOpen);
  const initialMessage = localize(asLocalized(s.busy_message), lang);
  const initialEta = String(s.eta_minutes ?? '');
  const [accepting, setAccepting] = useState(s.is_accepting_orders);
  const [message, setMessage] = useState(initialMessage);
  const [eta, setEta] = useState(initialEta);
  const [savedMessage, setSavedMessage] = useState(initialMessage);
  const [savedEta, setSavedEta] = useState(initialEta);

  const isDirty = message !== savedMessage || eta !== savedEta;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useUnsavedChanges(isDirty);

  const submit = (nextAccepting = accepting) => {
    const text = message.trim();
    // Staff type one message; it's shown as-is in every language.
    const busy = text ? { en: text, mr: text, hi: text } : null;
    const etaNum = eta.trim() ? Number(eta) : null;
    if (etaNum !== null && (etaNum < 0 || etaNum > 240)) {
      showToast(t('storeOps.errors.INVALID_ETA'), 'danger');
      return;
    }
    save.mutate([storeId, nextAccepting, busy, etaNum], {
      onSuccess: () => {
        setSavedMessage(message);
        setSavedEta(eta);
        showToast(t('storeOps.store.saved'), 'success');
      },
      onError: (e) => {
        setAccepting(s.is_accepting_orders);
        showToast(staffErrorMessage(e), 'danger');
      },
    });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: accepting, disabled: save.isPending }}
        accessibilityLabel={t('storeOps.store.accepting')}
        disabled={save.isPending}
        onPress={() => {
          const v = !accepting;
          setAccepting(v);
          submit(v); // flipping saves immediately
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.lg,
          padding: spacing.xl,
          borderRadius: radius.xl,
          backgroundColor: accepting ? colors.success : colors.outOfStock,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.22)',
          }}
        >
          <MaterialCommunityIcons
            name={accepting ? 'storefront-outline' : 'store-off-outline'}
            size={34}
            color="#fff"
          />
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="h1" weight="bold" style={{ color: '#fff' }}>
            {accepting ? t('storeOps.store.accepting') : t('storeOps.store.paused')}
          </Text>
          <Text style={{ color: '#fff' }}>
            {accepting ? t('storeOps.store.acceptingHint') : t('storeOps.store.pausedHint')}
          </Text>
          <Text variant="caption" weight="semibold" style={{ color: '#fff', opacity: 0.9 }}>
            {accepting ? t('storeOps.ui.tapToPause') : t('storeOps.ui.tapToOpen')}
          </Text>
        </View>
        {/* Visual only: the whole card is the switch. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Switch
            value={accepting}
            trackColor={{ true: 'rgba(255,255,255,0.5)', false: 'rgba(0,0,0,0.2)' }}
          />
        </View>
      </Pressable>
      <Card>
        <View style={{ gap: spacing.md }}>
          <Text weight="semibold">{t('storeOps.store.eta')}</Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing.sm,
              alignItems: 'center',
            }}
          >
            {ETA_PRESETS.map((m) => (
              <Chip
                key={m}
                label={
                  m === 0
                    ? t('storeOps.ui.etaZeroChip')
                    : t('storeOps.ui.etaChip', { minutes: m })
                }
                selected={eta === String(m)}
                onPress={() => setEta(String(m))}
              />
            ))}
            <View style={{ width: 110 }}>
              <TextField
                label={t('storeOps.ui.etaCustom')}
                value={eta}
                onChangeText={(v) => setEta(v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="0–240"
              />
            </View>
          </View>
          <Text variant="caption" color="textMuted">
            {t('storeOps.store.etaZeroHint')}
          </Text>
          <TextField
            label={t('storeOps.store.busyMessage')}
            placeholder={t('storeOps.store.busyPlaceholder')}
            value={message}
            onChangeText={setMessage}
            maxLength={120}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {BUSY_PRESETS.map((k) => {
              const text = t(`storeOps.ui.busyPresets.${k}`);
              return (
                <Chip
                  key={k}
                  label={text}
                  selected={message === text}
                  onPress={() => setMessage(text)}
                />
              );
            })}
            {message ? (
              <Chip label={t('storeOps.ui.clearMessage')} onPress={() => setMessage('')} />
            ) : null}
          </View>
          {s.auto_cancel_minutes > 0 ? (
            <Text variant="caption" color="textMuted">
              {t('storeOps.store.autoCancel', { minutes: s.auto_cancel_minutes })}
            </Text>
          ) : null}
          <Button
            title={t('storeOps.store.save')}
            icon="content-save-outline"
            size="lg"
            loading={save.isPending}
            onPress={() => submit()}
            fullWidth
          />
        </View>
      </Card>
    </ScrollView>
  );
}

/** One big switch the counter can flip in a second: accepting / paused, busy message, ETA. */
export function StoreSwitchScreen() {
  const { colors } = useTheme();
  const storeId = useStoreId();
  const settings = useStoreSettings(storeId);
  const s = settings.data;
  const [dirty, setDirty] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StoreNav hasUnsavedChanges={dirty} />
      {settings.isPending ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width="100%" height={120} />
        </View>
      ) : settings.isError || !s || !storeId ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        // Remount when the saved settings change (e.g. another tablet paused the store).
        <StoreForm
          key={`${s.is_accepting_orders}-${s.eta_minutes}-${JSON.stringify(s.busy_message)}`}
          storeId={storeId}
          s={s}
          onDirtyChange={setDirty}
        />
      )}
    </SafeAreaView>
  );
}
