import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useStoreId } from '@/features/store-ops/hooks';
import { asLocalized, useLocalize, type LocalizedString } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { catalogImageUrl } from '@/lib/images';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { Json } from '@/types/database';
import {
  Badge,
  Button,
  Chip,
  ErrorState,
  IconButton,
  Sheet,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import {
  addSynonym,
  deleteBanner,
  deleteSection,
  deleteSynonym,
  fetchProductsByIds,
  listAdminProducts,
  reorderRows,
  saveBanner,
  saveCollection,
  saveSection,
  setCollectionProducts,
  type BannerRow,
  type CollectionRow,
  type HomeSectionRow,
  type SectionType,
} from './api';
import {
  AdminShell,
  ChoiceRow,
  ErrorList,
  Grid,
  ImageField,
  LocalizedInput,
  MoveButtons,
  NumberField,
  Section,
  SwitchRow,
  confirmAction,
  moved,
} from './components';
import {
  useAdminCategories,
  useBanners,
  useCollections,
  useRefreshCatalog,
  useSections,
  useSynonyms,
} from './hooks';
import { SLUG_RE, slugify } from './schema';

type Tab = 'banners' | 'sections' | 'collections' | 'synonyms';

export function MerchScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('banners');
  return (
    <AdminShell title={t('admin.nav.merch')} subtitle={t('admin.ui.merchSubtitle')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {(['banners', 'sections', 'collections', 'synonyms'] as const).map((k) => (
          <Chip
            key={k}
            label={t(`admin.merch.${k}`)}
            selected={tab === k}
            onPress={() => setTab(k)}
          />
        ))}
      </View>
      {tab === 'banners' ? (
        <Banners />
      ) : tab === 'sections' ? (
        <Sections />
      ) : tab === 'collections' ? (
        <Collections />
      ) : (
        <Synonyms />
      )}
    </AdminShell>
  );
}

// ---------- schedule helpers: "2026-11-01 09:00" (IST, as typed) <-> ISO ----------

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (s: string): string | null | 'invalid' => {
  if (!s.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return 'invalid';
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
  );
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
};

function ScheduleFields({
  starts,
  ends,
  onChange,
}: {
  starts: string;
  ends: string;
  onChange: (s: string, e: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Grid>
      <TextField
        label={t('admin.merch.startsAt')}
        value={starts}
        placeholder="2026-11-01 09:00"
        hint={t('admin.merch.scheduleHint')}
        onChangeText={(s) => onChange(s, ends)}
      />
      <TextField
        label={t('admin.merch.endsAt')}
        value={ends}
        placeholder="2026-11-15 23:59"
        onChangeText={(e) => onChange(starts, e)}
      />
    </Grid>
  );
}

const scheduleLabel = (
  starts: string | null,
  ends: string | null,
  t: (k: 'admin.merch.always') => string,
) =>
  starts || ends
    ? `${toLocalInput(starts) || '…'} → ${toLocalInput(ends) || '…'}`
    : t('admin.merch.always');

// ---------- banners ----------

type BannerForm = {
  id: number | null;
  image_path: string | null;
  title: LocalizedString;
  linkType: 'category' | 'product' | 'collection' | 'search' | 'none';
  linkValue: string;
  starts: string;
  ends: string;
  is_active: boolean;
};

function Banners() {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const storeId = useStoreId();
  const q = useBanners(storeId);
  const refresh = useRefreshCatalog();
  const [edit, setEdit] = useState<BannerForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (b?: BannerRow) => {
    setErr(null);
    const link = (b?.link ?? null) as { type?: BannerForm['linkType']; value?: string } | null;
    setEdit({
      id: b?.id ?? null,
      image_path: b?.image_path ?? null,
      title: asLocalized(b?.title),
      linkType: link?.type ?? 'none',
      linkValue: link?.value ?? '',
      starts: toLocalInput(b?.starts_at ?? null),
      ends: toLocalInput(b?.ends_at ?? null),
      is_active: b?.is_active ?? true,
    });
  };

  const save = async () => {
    if (!edit || !storeId) return;
    const s = fromLocalInput(edit.starts);
    const e = fromLocalInput(edit.ends);
    if (!edit.image_path) return setErr(t('admin.merch.errImage'));
    if (s === 'invalid' || e === 'invalid') return setErr(t('admin.merch.errDate'));
    if (edit.linkType !== 'none' && !edit.linkValue.trim()) return setErr(t('admin.merch.errLink'));
    setBusy(true);
    try {
      await saveBanner(edit.id, {
        store_id: storeId,
        image_path: edit.image_path,
        title: edit.title.en?.trim() ? (edit.title as Json) : null,
        link:
          edit.linkType === 'none' ? null : { type: edit.linkType, value: edit.linkValue.trim() },
        starts_at: s,
        ends_at: e,
        is_active: edit.is_active,
        sort_order: edit.id ? undefined : (q.data?.length ?? 0) + 1,
      });
      setEdit(null);
      refresh();
    } catch (x) {
      setErr(toAppError(x).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: BannerRow) => {
    if (
      !(await confirmAction(
        t('admin.merch.deleteBanner'),
        l(asLocalized(b.title)) || b.image_path,
        t('admin.remove'),
        t('common.cancel'),
      ))
    )
      return;
    try {
      await deleteBanner(b.id);
      refresh();
    } catch (x) {
      showToast(toAppError(x).message, 'danger');
    }
  };

  const reorder = async (list: BannerRow[], i: number, dir: -1 | 1) => {
    await reorderRows(
      'banners',
      moved(list, i, dir).map((b) => b.id),
    ).catch((x) => showToast(toAppError(x).message, 'danger'));
    refresh();
  };

  if (q.isPending) return <Skeleton width="100%" height={200} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <Section
      icon="image-multiple-outline"
      title={t('admin.merch.banners')}
      right={<Button title={t('admin.add')} icon="plus" onPress={() => open()} />}
    >
      {q.data.length === 0 ? <Text color="textMuted">{t('admin.merch.noBanners')}</Text> : null}
      {q.data.map((b, i, list) => {
        const url = catalogImageUrl(b.image_path);
        const link = b.link as { type?: string; value?: string } | null;
        return (
          <View
            key={b.id}
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View
              style={{
                width: 120,
                height: 60,
                borderRadius: radius.sm,
                overflow: 'hidden',
                backgroundColor: colors.surfaceAlt,
              }}
            >
              {url ? (
                <Image
                  source={{ uri: url }}
                  style={{ width: 120, height: 60 }}
                  contentFit="cover"
                />
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text weight="semibold">{l(asLocalized(b.title)) || t('admin.merch.untitled')}</Text>
              <Text variant="caption" color="textMuted">
                {link ? `${link.type}: ${link.value}` : t('admin.merch.noLink')} ·{' '}
                {scheduleLabel(b.starts_at, b.ends_at, t)}
              </Text>
            </View>
            {!b.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
            <MoveButtons
              onUp={() => void reorder(list, i, -1)}
              onDown={() => void reorder(list, i, 1)}
              disabledUp={i === 0}
              disabledDown={i === list.length - 1}
            />
            <IconButton
              icon="pencil-outline"
              accessibilityLabel={t('admin.edit')}
              onPress={() => open(b)}
            />
            <IconButton
              icon="delete-outline"
              color="danger"
              accessibilityLabel={t('admin.remove')}
              onPress={() => void remove(b)}
            />
          </View>
        );
      })}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t('admin.merch.editBanner') : t('admin.merch.newBanner')}
      >
        {edit ? (
          <View style={{ gap: spacing.md }}>
            <ErrorList message={err} />
            <ImageField
              label={t('admin.merch.bannerImage')}
              path={edit.image_path}
              onChange={(p) => setEdit({ ...edit, image_path: p })}
              folder="banners"
              width={1200}
              aspect={2}
            />
            <LocalizedInput
              label={t('admin.merch.altText')}
              value={edit.title}
              onChange={(title) => setEdit({ ...edit, title })}
              requiredEn={false}
            />
            <ChoiceRow
              label={t('admin.merch.linkTo')}
              value={edit.linkType}
              onChange={(linkType) => setEdit({ ...edit, linkType })}
              options={(['none', 'category', 'product', 'collection', 'search'] as const).map(
                (v) => ({ value: v, label: t(`admin.merch.link_${v}`) }),
              )}
            />
            {edit.linkType !== 'none' ? (
              <TextField
                label={t('admin.merch.linkValue')}
                value={edit.linkValue}
                autoCapitalize="none"
                hint={t(
                  edit.linkType === 'search'
                    ? 'admin.merch.linkSearchHint'
                    : 'admin.merch.linkSlugHint',
                )}
                onChangeText={(linkValue) => setEdit({ ...edit, linkValue })}
              />
            ) : null}
            <ScheduleFields
              starts={edit.starts}
              ends={edit.ends}
              onChange={(starts, ends) => setEdit({ ...edit, starts, ends })}
            />
            <SwitchRow
              label={t('admin.activeVisible')}
              value={edit.is_active}
              onChange={(is_active) => setEdit({ ...edit, is_active })}
            />
            <Button title={t('admin.save')} onPress={() => void save()} loading={busy} fullWidth />
          </View>
        ) : null}
      </Sheet>
    </Section>
  );
}

// ---------- home sections ----------

const SECTION_TYPES: SectionType[] = [
  'banner_carousel',
  'category_grid',
  'product_rail',
  'collection_rail',
  'buy_again',
];

type SectionForm = {
  id: number | null;
  type: SectionType;
  title: LocalizedString;
  config: Record<string, unknown>;
  starts: string;
  ends: string;
  is_active: boolean;
};

function Sections() {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const storeId = useStoreId();
  const q = useSections(storeId);
  const cats = useAdminCategories();
  const cols = useCollections();
  const refresh = useRefreshCatalog();
  const [edit, setEdit] = useState<SectionForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (s?: HomeSectionRow) => {
    setErr(null);
    setEdit({
      id: s?.id ?? null,
      type: s?.type ?? 'product_rail',
      title: asLocalized(s?.title),
      config: (s?.config ?? {}) as Record<string, unknown>,
      starts: toLocalInput(s?.starts_at ?? null),
      ends: toLocalInput(s?.ends_at ?? null),
      is_active: s?.is_active ?? true,
    });
  };

  const save = async () => {
    if (!edit || !storeId) return;
    const s = fromLocalInput(edit.starts);
    const e = fromLocalInput(edit.ends);
    if (s === 'invalid' || e === 'invalid') return setErr(t('admin.merch.errDate'));
    if (edit.type === 'product_rail' && !edit.config.collection_id && !edit.config.category_id)
      return setErr(t('admin.merch.errRail'));
    setBusy(true);
    try {
      await saveSection(edit.id, {
        store_id: storeId,
        type: edit.type,
        title: edit.title.en?.trim() ? (edit.title as Json) : null,
        config: edit.config as Json,
        starts_at: s,
        ends_at: e,
        is_active: edit.is_active,
        sort_order: edit.id ? undefined : (q.data?.length ?? 0) + 1,
      });
      setEdit(null);
      refresh();
    } catch (x) {
      setErr(toAppError(x).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: HomeSectionRow) => {
    if (
      !(await confirmAction(
        t('admin.merch.deleteSection'),
        t(`admin.merch.type_${s.type}`),
        t('admin.remove'),
        t('common.cancel'),
      ))
    )
      return;
    await deleteSection(s.id).catch((x) => showToast(toAppError(x).message, 'danger'));
    refresh();
  };

  const reorder = async (list: HomeSectionRow[], i: number, dir: -1 | 1) => {
    await reorderRows(
      'home_sections',
      moved(list, i, dir).map((s) => s.id),
    ).catch((x) => showToast(toAppError(x).message, 'danger'));
    refresh();
  };

  if (q.isPending) return <Skeleton width="100%" height={200} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const parents = (cats.data ?? []).filter((c) => c.parent_id === null);
  const subs = (cats.data ?? []).filter((c) => c.parent_id !== null);
  const idList = (v: unknown) => (Array.isArray(v) ? (v as number[]) : []);
  const toggleId = (key: string, id: number) => {
    if (!edit) return;
    const list = idList(edit.config[key]);
    setEdit({
      ...edit,
      config: {
        ...edit.config,
        [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      },
    });
  };

  return (
    <Section
      icon="view-dashboard-edit-outline"
      title={t('admin.merch.sections')}
      right={<Button title={t('admin.add')} icon="plus" onPress={() => open()} />}
    >
      <Text variant="caption" color="textMuted">
        {t('admin.merch.sectionsIntro')}
      </Text>
      {q.data.map((s, i, list) => (
        <View
          key={s.id}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing.md,
            paddingVertical: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text weight="semibold">
              {l(asLocalized(s.title)) || t(`admin.merch.type_${s.type}`)}
            </Text>
            <Text variant="caption" color="textMuted">
              {t(`admin.merch.type_${s.type}`)} · {scheduleLabel(s.starts_at, s.ends_at, t)}
            </Text>
          </View>
          {!s.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
          <MoveButtons
            onUp={() => void reorder(list, i, -1)}
            onDown={() => void reorder(list, i, 1)}
            disabledUp={i === 0}
            disabledDown={i === list.length - 1}
          />
          <IconButton
            icon="pencil-outline"
            accessibilityLabel={t('admin.edit')}
            onPress={() => open(s)}
          />
          <IconButton
            icon="delete-outline"
            color="danger"
            accessibilityLabel={t('admin.remove')}
            onPress={() => void remove(s)}
          />
        </View>
      ))}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t('admin.merch.editSection') : t('admin.merch.newSection')}
      >
        {edit ? (
          <View style={{ gap: spacing.md }}>
            <ErrorList message={err} />
            <ChoiceRow
              label={t('admin.merch.sectionType')}
              value={edit.type}
              onChange={(type) => setEdit({ ...edit, type, config: {} })}
              options={SECTION_TYPES.map((v) => ({ value: v, label: t(`admin.merch.type_${v}`) }))}
            />
            <LocalizedInput
              label={t('admin.merch.sectionTitle')}
              value={edit.title}
              onChange={(title) => setEdit({ ...edit, title })}
              requiredEn={false}
            />
            {edit.type === 'category_grid' ? (
              <View style={{ gap: spacing.xs }}>
                <Text variant="caption" weight="semibold" color="textMuted">
                  {t('admin.merch.pickCategories')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {parents.map((c) => (
                    <Chip
                      key={c.id}
                      label={l(asLocalized(c.name))}
                      selected={idList(edit.config.category_ids).includes(c.id)}
                      onPress={() => toggleId('category_ids', c.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            {edit.type === 'collection_rail' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {(cols.data ?? []).map((c) => (
                  <Chip
                    key={c.id}
                    label={l(asLocalized(c.title))}
                    selected={idList(edit.config.collection_ids).includes(c.id)}
                    onPress={() => toggleId('collection_ids', c.id)}
                  />
                ))}
              </View>
            ) : null}
            {edit.type === 'product_rail' ? (
              <View style={{ gap: spacing.md }}>
                <ChoiceRow
                  label={t('admin.merch.railFromCollection')}
                  value={(edit.config.collection_id as number | undefined) ?? null}
                  onChange={(v) => setEdit({ ...edit, config: v ? { collection_id: v } : {} })}
                  options={[
                    { value: null as number | null, label: t('admin.none') },
                    ...(cols.data ?? []).map((c) => ({
                      value: c.id as number | null,
                      label: l(asLocalized(c.title)),
                    })),
                  ]}
                />
                <ChoiceRow
                  label={t('admin.merch.railFromCategory')}
                  value={(edit.config.category_id as number | undefined) ?? null}
                  onChange={(v) =>
                    setEdit({
                      ...edit,
                      config: v
                        ? {
                            category_id: v,
                            sort: edit.config.sort ?? 'discount',
                            limit: edit.config.limit ?? 12,
                          }
                        : {},
                    })
                  }
                  options={[
                    { value: null as number | null, label: t('admin.none') },
                    ...subs.map((c) => ({
                      value: c.id as number | null,
                      label: l(asLocalized(c.name)),
                    })),
                  ]}
                />
                {edit.config.category_id ? (
                  <Grid>
                    <ChoiceRow
                      label={t('admin.merch.railSort')}
                      value={String(edit.config.sort ?? 'discount')}
                      onChange={(sort) => setEdit({ ...edit, config: { ...edit.config, sort } })}
                      options={['discount', 'newest', 'price_asc', 'relevance'].map((v) => ({
                        value: v,
                        label: t(`catalog.sortOptions.${v}` as 'catalog.sortOptions.discount'),
                      }))}
                    />
                    <NumberField
                      label={t('admin.merch.railLimit')}
                      value={Number(edit.config.limit ?? 12)}
                      onChange={(n) =>
                        setEdit({ ...edit, config: { ...edit.config, limit: n ?? 12 } })
                      }
                    />
                  </Grid>
                ) : null}
              </View>
            ) : null}
            <ScheduleFields
              starts={edit.starts}
              ends={edit.ends}
              onChange={(starts, ends) => setEdit({ ...edit, starts, ends })}
            />
            <SwitchRow
              label={t('admin.activeVisible')}
              value={edit.is_active}
              onChange={(is_active) => setEdit({ ...edit, is_active })}
            />
            <Button title={t('admin.save')} onPress={() => void save()} loading={busy} fullWidth />
          </View>
        ) : null}
      </Sheet>
    </Section>
  );
}

// ---------- collections ----------

type CollectionForm = {
  id: number | null;
  slug: string;
  title: LocalizedString;
  image_path: string | null;
  is_active: boolean;
  products: { id: number; name: Json }[];
};

function Collections() {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const q = useCollections();
  const refresh = useRefreshCatalog();
  const [edit, setEdit] = useState<CollectionForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<{ id: number; name: Json }[]>([]);

  const open = async (
    c?: CollectionRow & { collection_products: { product_id: number; sort_order: number }[] },
  ) => {
    setErr(null);
    setSearch('');
    setFound([]);
    const ids = [...(c?.collection_products ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((x) => x.product_id);
    const products = await fetchProductsByIds(ids).catch(() => []);
    setEdit({
      id: c?.id ?? null,
      slug: c?.slug ?? '',
      title: asLocalized(c?.title),
      image_path: c?.image_path ?? null,
      is_active: c?.is_active ?? true,
      products: ids.map(
        (id) => products.find((p) => p.id === id) ?? { id, name: { en: `#${id}` } },
      ),
    });
  };

  const find = async (text: string) => {
    setSearch(text);
    if (text.trim().length < 2) return setFound([]);
    const res = await listAdminProducts({
      q: text,
      categoryIds: null,
      status: 'active',
      page: 0,
    }).catch(() => []);
    setFound(res.slice(0, 8).map((p) => ({ id: p.id, name: p.name })));
  };

  const save = async () => {
    if (!edit) return;
    if (!edit.title.en?.trim()) return setErr(t('admin.cat.errName'));
    const slug = edit.slug || slugify(edit.title.en);
    if (!SLUG_RE.test(slug)) return setErr(t('admin.cat.errSlug'));
    setBusy(true);
    try {
      const row = await saveCollection(edit.id, {
        slug,
        title: edit.title as Json,
        image_path: edit.image_path,
        is_active: edit.is_active,
      });
      await setCollectionProducts(
        row.id,
        edit.products.map((p) => p.id),
      );
      setEdit(null);
      refresh();
    } catch (x) {
      setErr(toAppError(x).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Skeleton width="100%" height={200} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <Section
      icon="view-grid-plus-outline"
      title={t('admin.merch.collections')}
      right={<Button title={t('admin.add')} icon="plus" onPress={() => void open()} />}
    >
      <Text variant="caption" color="textMuted">
        {t('admin.merch.collectionsIntro')}
      </Text>
      {q.data.map((c) => (
        <View
          key={c.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingVertical: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text weight="semibold">{l(asLocalized(c.title))}</Text>
            <Text variant="caption" color="textMuted">
              {c.slug} · {t('admin.merch.productsCount', { count: c.collection_products.length })}
            </Text>
          </View>
          {!c.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
          <IconButton
            icon="pencil-outline"
            accessibilityLabel={t('admin.edit')}
            onPress={() => void open(c)}
          />
        </View>
      ))}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t('admin.merch.editCollection') : t('admin.merch.newCollection')}
      >
        {edit ? (
          <View style={{ gap: spacing.md }}>
            <ErrorList message={err} />
            <LocalizedInput
              label={t('admin.merch.collectionTitle')}
              value={edit.title}
              onChange={(title) => setEdit({ ...edit, title })}
            />
            <TextField
              label={t('admin.slug')}
              value={edit.slug}
              placeholder={slugify(edit.title.en ?? '')}
              autoCapitalize="none"
              onChangeText={(slug) => setEdit({ ...edit, slug: slug.toLowerCase() })}
            />
            <ImageField
              label={t('admin.merch.collectionImage')}
              path={edit.image_path}
              onChange={(p) => setEdit({ ...edit, image_path: p })}
              folder="collections"
              width={600}
            />
            <SwitchRow
              label={t('admin.activeVisible')}
              value={edit.is_active}
              onChange={(is_active) => setEdit({ ...edit, is_active })}
            />
            <Text weight="semibold">{t('admin.merch.collectionProducts')}</Text>
            {edit.products.map((p, i) => (
              <View
                key={p.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <Text style={{ flex: 1 }} numberOfLines={1}>
                  {l(asLocalized(p.name))}
                </Text>
                <MoveButtons
                  onUp={() => setEdit({ ...edit, products: moved(edit.products, i, -1) })}
                  onDown={() => setEdit({ ...edit, products: moved(edit.products, i, 1) })}
                  disabledUp={i === 0}
                  disabledDown={i === edit.products.length - 1}
                />
                <IconButton
                  icon="close"
                  accessibilityLabel={t('admin.remove')}
                  onPress={() =>
                    setEdit({ ...edit, products: edit.products.filter((x) => x.id !== p.id) })
                  }
                />
              </View>
            ))}
            <TextField
              label={t('admin.merch.addProduct')}
              value={search}
              placeholder={t('admin.prod.searchPh')}
              onChangeText={(s) => void find(s)}
            />
            {found
              .filter((f) => !edit.products.some((p) => p.id === f.id))
              .map((f) => (
                <Chip
                  key={f.id}
                  icon="plus"
                  label={l(asLocalized(f.name))}
                  onPress={() => setEdit({ ...edit, products: [...edit.products, f] })}
                />
              ))}
            <Button title={t('admin.save')} onPress={() => void save()} loading={busy} fullWidth />
          </View>
        ) : null}
      </Sheet>
    </Section>
  );
}

// ---------- search synonyms ----------

function Synonyms() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useSynonyms();
  const [term, setTerm] = useState('');
  const [mapsTo, setMapsTo] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    try {
      await addSynonym(term, mapsTo);
      setTerm('');
      void q.refetch();
    } catch (x) {
      setErr(toAppError(x).message);
    }
  };

  const remove = async (id: number) => {
    await deleteSynonym(id).catch((x) => showToast(toAppError(x).message, 'danger'));
    void q.refetch();
  };

  return (
    <Section icon="translate" title={t('admin.merch.synonyms')}>
      <Text variant="caption" color="textMuted">
        {t('admin.merch.synonymsIntro')}
      </Text>
      <ErrorList message={err} />
      <Grid cols={3}>
        <TextField
          label={t('admin.merch.term')}
          value={term}
          placeholder="doodh / दूध"
          onChangeText={setTerm}
        />
        <TextField
          label={t('admin.merch.mapsTo')}
          value={mapsTo}
          placeholder="milk"
          autoCapitalize="none"
          onChangeText={setMapsTo}
        />
        <View style={{ justifyContent: 'flex-end' }}>
          <Button
            title={t('admin.add')}
            icon="plus"
            onPress={() => void add()}
            disabled={!term.trim() || !mapsTo.trim()}
          />
        </View>
      </Grid>
      {q.isPending ? <Skeleton width="100%" height={120} /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(q.data ?? []).map((s) => (
        <View
          key={s.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingVertical: spacing.xs,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ flex: 1 }}>
            {s.term} → <Text weight="semibold">{s.maps_to}</Text>
          </Text>
          <IconButton
            icon="delete-outline"
            color="danger"
            accessibilityLabel={t('admin.remove')}
            onPress={() => void remove(s.id)}
          />
        </View>
      ))}
    </Section>
  );
}
