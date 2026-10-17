import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import { issuePhotoUrl, resolveIssue, type StaffIssue } from './api';
import { staffErrorMessage } from './errors';
import { useOpenIssues, useStaffAction } from './hooks';
import { StoreNav } from './StoreGate';

function IssueCard({ issue }: { issue: StaffIssue }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const [note, setNote] = useState('');
  const resolve = useStaffAction(resolveIssue);
  const name = (issue.orders?.address_snapshot as Record<string, unknown> | null)?.receiver_name;

  const done = (status: 'resolved' | 'rejected') =>
    resolve.mutate([issue.id, status, note], {
      onSuccess: () => showToast(t('storeOps.issues.done'), 'success'),
      onError: (e) => showToast(staffErrorMessage(e), 'danger'),
    });

  const openPhoto = async (path: string) => {
    const url = await issuePhotoUrl(path);
    if (url) void Linking.openURL(url);
  };

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text
            weight="bold"
            onPress={() =>
              router.push({ pathname: '/store/order/[id]', params: { id: issue.order_id } })
            }
          >
            {issue.orders?.order_number ?? ''}
          </Text>
          <Text variant="caption" color="textMuted">
            {formatDateTime(issue.created_at, lang)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          <Badge label={t(`issue.types.${issue.type}`)} tone="warning" />
          {typeof name === 'string' ? <Badge label={name} tone="neutral" /> : null}
        </View>
        {issue.message ? <Text>{issue.message}</Text> : null}
        {issue.photo_paths.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {issue.photo_paths.map((p, i) => (
              <Button
                key={p}
                title={t('storeOps.issues.viewPhoto', { n: i + 1 })}
                icon="image-outline"
                variant="ghost"
                onPress={() => void openPhoto(p)}
              />
            ))}
          </View>
        ) : null}
        <TextField
          label={t('storeOps.issues.note')}
          placeholder={t('storeOps.issues.notePlaceholder')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1000}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Button
            title={t('storeOps.issues.resolve')}
            disabled={!note.trim() || resolve.isPending}
            loading={resolve.isPending && resolve.variables?.[1] === 'resolved'}
            onPress={() => done('resolved')}
          />
          <Button
            title={t('storeOps.issues.reject')}
            variant="ghost"
            disabled={!note.trim() || resolve.isPending}
            onPress={() => done('rejected')}
          />
        </View>
      </View>
    </Card>
  );
}

export function IssuesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const issues = useOpenIssues();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StoreNav />
      {issues.isPending ? (
        <View style={{ padding: spacing.md }}>
          <Skeleton width="100%" height={140} />
        </View>
      ) : issues.isError ? (
        <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />
      ) : (
        <FlatList
          data={issues.data}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          renderItem={({ item }) => <IssueCard issue={item} />}
          ListEmptyComponent={
            <EmptyState icon="check-circle-outline" title={t('storeOps.issues.empty')} />
          }
          refreshing={issues.isRefetching}
          onRefresh={() => void issues.refetch()}
        />
      )}
    </SafeAreaView>
  );
}
