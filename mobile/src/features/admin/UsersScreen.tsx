import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useUserId } from '@/features/auth/store';
import { useSettings } from '@/stores/settings';
import { toAppError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import { setUserBlocked, setUserRole, type AdminUser, type AppRole } from './api';
import { AdminShell, ChoiceRow, confirmAction } from './components';
import { useAdminUsers } from './hooks';

const ROLES: AppRole[] = ['customer', 'staff', 'admin'];

export function UsersScreen() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<AppRole | null>(null);
  const users = useAdminUsers(q, role);
  const rows = (users.data?.pages ?? []).flat();

  return (
    <AdminShell title={t('admin.nav.users')} subtitle={t('admin.ui.usersSubtitle')}>
      <TextField
        label={t('admin.users.search')}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        placeholder={t('admin.users.searchPh')}
      />
      <ChoiceRow
        label={t('admin.users.role')}
        value={role}
        onChange={setRole}
        options={[
          { value: null as AppRole | null, label: t('admin.all') },
          ...ROLES.map((r) => ({ value: r as AppRole | null, label: t(`admin.users.role_${r}`) })),
        ]}
      />
      {users.isPending ? (
        <Skeleton width="100%" height={300} />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="account-search-outline" title={t('admin.users.none')} />
      ) : (
        rows.map((u) => <UserRow key={u.id} u={u} onChanged={() => void users.refetch()} />)
      )}
      {users.hasNextPage ? (
        <Button
          title={t('admin.loadMore')}
          variant="secondary"
          loading={users.isFetchingNextPage}
          onPress={() => void users.fetchNextPage()}
        />
      ) : null}
    </AdminShell>
  );
}

function UserRow({ u, onChanged }: { u: AdminUser; onChanged: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const me = useUserId();
  const [busy, setBusy] = useState(false);
  const self = u.id === me;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      showToast(t('admin.saved'), 'success');
      onChanged();
    } catch (e) {
      showToast(toAppError(e).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (r: AppRole) => {
    if (r === u.role) return;
    const ok = await confirmAction(
      t('admin.users.changeRole'),
      t('admin.users.changeRoleBody', {
        name: u.full_name || u.email || u.phone || u.id,
        role: t(`admin.users.role_${r}`),
      }),
      t('admin.users.confirm'),
      t('common.cancel'),
    );
    if (ok) await run(() => setUserRole(u.id, r));
  };

  const toggleBlock = async () => {
    const ok = await confirmAction(
      u.is_blocked ? t('admin.users.unblock') : t('admin.users.block'),
      u.is_blocked ? t('admin.users.unblockBody') : t('admin.users.blockBody'),
      t('admin.users.confirm'),
      t('common.cancel'),
    );
    if (ok) await run(() => setUserBlocked(u.id, !u.is_blocked, null));
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: u.is_blocked ? colors.danger : colors.border,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor:
              u.role === 'admin'
                ? colors.discount
                : u.role === 'staff'
                  ? colors.info
                  : colors.surfaceAlt,
          }}
        >
          <Text weight="bold" style={{ color: u.role === 'customer' ? colors.text : '#fff' }}>
            {(u.full_name || u.email || '?').trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text weight="semibold">{u.full_name || t('account.noName')}</Text>
          <Text variant="caption" color="textMuted">
            {[u.email, u.phone].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('admin.users.orders', {
              count: u.orders_count,
              delivered: u.delivered_count,
              cancelled: u.cancelled_count,
            })}
            {u.last_order_at
              ? ` · ${t('admin.users.lastOrder', { when: formatDateTime(u.last_order_at, lang) })}`
              : ''}
          </Text>
        </View>
        {self ? <Badge label={t('admin.users.you')} tone="info" /> : null}
        {u.is_blocked ? <Badge label={t('admin.users.blocked')} tone="danger" /> : null}
        {!u.cod_allowed ? <Badge label={t('admin.users.noCod')} tone="warning" /> : null}
      </View>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}
      >
        {ROLES.map((r) => (
          <Chip
            key={r}
            label={t(`admin.users.role_${r}`)}
            selected={u.role === r}
            onPress={busy || self ? undefined : () => void changeRole(r)}
          />
        ))}
        <View style={{ flex: 1 }} />
        {!self ? (
          <>
            <Button
              title={u.cod_allowed ? t('admin.users.disableCod') : t('admin.users.enableCod')}
              variant="ghost"
              disabled={busy}
              onPress={() => void run(() => setUserBlocked(u.id, u.is_blocked, !u.cod_allowed))}
            />
            <Button
              title={u.is_blocked ? t('admin.users.unblock') : t('admin.users.block')}
              variant={u.is_blocked ? 'secondary' : 'danger'}
              disabled={busy}
              onPress={() => void toggleBlock()}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}
