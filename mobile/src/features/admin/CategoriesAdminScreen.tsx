import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { asLocalized, useLocalize } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Badge, Button, ErrorState, Skeleton, Text, showToast } from '@/ui';

import { reorderRows, type CategoryRow } from './api';
import { AdminShell, MoveButtons, Section, moved } from './components';
import { categoryTree, fieldsOf, useAdminCategories, useRefreshCatalog } from './hooks';

const editHref = (q: string) => `/admin/categories/edit?${q}` as Href;

export function CategoriesAdminScreen() {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const q = useAdminCategories();
  const refresh = useRefreshCatalog();

  const reorder = async (siblings: CategoryRow[], i: number, dir: -1 | 1) => {
    try {
      await reorderRows(
        'categories',
        moved(siblings, i, dir).map((c) => c.id),
      );
      refresh();
    } catch (e) {
      showToast(toAppError(e).message, 'danger');
    }
  };

  const row = (c: CategoryRow, siblings: CategoryRow[], i: number, child: boolean) => (
    <View
      key={c.id}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        paddingLeft: child ? spacing.xl : 0,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: c.color ?? colors.border,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text weight={child ? 'regular' : 'semibold'} numberOfLines={1}>
          {l(asLocalized(c.name))}
        </Text>
        <Text variant="caption" color="textMuted">
          {c.slug} ·{' '}
          {t('admin.cat.fieldsCount', { count: fieldsOf(c).filter((f) => !f.deprecated).length })}
        </Text>
      </View>
      {!c.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
      <MoveButtons
        onUp={() => void reorder(siblings, i, -1)}
        onDown={() => void reorder(siblings, i, 1)}
        disabledUp={i === 0}
        disabledDown={i === siblings.length - 1}
      />
      <Button
        title={t('admin.edit')}
        variant="ghost"
        onPress={() => router.push(editHref(`id=${c.id}`))}
      />
    </View>
  );

  return (
    <AdminShell
      title={t('admin.nav.categories')}
      subtitle={t('admin.ui.categoriesSubtitle')}
      actions={
        <Button
          title={t('admin.cat.new')}
          icon="plus"
          onPress={() => router.push(editHref('new=1'))}
        />
      }
    >
      <Text color="textMuted">{t('admin.cat.intro')}</Text>
      {q.isPending ? (
        <Skeleton width="100%" height={300} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        categoryTree(q.data).map(({ parent, children }, pi, parents) => (
          <Section
            key={parent.id}
            title={l(asLocalized(parent.name))}
            right={
              <Button
                title={t('admin.cat.addSub')}
                icon="plus"
                variant="secondary"
                onPress={() => router.push(editHref(`parent=${parent.id}`))}
              />
            }
          >
            {row(
              parent,
              parents.map((p) => p.parent),
              pi,
              false,
            )}
            {children.map((c, i) => row(c, children, i, true))}
            {children.length === 0 ? (
              <Text variant="caption" color="warning">
                {t('admin.cat.noSubs')}
              </Text>
            ) : null}
          </Section>
        ))
      )}
    </AdminShell>
  );
}
