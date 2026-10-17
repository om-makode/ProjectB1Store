import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { deleteMyAccount, signOut } from '@/features/auth/api';
import { useAuth } from '@/features/auth/store';
import { openLogin } from '@/features/auth/useRequireLogin';
import { useMyProfile } from '@/features/profile/hooks';
import { confirmAction } from '@/lib/confirm';
import { toAppError } from '@/lib/errors';

import { useSettings, type ThemePref } from '@/stores/settings';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Card, Chip, Screen, Text, showToast } from '@/ui';

import { LanguagePicker } from './LanguagePicker';

const THEMES: {
  value: ThemePref;
  key: 'settings.themeSystem' | 'settings.themeLight' | 'settings.themeDark';
}[] = [
  { value: 'system', key: 'settings.themeSystem' },
  { value: 'light', key: 'settings.themeLight' },
  { value: 'dark', key: 'settings.themeDark' },
];

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function MenuRow({
  icon,
  label,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.md,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.hairline,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <MaterialCommunityIcons name={icon} size={20} color={colors.text} />
      </View>
      <Text style={{ flex: 1 }} weight="medium">
        {label}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

type MenuItem = { icon: IconName; label: string; onPress: () => void };

/** A titled group of rows in one card (Blinkit/Zepto account style). */
function MenuGroup({ title, items }: { title: string; items: MenuItem[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" weight="bold" color="textMuted" style={{ letterSpacing: 0.6 }}>
        {title.toUpperCase()}
      </Text>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {items.map((it, i) => (
          <MenuRow key={it.label} {...it} last={i === items.length - 1} />
        ))}
      </Card>
    </View>
  );
}

function initials(name: string | undefined, email: string) {
  const src = (name || email.split('@')[0] || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function ProfileCard() {
  const { t } = useTranslation();
  const session = useAuth((s) => s.session);
  const profile = useMyProfile();
  const [busy, setBusy] = useState<'logout' | 'delete' | null>(null);
  const go = (href: Href) => router.push(href);

  if (!session) {
    return (
      <Card>
        <View style={{ gap: spacing.md }}>
          <Text variant="title">{t('account.loginTitle')}</Text>
          <Text color="textMuted">{t('account.loginBody')}</Text>
          <Button
            testID="account-login"
            title={t('account.login')}
            icon="login"
            onPress={() => openLogin('profile')}
            fullWidth
          />
        </View>
      </Card>
    );
  }

  const logout = async () => {
    setBusy('logout');
    try {
      await signOut();
      showToast(t('account.loggedOut'));
    } catch {
      showToast(t('errors.server'), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    const ok = await confirmAction(
      t('account.deleteTitle'),
      t('account.deleteBody'),
      t('account.deleteConfirm'),
      t('common.cancel'),
    );
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteMyAccount();
      showToast(t('account.deleted'));
    } catch (e) {
      const err = toAppError(e);
      showToast(
        err.message.includes('ACTIVE_ORDERS_EXIST')
          ? t('account.activeOrders')
          : err.kind === 'network'
            ? t('errors.network')
            : t('errors.server'),
        'danger',
      );
    } finally {
      setBusy(null);
    }
  };

  const name = profile.data?.full_name?.trim();
  const email = session.user.email ?? '';
  const role = profile.data?.role;
  return (
    <View style={{ gap: spacing.lg }}>
      <ProfileHeader
        initials={initials(name, email)}
        name={name || t('account.noName')}
        detail={[profile.data?.phone, email].filter(Boolean).join(' · ')}
        onEdit={() => go('/account/profile')}
        editLabel={t('account.editProfile')}
      />

      <MenuGroup
        title={t('account.groupShopping')}
        items={[
          { icon: 'receipt-text-outline', label: t('orders.title'), onPress: () => go('/orders') },
          {
            icon: 'map-marker-outline',
            label: t('account.myAddresses'),
            onPress: () => go('/account/addresses'),
          },
          {
            icon: 'heart-outline',
            label: t('wishlist.title'),
            onPress: () => go('/account/wishlist'),
          },
          { icon: 'history', label: t('buyAgain.title'), onPress: () => go('/buy-again') },
        ]}
      />

      <MenuGroup
        title={t('account.groupSettings')}
        items={[
          {
            icon: 'account-edit-outline',
            label: t('account.editProfile'),
            onPress: () => go('/account/profile'),
          },
          {
            icon: 'bell-cog-outline',
            label: t('notifSettings.title'),
            onPress: () => go('/account/notification-settings'),
          },
        ]}
      />

      {role === 'staff' || role === 'admin' ? (
        <MenuGroup
          title={t('account.groupStore')}
          items={[
            { icon: 'storefront-outline', label: t('storeOps.entry'), onPress: () => go('/store') },
            ...(role === 'admin'
              ? [
                  {
                    icon: 'shield-crown-outline' as IconName,
                    label: t('admin.entry'),
                    onPress: () => go('/admin'),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      <View style={{ gap: spacing.xs }}>
        <Button
          title={t('account.logout')}
          icon="logout"
          variant="secondary"
          onPress={logout}
          loading={busy === 'logout'}
          fullWidth
        />
        <Button
          title={t('account.deleteAccount')}
          variant="ghost"
          onPress={confirmDelete}
          loading={busy === 'delete'}
        />
      </View>
    </View>
  );
}

function ProfileHeader({
  initials: text,
  name,
  detail,
  onEdit,
  editLabel,
}: {
  initials: string;
  name: string;
  detail: string;
  onEdit: () => void;
  editLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Card elevation="md" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primarySoft,
        }}
      >
        <Text variant="title" weight="bold" color="primary">
          {text}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="title" weight="bold" numberOfLines={1}>
          {name}
        </Text>
        {detail ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editLabel}
        onPress={onEdit}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        })}
      >
        <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.primary} />
      </Pressable>
    </Card>
  );
}

export function AccountScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { language, theme, textScale, setLanguage, setTheme, setLargeText } = useSettings();

  return (
    <Screen scroll maxWidth={layout.readableMax}>
      <Text variant="h1" accessibilityRole="header">
        {t('account.title')}
      </Text>

      <ProfileCard />

      <MenuGroup
        title={t('account.groupHelp')}
        items={[
          {
            icon: 'help-circle-outline',
            label: t('account.help'),
            onPress: () => router.push('/account/help'),
          },
          {
            icon: 'scale-balance',
            label: t('legal.title'),
            onPress: () => router.push('/account/legal'),
          },
        ]}
      />

      <Text variant="title" accessibilityRole="header">
        {t('settings.language')}
      </Text>
      <LanguagePicker value={language} onChange={setLanguage} />

      <Card>
        <View style={{ gap: spacing.md }}>
          <Text variant="title" accessibilityRole="header">
            {t('settings.theme')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {THEMES.map((th) => (
              <Chip
                key={th.value}
                label={t(th.key)}
                selected={theme === th.value}
                onPress={() => setTheme(th.value)}
              />
            ))}
          </View>

          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text weight="semibold">{t('settings.largeText')}</Text>
              <Text variant="caption" color="textMuted">
                {t('settings.largeTextHint')}
              </Text>
            </View>
            <Switch
              testID="large-text-switch"
              accessibilityLabel={t('settings.largeText')}
              value={textScale > 1}
              onValueChange={setLargeText}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>
      </Card>

      <Text variant="caption" color="textMuted" align="center">
        {t('account.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}
      </Text>
    </Screen>
  );
}
