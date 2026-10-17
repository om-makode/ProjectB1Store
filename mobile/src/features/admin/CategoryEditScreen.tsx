import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatAttribute } from '@/features/catalog/attributes';
import { asLocalized, useLocalize, type LocalizedString } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { spacing } from '@/theme/tokens';
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

import { productsMissingAttribute, saveCategory, type CategoryRow } from './api';
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
  moved,
} from './components';
import { fieldsOf, useAdminCategories, useRefreshCatalog } from './hooks';
import {
  FIELD_KEY_RE,
  FIELD_TYPES,
  SLUG_RE,
  keyFromLabel,
  parseBuckets,
  schemaProblems,
  slugify,
  type AdminField,
  type FieldType,
  type FilterEntry,
} from './schema';

type Form = {
  name: LocalizedString;
  slug: string;
  parent_id: number | null;
  icon: string;
  color: string;
  image_path: string | null;
  is_active: boolean;
  fields: AdminField[];
  filters: FilterEntry[];
};

const emptyForm = (parent: number | null): Form => ({
  name: {},
  slug: '',
  parent_id: parent,
  icon: '',
  color: '',
  image_path: null,
  is_active: true,
  fields: [],
  filters: parent
    ? []
    : [{ type: 'brand' }, { type: 'price', buckets: [0, 50, 100, 200] }, { type: 'veg' }],
});

const fromRow = (c: CategoryRow): Form => ({
  name: asLocalized(c.name),
  slug: c.slug,
  parent_id: c.parent_id,
  icon: c.icon ?? '',
  color: c.color ?? '',
  image_path: c.image_path,
  is_active: c.is_active,
  fields: fieldsOf(c),
  filters: Array.isArray(c.filters) ? (c.filters as unknown as FilterEntry[]) : [],
});

/** Loads the category list, then mounts the editor seeded with the saved row (or a blank form). */
export function CategoryEditScreen({
  id,
  parentId,
}: {
  id: number | null;
  parentId: number | null;
}) {
  const { t } = useTranslation();
  const cats = useAdminCategories();
  const existing = id ? cats.data?.find((c) => c.id === id) : undefined;

  if (cats.isPending) {
    return (
      <AdminShell title={t('admin.cat.edit')}>
        <Skeleton width="100%" height={300} />
      </AdminShell>
    );
  }
  if (cats.error || (id && !existing)) {
    return (
      <AdminShell title={t('admin.cat.edit')}>
        <ErrorState
          error={cats.error ?? new Error('not found')}
          onRetry={() => void cats.refetch()}
        />
      </AdminShell>
    );
  }
  return (
    <CategoryEditor
      id={id}
      categories={cats.data}
      savedFields={existing ? fieldsOf(existing) : []}
      initial={existing ? fromRow(existing) : emptyForm(parentId)}
    />
  );
}

function CategoryEditor({
  id,
  categories,
  savedFields,
  initial,
}: {
  id: number | null;
  categories: CategoryRow[];
  savedFields: AdminField[];
  initial: Form;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const refresh = useRefreshCatalog();
  const [form, setForm] = useState<Form>(initial);
  const [slugTouched, setSlugTouched] = useState(!!id);
  const [editing, setEditing] = useState<{ index: number | null; field: AdminField } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parents = categories.filter((c) => c.parent_id === null && c.id !== id);
  const parent = form.parent_id ? categories.find((c) => c.id === form.parent_id) : undefined;
  const inherited = parent ? fieldsOf(parent) : [];
  const hasChildren = !!id && categories.some((c) => c.parent_id === id);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const problems = schemaProblems(savedFields, form.fields);
  const isSaved = (key: string) => savedFields.some((f) => f.key === key);
  const allFields = [
    ...inherited.filter((p) => !form.fields.some((f) => f.key === p.key)),
    ...form.fields,
  ];

  const save = async () => {
    setError(null);
    if (!form.name.en?.trim()) return setError(t('admin.cat.errName'));
    if (!SLUG_RE.test(form.slug)) return setError(t('admin.cat.errSlug'));
    if (form.color && !/^#[0-9A-Fa-f]{6}$/.test(form.color))
      return setError(t('admin.cat.errColor'));
    if (problems.length)
      return setError(problems.map((p) => t(`admin.schema.${p.code}`, { key: p.key })).join('\n'));
    setSaving(true);
    try {
      const row = await saveCategory(id, {
        name: form.name as Json,
        slug: form.slug,
        parent_id: form.parent_id,
        icon: form.icon.trim() || null,
        color: form.color.trim() || null,
        image_path: form.image_path,
        is_active: form.is_active,
        attribute_schema: { fields: form.fields } as unknown as Json,
        filters: form.filters as unknown as Json,
      });
      refresh();
      showToast(t('admin.saved'), 'success');
      if (!id) router.replace(`/admin/categories/edit?id=${row.id}` as Href);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const upsertField = (f: AdminField) => {
    if (!editing) return;
    const fields =
      editing.index === null
        ? [...form.fields, f]
        : form.fields.map((x, i) => (i === editing.index ? f : x));
    set('fields', fields);
    setEditing(null);
  };

  return (
    <AdminShell
      title={id ? l(form.name) || t('admin.cat.edit') : t('admin.cat.new')}
      back={'/admin/categories' as Href}
      actions={
        <Button
          title={t('admin.save')}
          icon="content-save"
          onPress={() => void save()}
          loading={saving}
        />
      }
      footer={
        <Button
          title={t('admin.save')}
          icon="content-save"
          size="lg"
          onPress={() => void save()}
          loading={saving}
        />
      }
    >
      <ErrorList message={error} />

      <Section icon="shape-outline" title={t('admin.cat.basics')}>
        <LocalizedInput
          label={t('admin.cat.name')}
          value={form.name}
          onChange={(v) => {
            set('name', v);
            if (!slugTouched) set('slug', slugify(v.en ?? ''));
          }}
        />
        <Grid>
          <TextField
            label={t('admin.slug')}
            value={form.slug}
            autoCapitalize="none"
            hint={t('admin.slugHint')}
            onChangeText={(s) => {
              setSlugTouched(true);
              set('slug', s.toLowerCase());
            }}
            error={form.slug && !SLUG_RE.test(form.slug) ? t('admin.cat.errSlug') : null}
          />
          <TextField
            label={t('admin.cat.icon')}
            value={form.icon}
            autoCapitalize="none"
            hint={t('admin.cat.iconHint')}
            onChangeText={(s) => set('icon', s)}
          />
          <TextField
            label={t('admin.cat.color')}
            value={form.color}
            autoCapitalize="none"
            placeholder="#2563EB"
            onChangeText={(s) => set('color', s)}
          />
        </Grid>
        {!hasChildren ? (
          <ChoiceRow
            label={t('admin.cat.parent')}
            value={form.parent_id}
            onChange={(v) => set('parent_id', v)}
            options={[
              { value: null, label: t('admin.cat.topLevel') },
              ...parents.map((p) => ({
                value: p.id as number | null,
                label: l(asLocalized(p.name)),
              })),
            ]}
          />
        ) : (
          <Text variant="caption" color="textMuted">
            {t('admin.cat.hasChildren')}
          </Text>
        )}
        <ImageField
          label={t('admin.cat.image')}
          path={form.image_path}
          onChange={(p) => set('image_path', p)}
          folder="categories"
          width={400}
        />
        <SwitchRow
          label={t('admin.activeVisible')}
          value={form.is_active}
          onChange={(v) => set('is_active', v)}
        />
      </Section>

      <Section
        icon="form-select"
        title={t('admin.schema.title')}
        right={
          <Button
            title={t('admin.schema.addField')}
            icon="plus"
            variant="secondary"
            onPress={() => setEditing({ index: null, field: { key: '', type: 'text', label: {} } })}
          />
        }
      >
        <Text variant="caption" color="textMuted">
          {t(form.parent_id ? 'admin.schema.introSub' : 'admin.schema.introParent')}
        </Text>
        {inherited.length ? (
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" weight="semibold" color="textMuted">
              {t('admin.schema.inherited', { name: l(asLocalized(parent?.name)) })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {inherited.map((f) => (
                <Badge key={f.key} label={`${l(f.label)} (${f.type})`} tone="neutral" />
              ))}
            </View>
          </View>
        ) : null}
        {form.fields.length === 0 ? <Text color="textMuted">{t('admin.schema.none')}</Text> : null}
        {form.fields.map((f, i) => (
          <FieldRow
            key={`${f.key}-${i}`}
            field={f}
            saved={isSaved(f.key)}
            categoryId={id}
            onEdit={() => setEditing({ index: i, field: f })}
            onToggleDeprecated={() =>
              set(
                'fields',
                form.fields.map((x, j) => (j === i ? { ...x, deprecated: !x.deprecated } : x)),
              )
            }
            onDelete={() =>
              set(
                'fields',
                form.fields.filter((_, j) => j !== i),
              )
            }
            onMove={(dir) => set('fields', moved(form.fields, i, dir))}
            first={i === 0}
            last={i === form.fields.length - 1}
          />
        ))}
      </Section>

      <FiltersEditor
        filters={form.filters}
        fields={allFields}
        onChange={(v) => set('filters', v)}
        inheritedFrom={parent ? l(asLocalized(parent.name)) : null}
      />

      <Preview
        fields={allFields}
        filters={
          form.filters.length
            ? form.filters
            : parent
              ? (parent.filters as unknown as FilterEntry[])
              : []
        }
      />

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.index === null ? t('admin.schema.addField') : t('admin.schema.editField')}
      >
        {editing ? (
          <FieldForm
            initial={editing.field}
            locked={editing.index !== null && isSaved(editing.field.key)}
            takenKeys={[...inherited, ...form.fields]
              .filter(
                (_, i) => i !== (editing.index === null ? -1 : inherited.length + editing.index),
              )
              .map((f) => f.key)}
            onSave={upsertField}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </AdminShell>
  );
}

function FieldRow({
  field,
  saved,
  categoryId,
  onEdit,
  onToggleDeprecated,
  onDelete,
  onMove,
  first,
  last,
}: {
  field: AdminField;
  saved: boolean;
  categoryId: number | null;
  onEdit: () => void;
  onToggleDeprecated: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const [missing, setMissing] = useState<number | null>(null);

  const checkMissing = async () => {
    if (!categoryId) return;
    try {
      setMissing(await productsMissingAttribute(categoryId, field.key));
    } catch (e) {
      showToast(toAppError(e).message, 'danger');
    }
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        opacity: field.deprecated ? 0.55 : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 200 }}>
        <Text weight="semibold">
          {l(field.label) || field.key} {field.unit ? `(${field.unit})` : ''}
        </Text>
        <Text variant="caption" color="textMuted">
          {field.key} · {t(`admin.types.${field.type}`)}
          {field.required ? ` · ${t('admin.schema.required')}` : ''}
          {field.filterable ? ` · ${t('admin.schema.filterable')}` : ''}
          {field.badge ? ` · ${t('admin.schema.badge')}` : ''}
        </Text>
        {missing !== null ? (
          <Text variant="caption" color={missing ? 'warning' : 'success'}>
            {t('admin.schema.missing', { count: missing })}
          </Text>
        ) : null}
      </View>
      {field.deprecated ? <Badge label={t('admin.schema.deprecated')} tone="warning" /> : null}
      {!saved ? <Badge label={t('admin.schema.unsaved')} tone="info" /> : null}
      <MoveButtons
        onUp={() => onMove(-1)}
        onDown={() => onMove(1)}
        disabledUp={first}
        disabledDown={last}
      />
      <IconButton icon="pencil-outline" accessibilityLabel={t('admin.edit')} onPress={onEdit} />
      {saved && categoryId ? (
        <IconButton
          icon="counter"
          accessibilityLabel={t('admin.schema.checkMissing')}
          onPress={() => void checkMissing()}
        />
      ) : null}
      {saved ? (
        <Button
          title={field.deprecated ? t('admin.schema.restore') : t('admin.schema.deprecate')}
          variant="ghost"
          onPress={onToggleDeprecated}
        />
      ) : (
        <IconButton
          icon="delete-outline"
          color="danger"
          accessibilityLabel={t('admin.remove')}
          onPress={onDelete}
        />
      )}
    </View>
  );
}

function FieldForm({
  initial,
  locked,
  takenKeys,
  onSave,
  onCancel,
}: {
  initial: AdminField;
  locked: boolean;
  takenKeys: string[];
  onSave: (f: AdminField) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<AdminField>(initial);
  const [keyTouched, setKeyTouched] = useState(locked || !!initial.key);
  const [err, setErr] = useState<string | null>(null);
  const hasOptions = f.type === 'select' || f.type === 'multiSelect';

  const submit = () => {
    if (!f.label.en?.trim()) return setErr(t('admin.schema.noLabel', { key: f.key || '?' }));
    if (!FIELD_KEY_RE.test(f.key)) return setErr(t('admin.schema.badKey', { key: f.key }));
    if (takenKeys.includes(f.key)) return setErr(t('admin.schema.duplicateKey', { key: f.key }));
    if (hasOptions && !(f.options ?? []).filter((o) => o.value && o.label.en).length)
      return setErr(t('admin.schema.noOptions', { key: f.key }));
    const clean: AdminField = { ...f };
    if (!hasOptions) delete clean.options;
    else clean.options = (f.options ?? []).filter((o) => o.value && o.label.en);
    if (f.type !== 'number') {
      delete clean.unit;
      delete clean.min;
      delete clean.max;
    }
    onSave(clean);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorList message={err} />
      <LocalizedInput
        label={t('admin.schema.label')}
        value={f.label}
        onChange={(label) =>
          setF((x) => ({ ...x, label, key: keyTouched ? x.key : keyFromLabel(label.en ?? '') }))
        }
      />
      <TextField
        label={t('admin.schema.key')}
        value={f.key}
        editable={!locked}
        autoCapitalize="none"
        hint={locked ? t('admin.schema.keyLocked') : t('admin.schema.keyHint')}
        onChangeText={(s) => {
          setKeyTouched(true);
          setF((x) => ({ ...x, key: s.toLowerCase() }));
        }}
      />
      {locked ? (
        <Text variant="caption" color="textMuted">
          {t('admin.schema.typeLocked', { type: t(`admin.types.${f.type}`) })}
        </Text>
      ) : (
        <ChoiceRow<FieldType>
          label={t('admin.schema.type')}
          value={f.type}
          onChange={(type) => setF((x) => ({ ...x, type }))}
          options={FIELD_TYPES.map((v) => ({ value: v, label: t(`admin.types.${v}`) }))}
        />
      )}
      {f.type === 'number' ? (
        <Grid cols={3}>
          <TextField
            label={t('admin.schema.unit')}
            value={f.unit ?? ''}
            onChangeText={(unit) => setF((x) => ({ ...x, unit }))}
          />
          <NumberField
            label={t('admin.schema.min')}
            value={f.min}
            onChange={(v) => setF((x) => ({ ...x, min: v ?? undefined }))}
          />
          <NumberField
            label={t('admin.schema.max')}
            value={f.max}
            onChange={(v) => setF((x) => ({ ...x, max: v ?? undefined }))}
          />
        </Grid>
      ) : null}
      {hasOptions ? (
        <View style={{ gap: spacing.sm }}>
          <Text weight="semibold">{t('admin.schema.options')}</Text>
          {(f.options ?? []).map((o, i) => (
            <View key={i} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t('admin.schema.optionValue')}
                    value={o.value}
                    autoCapitalize="none"
                    onChangeText={(value) =>
                      setF((x) => ({
                        ...x,
                        options: (x.options ?? []).map((y, j) =>
                          j === i ? { ...y, value: value.toLowerCase().replace(/\s+/g, '_') } : y,
                        ),
                      }))
                    }
                  />
                </View>
                <IconButton
                  icon="delete-outline"
                  color="danger"
                  accessibilityLabel={t('admin.remove')}
                  onPress={() =>
                    setF((x) => ({ ...x, options: (x.options ?? []).filter((_, j) => j !== i) }))
                  }
                />
              </View>
              <LocalizedInput
                label={t('admin.schema.optionLabel')}
                value={o.label}
                onChange={(label) =>
                  setF((x) => ({
                    ...x,
                    options: (x.options ?? []).map((y, j) =>
                      j === i ? { ...y, label, value: y.value || keyFromLabel(label.en ?? '') } : y,
                    ),
                  }))
                }
              />
            </View>
          ))}
          <Button
            title={t('admin.schema.addOption')}
            icon="plus"
            variant="secondary"
            onPress={() =>
              setF((x) => ({ ...x, options: [...(x.options ?? []), { value: '', label: {} }] }))
            }
          />
        </View>
      ) : null}
      <SwitchRow
        label={t('admin.schema.required')}
        hint={t('admin.schema.requiredHint')}
        value={!!f.required}
        onChange={(required) => setF((x) => ({ ...x, required }))}
      />
      <SwitchRow
        label={t('admin.schema.filterable')}
        hint={t('admin.schema.filterableHint')}
        value={!!f.filterable}
        onChange={(filterable) => setF((x) => ({ ...x, filterable }))}
      />
      <SwitchRow
        label={t('admin.schema.badge')}
        hint={t('admin.schema.badgeHint')}
        value={!!f.badge}
        onChange={(badge) => setF((x) => ({ ...x, badge }))}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button title={t('common.cancel')} variant="ghost" onPress={onCancel} />
        <Button title={t('admin.done')} onPress={submit} />
      </View>
    </View>
  );
}

function FiltersEditor({
  filters,
  fields,
  onChange,
  inheritedFrom,
}: {
  filters: FilterEntry[];
  fields: AdminField[];
  onChange: (v: FilterEntry[]) => void;
  inheritedFrom: string | null;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const attrFields = fields.filter(
    (f) => !f.deprecated && ['select', 'multiSelect', 'boolean'].includes(f.type),
  );
  const has = (type: FilterEntry['type'], key?: string) =>
    filters.some(
      (x) => x.type === type && (key === undefined || (x.type === 'attribute' && x.key === key)),
    );
  const add = (e: FilterEntry) => onChange([...filters, e]);

  const label = (e: FilterEntry) => {
    switch (e.type) {
      case 'attribute': {
        const f = fields.find((x) => x.key === e.key);
        return f ? l(f.label) : e.key;
      }
      case 'price':
        return `${t('admin.filters.price')} (${e.buckets.join(', ')})`;
      default:
        return t(`admin.filters.${e.type}`);
    }
  };

  return (
    <Section icon="filter-variant" title={t('admin.filters.title')}>
      <Text variant="caption" color="textMuted">
        {inheritedFrom && filters.length === 0
          ? t('admin.filters.inherits', { name: inheritedFrom })
          : t('admin.filters.intro')}
      </Text>
      {filters.map((e, i) => (
        <View
          key={`${e.type}-${i}`}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.xs,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ flex: 1, minWidth: 160 }} weight="semibold">
            {label(e)}
          </Text>
          {e.type === 'price' ? (
            <BucketsInput
              buckets={e.buckets}
              onCommit={(buckets) =>
                onChange(filters.map((x, j) => (j === i ? { type: 'price', buckets } : x)))
              }
            />
          ) : null}
          {e.type === 'veg' || e.type === 'in_stock' || e.type === 'attribute' ? (
            <Chip
              label={t('admin.filters.quick')}
              selected={!!e.quick}
              onPress={() =>
                onChange(
                  filters.map((x, j) => (j === i ? ({ ...x, quick: !e.quick } as FilterEntry) : x)),
                )
              }
            />
          ) : null}
          <MoveButtons
            onUp={() => onChange(moved(filters, i, -1))}
            onDown={() => onChange(moved(filters, i, 1))}
            disabledUp={i === 0}
            disabledDown={i === filters.length - 1}
          />
          <IconButton
            icon="delete-outline"
            color="danger"
            accessibilityLabel={t('admin.remove')}
            onPress={() => onChange(filters.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {!has('brand') ? (
          <Chip
            icon="plus"
            label={t('admin.filters.brand')}
            onPress={() => add({ type: 'brand' })}
          />
        ) : null}
        {!has('price') ? (
          <Chip
            icon="plus"
            label={t('admin.filters.price')}
            onPress={() => add({ type: 'price', buckets: [0, 50, 100, 200] })}
          />
        ) : null}
        {!has('veg') ? (
          <Chip icon="plus" label={t('admin.filters.veg')} onPress={() => add({ type: 'veg' })} />
        ) : null}
        {!has('in_stock') ? (
          <Chip
            icon="plus"
            label={t('admin.filters.in_stock')}
            onPress={() => add({ type: 'in_stock' })}
          />
        ) : null}
        {attrFields
          .filter((f) => !has('attribute', f.key))
          .map((f) => (
            <Chip
              key={f.key}
              icon="plus"
              label={l(f.label)}
              onPress={() => add({ type: 'attribute', key: f.key })}
            />
          ))}
      </View>
    </Section>
  );
}

/** Price bucket edges ("0, 50, 100"): typed freely, applied when the field loses focus. */
function BucketsInput({
  buckets,
  onCommit,
}: {
  buckets: number[];
  onCommit: (b: number[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(buckets.join(', '));
  return (
    <View style={{ width: 200 }}>
      <TextField
        label={t('admin.filters.buckets')}
        value={text}
        onChangeText={setText}
        onBlur={() => {
          const next = parseBuckets(text);
          setText(next.join(', '));
          onCommit(next);
        }}
      />
    </View>
  );
}

const sampleValue = (f: AdminField): unknown => {
  switch (f.type) {
    case 'number':
      return f.min ?? 5;
    case 'boolean':
      return true;
    case 'select':
      return f.options?.[0]?.value;
    case 'multiSelect':
      return f.options?.slice(0, 2).map((o) => o.value);
    case 'localizedText':
      return { en: 'Sample text' };
    case 'localizedList':
      return [{ en: 'One' }, { en: 'Two' }];
    case 'date':
      return '2026-12-31';
    default:
      return 'Sample';
  }
};

/** What customers will see: product "Highlights" and the filter chips on the category screen. */
function Preview({ fields, filters }: { fields: AdminField[]; filters: FilterEntry[] }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const visible = fields.filter((f) => !f.deprecated);
  return (
    <Section icon="eye-outline" title={t('admin.preview.title')}>
      <Text variant="caption" color="textMuted">
        {t('admin.preview.intro')}
      </Text>
      <Text weight="semibold">{t('admin.preview.filters')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {filters.length === 0 ? <Text color="textMuted">—</Text> : null}
        {filters.map((e, i) => (
          <Chip
            key={i}
            label={
              e.type === 'attribute'
                ? l(fields.find((f) => f.key === e.key)?.label) || e.key
                : t(`admin.filters.${e.type}`)
            }
            icon={'quick' in e && e.quick ? 'flash' : 'chevron-down'}
          />
        ))}
      </View>
      <Text weight="semibold">{t('admin.preview.highlights')}</Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: spacing.md,
          gap: spacing.xs,
        }}
      >
        {visible.length === 0 ? <Text color="textMuted">—</Text> : null}
        {visible.map((f) => (
          <View key={f.key} style={{ flexDirection: 'row', gap: spacing.md }}>
            <Text color="textMuted" style={{ width: 140 }}>
              {l(f.label) || f.key}
            </Text>
            <Text style={{ flex: 1 }}>{formatAttribute(f, sampleValue(f), l, t) || '—'}</Text>
            {f.badge ? <Badge label={t('admin.schema.badge')} tone="info" /> : null}
          </View>
        ))}
      </View>
    </Section>
  );
}
