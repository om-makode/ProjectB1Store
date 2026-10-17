import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useUserId } from '@/features/auth/store';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { logger } from '@/lib/logger';
import { goBack } from '@/lib/navigation';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  ScreenHeader,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import { canReportIssue, reportOrderIssue, uploadIssuePhoto, type IssueType } from './api';
import { orderActionMessage } from './errors';
import { orderKeys, useOrderDetail } from './hooks';
import { canAttachPhotos, pickAndCompressPhoto, type PickedPhoto } from './photos';

const TYPES: IssueType[] = ['missing_item', 'damaged', 'wrong_item', 'quality', 'other'];

/** Same rule as report_order_issue(). */
export const issueNeedsPhoto = (t: IssueType) =>
  t === 'damaged' || t === 'wrong_item' || t === 'quality';

const MAX_PHOTOS = 3;

export function ReportIssueScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const qc = useQueryClient();
  const uid = useUserId();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrderDetail(id);
  const order = q.data;

  const [type, setType] = useState<IssueType | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  const addPhoto = async () => {
    try {
      const p = await pickAndCompressPhoto();
      if (p === 'denied') showToast(t('issue.photoPermission'), 'warning');
      else if (p) setPhotos((ps) => [...ps, p].slice(0, MAX_PHOTOS));
    } catch (e) {
      logger.warn('pick photo failed', String(e));
      showToast(t('errors.server'), 'danger');
    }
  };

  const photoMissing = !!type && issueNeedsPhoto(type) && photos.length === 0;

  const submit = async () => {
    if (!order || !type || !uid || photoMissing) return;
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const p of photos) paths.push(await uploadIssuePhoto(uid, order.id, p));
      await reportOrderIssue({
        orderId: order.id,
        type,
        message,
        orderItemId: itemId,
        photoPaths: paths,
      });
      void qc.invalidateQueries({ queryKey: orderKeys.issues(order.id) });
      showToast(t('issue.sent'), 'success');
      goBack(`/order/${order.id}`);
    } catch (e) {
      showToast(orderActionMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen maxWidth={layout.readableMax} scroll padded edges={['top', 'bottom']}>
      <ScreenHeader title={t('issue.title')} subtitle={order?.order_number} />
      {q.isPending ? (
        <Skeleton width="100%" height={240} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : order && !canReportIssue(order) ? (
        <Card>
          <Text>{t('orderErrors.ISSUE_WINDOW_CLOSED')}</Text>
        </Card>
      ) : order ? (
        <>
          <Text color="textMuted">{t('issue.windowHint')}</Text>

          <Text variant="title" accessibilityRole="header">
            {t('issue.typeLabel')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {TYPES.map((ty) => (
              <Chip
                key={ty}
                label={t(`issue.types.${ty}`)}
                selected={type === ty}
                onPress={() => setType(ty)}
              />
            ))}
          </View>

          <Text variant="title" accessibilityRole="header">
            {t('issue.itemLabel')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Chip
              label={t('issue.wholeOrder')}
              selected={itemId === null}
              onPress={() => setItemId(null)}
            />
            {order.order_items.map((i) => (
              <Chip
                key={i.id}
                label={l(asLocalized(i.name_snapshot))}
                selected={itemId === i.id}
                onPress={() => setItemId(i.id)}
              />
            ))}
          </View>

          <TextField
            label={t('issue.message')}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={1000}
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />

          {canAttachPhotos() ? (
            <View style={{ gap: spacing.sm }}>
              <Text weight="semibold">{t('issue.photos', { count: photos.length })}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                {photos.map((p, i) => (
                  <View key={p.uri}>
                    <Image
                      source={{ uri: p.uri }}
                      style={{ width: 88, height: 88, borderRadius: radius.md }}
                      contentFit="cover"
                    />
                    <View style={{ position: 'absolute', top: -8, right: -8 }}>
                      <IconButton
                        icon="close-circle"
                        color="danger"
                        accessibilityLabel={t('issue.removePhoto')}
                        onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                      />
                    </View>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('issue.addPhoto')}
                    onPress={addPhoto}
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text color="primary" weight="semibold" align="center">
                      + {t('issue.addPhoto')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {photoMissing ? (
                <Text variant="caption" color="danger">
                  {t('issue.photoRequired')}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Button
            title={t('issue.submit')}
            onPress={submit}
            loading={busy}
            disabled={!type || photoMissing}
            fullWidth
          />
        </>
      ) : null}
    </Screen>
  );
}
