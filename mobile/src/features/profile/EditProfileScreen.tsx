import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAuth } from '@/features/auth/store';
import { toAppError } from '@/lib/errors';
import { goBack } from '@/lib/navigation';
import { layout, spacing } from '@/theme/tokens';
import { Button, Screen, ScreenHeader, Skeleton, TextField, showToast } from '@/ui';

import { useMyProfile, useUpdateProfile } from './hooks';
import { normalizeIndianPhone } from './phone';

function Form() {
  const { t } = useTranslation();
  const email = useAuth((s) => s.session?.user.email ?? '');
  const profile = useMyProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.data?.full_name ?? '');
  const [phone, setPhone] = useState((profile.data?.phone ?? '').replace(/^\+91/, ''));
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});

  const save = () => {
    const n = name.trim();
    const p = phone.trim() ? normalizeIndianPhone(phone) : null;
    const e: typeof errors = {};
    if (n.length < 2 || n.length > 100) e.name = t('profile.nameError');
    if (phone.trim() && !p) e.phone = t('profile.phoneError');
    setErrors(e);
    if (Object.keys(e).length) return;
    update.mutate(
      { full_name: n, phone: p },
      {
        onSuccess: () => {
          showToast(t('profile.saved'), 'success');
          goBack('/account');
        },
        onError: (x) =>
          showToast(
            toAppError(x).kind === 'network' ? t('errors.network') : t('errors.server'),
            'danger',
          ),
      },
    );
  };

  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
      <TextField
        label={t('profile.name')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        error={errors.name}
      />
      <TextField
        label={t('profile.phone')}
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, '').slice(0, 13))}
        keyboardType="phone-pad"
        autoComplete="tel"
        hint={t('profile.phoneHint')}
        error={errors.phone}
      />
      <TextField label={t('profile.email')} value={email} editable={false} />
      <Button
        title={t('common.save')}
        onPress={save}
        loading={update.isPending}
        fullWidth
        size="lg"
      />
    </View>
  );
}

export function EditProfileScreen() {
  const { t } = useTranslation();
  const profile = useMyProfile();
  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={t('profile.title')} />
      {profile.isLoading ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton width="100%" height={56} />
          <Skeleton width="100%" height={56} />
        </View>
      ) : (
        <Form />
      )}
    </Screen>
  );
}
