import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useUserId } from '@/features/auth/store';
import {
  AdminShell,
  ChoiceRow,
  confirmAction,
  Grid,
  LocalizedInput,
  Section,
} from '@/features/admin/components';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { Badge, Button, Card, ErrorState, showToast, Skeleton, Text, TextField } from '@/ui';

import {
  cancelCampaign,
  parseScheduleIST,
  previewAudience,
  saveCampaign,
  scheduleCampaign,
  SEGMENT_PARAM,
  SEGMENT_TYPES,
  sendCampaign,
  useCampaigns,
  useInvalidateCampaigns,
  type AudiencePreview,
  type CampaignDraft,
  type CampaignRow,
  type SegmentType,
} from './admin';

type LinkType = 'none' | 'product' | 'category' | 'collection' | 'search';

const EMPTY: CampaignDraft = {
  title: {},
  body: {},
  link: null,
  segment: { type: 'all' },
};

/**
 * Admin: send a localized notification to a customer segment. The server enforces caps
 * (1 per 72 h, 2 per week per user), quiet hours (9 PM – 8 AM IST) and opt-outs.
 */
export function CampaignsScreen() {
  const { t } = useTranslation();
  const uid = useUserId();
  const list = useCampaigns();
  const refresh = useInvalidateCampaigns();
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY);
  const [linkType, setLinkType] = useState<LinkType>('none');
  const [linkValue, setLinkValue] = useState('');
  const [param, setParam] = useState('');
  const [when, setWhen] = useState('');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'test' | 'send' | 'schedule'>(null);

  const paramKey = SEGMENT_PARAM[draft.segment.type];
  const segment = paramKey
    ? { type: draft.segment.type, [paramKey]: Number(param) || undefined }
    : { type: draft.segment.type };
  const current: CampaignDraft = {
    ...draft,
    segment,
    link:
      linkType === 'none' || !linkValue.trim() ? null : { type: linkType, value: linkValue.trim() },
  };
  const valid =
    !!current.title.en?.trim() && !!current.body.en?.trim() && (!paramKey || !!Number(param));

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      const msg = toAppError(e).message;
      showToast(msg.includes('quiet hours') ? t('campaigns.quietHours') : msg, 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const ensureSaved = async () => {
    const id = await saveCampaign(current, uid);
    setDraft((d) => ({ ...d, id }));
    return id;
  };

  const reset = () => {
    setDraft(EMPTY);
    setLinkType('none');
    setLinkValue('');
    setParam('');
    setWhen('');
    setPreview(null);
  };

  const edit = (c: CampaignRow) => {
    const seg = (c.segment ?? { type: 'all' }) as { type: SegmentType } & Record<string, number>;
    const link = c.link as CampaignDraft['link'];
    const key = SEGMENT_PARAM[seg.type];
    setDraft({
      id: c.id,
      title: asLocalized(c.title),
      body: asLocalized(c.body),
      link,
      segment: seg,
    });
    setLinkType(link?.type ?? 'none');
    setLinkValue(link?.value ? String(link.value) : '');
    setParam(key && seg[key] ? String(seg[key]) : '');
    setPreview(null);
  };

  return (
    <AdminShell title={t('admin.nav.campaigns')}>
      <Section
        title={draft.id ? t('campaigns.editTitle', { id: draft.id }) : t('campaigns.newTitle')}
        right={
          draft.id ? <Button title={t('campaigns.new')} variant="ghost" onPress={reset} /> : null
        }
      >
        <LocalizedInput
          label={t('campaigns.title')}
          value={draft.title}
          onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
        />
        <LocalizedInput
          label={t('campaigns.body')}
          value={draft.body}
          onChange={(v) => setDraft((d) => ({ ...d, body: v }))}
          multiline
        />
        <ChoiceRow
          label={t('campaigns.segment')}
          value={draft.segment.type}
          onChange={(type) => {
            setDraft((d) => ({ ...d, segment: { type } }));
            setParam('');
            setPreview(null);
          }}
          options={SEGMENT_TYPES.map((s) => ({ value: s, label: t(`campaigns.segments.${s}`) }))}
        />
        {paramKey ? (
          <TextField
            label={t(`campaigns.params.${paramKey}`)}
            value={param}
            onChangeText={(v) => {
              setParam(v.replace(/\D/g, ''));
              setPreview(null);
            }}
            keyboardType="number-pad"
          />
        ) : null}
        <Grid>
          <ChoiceRow
            label={t('campaigns.link')}
            value={linkType}
            onChange={setLinkType}
            options={(['none', 'product', 'category', 'collection', 'search'] as LinkType[]).map(
              (v) => ({ value: v, label: t(`campaigns.links.${v}`) }),
            )}
          />
          {linkType !== 'none' ? (
            <TextField
              label={t('campaigns.linkValue')}
              value={linkValue}
              onChangeText={setLinkValue}
              placeholder={linkType === 'search' ? 'doodh' : 'amul-taaza-milk'}
              autoCapitalize="none"
            />
          ) : null}
        </Grid>

        {preview ? (
          <Card style={{ gap: 4 }}>
            <Text weight="semibold">
              {t('campaigns.previewLine', {
                audience: preview.audience,
                send: preview.will_receive,
                capped: preview.capped,
              })}
            </Text>
            {preview.quiet_hours_now ? (
              <Text variant="caption" color="warning">
                {t('campaigns.quietHours')}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            title={t('campaigns.saveDraft')}
            variant="secondary"
            disabled={!valid}
            loading={busy === 'save'}
            onPress={() =>
              void run('save', async () => {
                await ensureSaved();
                showToast(t('campaigns.saved'), 'success');
              })
            }
          />
          <Button
            title={t('campaigns.preview')}
            variant="secondary"
            disabled={!!paramKey && !Number(param)}
            loading={busy === 'preview'}
            onPress={() =>
              void run('preview', async () => setPreview(await previewAudience(segment)))
            }
          />
          <Button
            title={t('campaigns.sendTest')}
            variant="ghost"
            disabled={!valid}
            loading={busy === 'test'}
            onPress={() =>
              void run('test', async () => {
                const id = await ensureSaved();
                await sendCampaign(id, true);
                showToast(t('campaigns.testSent'), 'success');
              })
            }
          />
          <Button
            title={t('campaigns.sendNow')}
            disabled={!valid}
            loading={busy === 'send'}
            onPress={() =>
              void run('send', async () => {
                const p = await previewAudience(segment);
                const ok = await confirmAction(
                  t('campaigns.confirmTitle'),
                  t('campaigns.confirmBody', { count: p.will_receive }),
                  t('campaigns.sendNow'),
                  t('common.cancel'),
                );
                if (!ok) return;
                const id = await ensureSaved();
                const r = await sendCampaign(id, false);
                showToast(t('campaigns.sent', { count: r.sent }), 'success');
                reset();
              })
            }
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.sm,
            alignItems: 'flex-end',
          }}
        >
          <View style={{ flexGrow: 1, minWidth: 220 }}>
            <TextField
              label={t('campaigns.scheduleLabel')}
              hint={t('campaigns.scheduleHint')}
              value={when}
              onChangeText={setWhen}
              placeholder="2026-11-14 10:30"
              autoCapitalize="none"
            />
          </View>
          <Button
            title={t('campaigns.schedule')}
            variant="secondary"
            disabled={!valid || !parseScheduleIST(when)}
            loading={busy === 'schedule'}
            onPress={() =>
              void run('schedule', async () => {
                const at = parseScheduleIST(when);
                if (!at) return;
                const id = await ensureSaved();
                await scheduleCampaign(id, at);
                showToast(t('campaigns.scheduled'), 'success');
                reset();
              })
            }
          />
        </View>
      </Section>

      <Section title={t('campaigns.history')}>
        {list.isPending ? (
          <Skeleton width="100%" height={120} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <Text color="textMuted">{t('campaigns.none')}</Text>
        ) : (
          list.data.map((c) => (
            <CampaignRowView
              key={c.id}
              c={c}
              onEdit={() => edit(c)}
              onCancel={() =>
                void run('save', async () => {
                  await cancelCampaign(c.id);
                })
              }
            />
          ))
        )}
      </Section>
    </AdminShell>
  );
}

const STATUS_TONE = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
} as const;

function CampaignRowView({
  c,
  onEdit,
  onCancel,
}: {
  c: CampaignRow;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const lang = useSettings((s) => s.language);
  const status = c.status as keyof typeof STATUS_TONE;
  const editable = status === 'draft' || status === 'scheduled';
  return (
    <View style={{ gap: 4, paddingVertical: spacing.xs }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}
      >
        <Text weight="semibold" style={{ flexShrink: 1 }}>
          {l(asLocalized(c.title))}
        </Text>
        <Badge label={t(`campaigns.status.${status}`)} tone={STATUS_TONE[status] ?? 'neutral'} />
      </View>
      <Text variant="caption" color="textMuted">
        {status === 'sent' && c.sent_at
          ? t('campaigns.sentLine', {
              when: formatDateTime(c.sent_at, lang),
              count: c.recipients,
              capped: c.skipped_capped,
            })
          : status === 'scheduled' && c.scheduled_at
            ? t('campaigns.scheduledFor', { when: formatDateTime(c.scheduled_at, lang) })
            : formatDateTime(c.created_at, lang)}
        {c.last_error ? ` · ${c.last_error}` : ''}
      </Text>
      {editable ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('campaigns.edit')} variant="ghost" onPress={onEdit} />
          {status === 'scheduled' ? (
            <Button title={t('campaigns.cancelSchedule')} variant="ghost" onPress={onCancel} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
