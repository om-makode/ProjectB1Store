import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { asLocalized, useLocalize, type LocalizedString } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { discountPercent, formatPrice } from '@/lib/format';
import { catalogImageUrl } from '@/lib/images';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Chip,
  ErrorState,
  IconButton,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import { createBrand, upsertProduct, type AdminProduct, type CategoryRow } from './api';
import {
  AdminShell,
  ChoiceRow,
  ErrorList,
  Grid,
  LocalizedInput,
  MoveButtons,
  NumberField,
  Section,
  SwitchRow,
  confirmAction,
  moved,
} from './components';
import {
  fieldsOf,
  useAdminCategories,
  useAdminProduct,
  useBrands,
  useRefreshCatalog,
} from './hooks';
import { canPickImages, pickImages, uploadProductImage } from './images';
import {
  SLUG_RE,
  attributeErrors,
  cleanAttributes,
  effectiveAdminFields,
  slugify,
  type AdminField,
} from './schema';

const UNITS = ['g', 'kg', 'ml', 'l', 'pc', 'pack'] as const;
const GST_RATES = [0, 5, 18, 40];

type VariantForm = {
  id: number | null;
  sku: string;
  barcode: string;
  label: LocalizedString;
  net_quantity: number | null;
  unit: string;
  mrp: number | null;
  price: number | null;
  max_per_order: number | null;
  is_default: boolean;
  is_active: boolean;
  initial_stock: number | null;
  low_stock_threshold: number | null;
  stock: number | null; // current stock (read-only; Store mode changes it)
};

type ImageForm = { path: string; thumb_path: string };

type Form = {
  name: LocalizedString;
  description: LocalizedString;
  slug: string;
  category_id: number | null;
  brand_id: number | null;
  is_veg: boolean | null;
  tags: string;
  hsn_code: string;
  gst_rate: number | null;
  country_of_origin: string;
  manufacturer_name: string;
  manufacturer_address: string;
  shelf_life: string;
  is_active: boolean;
  attributes: Record<string, unknown>;
  variants: VariantForm[];
  images: ImageForm[];
};

const newVariant = (isDefault: boolean): VariantForm => ({
  id: null,
  sku: '',
  barcode: '',
  label: {},
  net_quantity: null,
  unit: 'g',
  mrp: null,
  price: null,
  max_per_order: 10,
  is_default: isDefault,
  is_active: true,
  initial_stock: 0,
  low_stock_threshold: 5,
  stock: null,
});

const emptyForm = (): Form => ({
  name: {},
  description: {},
  slug: '',
  category_id: null,
  brand_id: null,
  is_veg: true,
  tags: '',
  hsn_code: '',
  gst_rate: 5,
  country_of_origin: 'India',
  manufacturer_name: '',
  manufacturer_address: '',
  shelf_life: '',
  is_active: true,
  attributes: {},
  variants: [newVariant(true)],
  images: [],
});

function fromProduct(p: AdminProduct): Form {
  const m = (p.manufacturer ?? {}) as { name?: string; address?: string };
  return {
    name: asLocalized(p.name),
    description: asLocalized(p.description),
    slug: p.slug,
    category_id: p.category_id,
    brand_id: p.brand_id,
    is_veg: p.is_veg,
    tags: (p.tags ?? []).join(', '),
    hsn_code: p.hsn_code ?? '',
    gst_rate: Number(p.gst_rate),
    country_of_origin: p.country_of_origin,
    manufacturer_name: m.name ?? '',
    manufacturer_address: m.address ?? '',
    shelf_life: p.shelf_life ?? '',
    is_active: p.is_active,
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
    variants: [...p.product_variants]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode ?? '',
        label: asLocalized(v.label),
        net_quantity: Number(v.net_quantity),
        unit: v.unit,
        mrp: Number(v.mrp),
        price: Number(v.price),
        max_per_order: v.max_per_order,
        is_default: v.is_default,
        is_active: v.is_active,
        initial_stock: null,
        low_stock_threshold: v.inventory?.[0]?.low_stock_threshold ?? null,
        stock: v.inventory?.[0]?.stock ?? null,
      })),
    images: [...p.product_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ path: i.path, thumb_path: i.thumb_path ?? i.path })),
  };
}

/**
 * Loads the product, then mounts the editor seeded from it. After a save the editor is remounted
 * from fresh server data (new variant ids, stock); background refetches never discard edits.
 */
export function ProductEditScreen({ id }: { id: number | null }) {
  const { t } = useTranslation();
  const cats = useAdminCategories();
  const product = useAdminProduct(id);
  const [version, setVersion] = useState(0);

  if ((id && product.isPending) || cats.isPending) {
    return (
      <AdminShell title={t('admin.prod.edit')}>
        <Skeleton width="100%" height={400} />
      </AdminShell>
    );
  }
  if (product.error || cats.error || (id && !product.data)) {
    return (
      <AdminShell title={t('admin.prod.edit')}>
        <ErrorState error={product.error ?? cats.error} onRetry={() => void product.refetch()} />
      </AdminShell>
    );
  }
  return (
    <ProductEditor
      key={version}
      id={id}
      categories={cats.data}
      initial={product.data ? fromProduct(product.data) : emptyForm()}
      onSaved={async () => {
        await product.refetch();
        setVersion((v) => v + 1);
      }}
    />
  );
}

function ProductEditor({
  id,
  categories,
  initial,
  onSaved,
}: {
  id: number | null;
  categories: CategoryRow[];
  initial: Form;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const brands = useBrands();
  const refresh = useRefreshCatalog();
  const [form, setForm] = useState<Form>(initial);
  const [savedForm, setSavedForm] = useState<Form>(initial);
  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );
  const [slugTouched, setSlugTouched] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [attrErrors, setAttrErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newBrand, setNewBrand] = useState('');

  const cat = categories.find((c) => c.id === form.category_id);
  const parent = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : undefined;
  const fields = useMemo(
    () => effectiveAdminFields(fieldsOf(parent), fieldsOf(cat)),
    [parent, cat],
  );
  const [parentPick, setParentPick] = useState<number | null>(null);
  const selectedParent = parentPick ?? parent?.id ?? null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setVariant = (i: number, patch: Partial<VariantForm>) =>
    set(
      'variants',
      form.variants.map((v, j) =>
        j === i ? { ...v, ...patch } : patch.is_default ? { ...v, is_default: false } : v,
      ),
    );

  const addImages = async () => {
    if (!canPickImages()) return showToast(t('admin.needsRebuild'), 'warning');
    const picked = await pickImages(true);
    if (picked === 'denied') return showToast(t('admin.photoDenied'), 'warning');
    if (!picked.length) return;
    setUploading(true);
    try {
      const uploaded: ImageForm[] = [];
      for (const [i, p] of picked.entries()) {
        uploaded.push(await uploadProductImage(p, form.images.length === 0 && i === 0));
      }
      set('images', [...form.images, ...uploaded]);
    } catch (e) {
      showToast(t('admin.uploadFailed', { message: toAppError(e).message }), 'danger');
    } finally {
      setUploading(false);
    }
  };

  const addBrand = async () => {
    const name = newBrand.trim();
    if (!name) return;
    try {
      const b = await createBrand(slugify(name), { en: name });
      await brands.refetch();
      set('brand_id', b.id);
      setNewBrand('');
    } catch (e) {
      showToast(toAppError(e).message, 'danger');
    }
  };

  const save = async () => {
    setError(null);
    const errs = attributeErrors(fields, form.attributes);
    setAttrErrors(errs);
    const local: string[] = [];
    if (!form.name.en?.trim()) local.push(t('admin.prod.errName'));
    if (!form.category_id) local.push(t('admin.prod.errCategory'));
    if (form.slug && !SLUG_RE.test(form.slug)) local.push(t('admin.cat.errSlug'));
    if (Object.keys(errs).length) local.push(t('admin.prod.errAttributes'));
    form.variants.forEach((v, i) => {
      if (v.price !== null && v.mrp !== null && v.price > v.mrp)
        local.push(t('admin.prod.errPrice', { n: i + 1 }));
    });
    if (local.length) return setError(local.join('\n'));

    const payload = {
      id: id ?? undefined,
      category_id: form.category_id,
      brand_id: form.brand_id,
      slug: form.slug || undefined,
      name: form.name,
      description: form.description,
      attributes: cleanAttributes(form.attributes),
      is_veg: form.is_veg,
      tags: form.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      hsn_code: form.hsn_code.trim(),
      gst_rate: form.gst_rate,
      country_of_origin: form.country_of_origin.trim(),
      manufacturer: {
        name: form.manufacturer_name.trim(),
        address: form.manufacturer_address.trim(),
      },
      shelf_life: form.shelf_life.trim(),
      is_active: form.is_active,
      variants: form.variants.map((v, i) => ({
        id: v.id ?? undefined,
        sku: v.sku.trim(),
        barcode: v.barcode.trim(),
        label: v.label,
        net_quantity: v.net_quantity,
        unit: v.unit,
        mrp: v.mrp,
        price: v.price,
        max_per_order: v.max_per_order,
        is_default: v.is_default,
        is_active: v.is_active,
        sort_order: i + 1,
        initial_stock: v.id ? undefined : v.initial_stock,
        low_stock_threshold: v.low_stock_threshold,
      })),
      images: form.images,
    };

    setSaving(true);
    try {
      const res = await upsertProduct(payload);
      setSavedForm(form);
      refresh();
      showToast(t('admin.saved'), 'success');
      if (!id) router.replace(`/admin/products/edit?id=${res.product_id}` as Href);
      else await onSaved(); // remount from the server (ids of new variants, stock)
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const removeVariant = async (i: number) => {
    const v = form.variants[i]!;
    if (v.id) {
      // Saved variants are never deleted (orders reference them): deactivate instead.
      const ok = await confirmAction(
        t('admin.prod.hideVariant'),
        t('admin.prod.hideVariantBody'),
        t('admin.prod.hide'),
        t('common.cancel'),
      );
      if (ok) setVariant(i, { is_active: false });
      return;
    }
    set(
      'variants',
      form.variants.filter((_, j) => j !== i),
    );
  };

  const parents = categories.filter((c) => c.parent_id === null);
  const subs = categories.filter((c) => c.parent_id === selectedParent);

  return (
    <AdminShell
      title={id ? l(form.name) || t('admin.prod.edit') : t('admin.prod.new')}
      back={'/admin/products' as Href}
      hasUnsavedChanges={isDirty}
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

      <Section icon="package-variant-closed" title={t('admin.prod.basics')}>
        <LocalizedInput
          label={t('admin.prod.name')}
          value={form.name}
          onChange={(v) => {
            set('name', v);
            if (!slugTouched) set('slug', slugify(v.en ?? ''));
          }}
        />
        <LocalizedInput
          label={t('admin.prod.description')}
          value={form.description}
          onChange={(v) => set('description', v)}
          multiline
          requiredEn={false}
        />
        <Grid>
          <TextField
            label={t('admin.slug')}
            value={form.slug}
            autoCapitalize="none"
            hint={t('admin.prod.slugHint')}
            onChangeText={(s) => {
              setSlugTouched(true);
              set('slug', s.toLowerCase());
            }}
          />
          <TextField
            label={t('admin.prod.tags')}
            value={form.tags}
            hint={t('admin.prod.tagsHint')}
            onChangeText={(s) => set('tags', s)}
          />
        </Grid>
        <ChoiceRow
          label={t('admin.prod.category')}
          value={selectedParent}
          onChange={(v) => {
            setParentPick(v);
            set('category_id', null);
          }}
          options={parents.map((p) => ({
            value: p.id as number | null,
            label: l(asLocalized(p.name)),
          }))}
        />
        {selectedParent ? (
          <ChoiceRow
            label={t('admin.prod.subCategory')}
            value={form.category_id}
            onChange={(v) => set('category_id', v)}
            options={subs.map((c) => ({
              value: c.id as number | null,
              label: l(asLocalized(c.name)),
            }))}
          />
        ) : null}
        <ChoiceRow
          label={t('admin.prod.brand')}
          value={form.brand_id}
          onChange={(v) => set('brand_id', v)}
          options={[
            { value: null, label: t('admin.none') },
            ...(brands.data ?? []).map((b) => ({
              value: b.id as number | null,
              label: l(asLocalized(b.name)),
            })),
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('admin.prod.newBrand')}
              value={newBrand}
              onChangeText={setNewBrand}
            />
          </View>
          <Button
            title={t('admin.add')}
            variant="secondary"
            onPress={() => void addBrand()}
            disabled={!newBrand.trim()}
          />
        </View>
        <ChoiceRow
          label={t('admin.prod.veg')}
          value={form.is_veg}
          onChange={(v) => set('is_veg', v)}
          options={[
            { value: true, label: t('admin.prod.vegYes') },
            { value: false, label: t('admin.prod.vegNo') },
            { value: null, label: t('admin.prod.vegNa') },
          ]}
        />
        <SwitchRow
          label={t('admin.activeVisible')}
          value={form.is_active}
          onChange={(v) => set('is_active', v)}
        />
      </Section>

      <Section icon="scale-balance" title={t('admin.prod.legal')}>
        <Text variant="caption" color="textMuted">
          {t('admin.prod.legalHint')}
        </Text>
        <Grid>
          <TextField
            label={`${t('admin.prod.manufacturer')} *`}
            value={form.manufacturer_name}
            onChangeText={(s) => set('manufacturer_name', s)}
          />
          <TextField
            label={`${t('admin.prod.manufacturerAddress')} *`}
            value={form.manufacturer_address}
            onChangeText={(s) => set('manufacturer_address', s)}
          />
          <TextField
            label={`${t('admin.prod.origin')} *`}
            value={form.country_of_origin}
            onChangeText={(s) => set('country_of_origin', s)}
          />
          <TextField
            label={t('admin.prod.shelfLife')}
            value={form.shelf_life}
            placeholder="6 months"
            onChangeText={(s) => set('shelf_life', s)}
          />
          <TextField
            label={t('admin.prod.hsn')}
            value={form.hsn_code}
            keyboardType="number-pad"
            inputMode="numeric"
            hint={t('admin.prod.hsnHint')}
            onChangeText={(s) => set('hsn_code', s.replace(/\D/g, ''))}
          />
        </Grid>
        <ChoiceRow
          label={`${t('admin.prod.gst')} *`}
          value={form.gst_rate}
          onChange={(v) => set('gst_rate', v)}
          options={GST_RATES.map((r) => ({ value: r as number | null, label: `${r}%` }))}
        />
      </Section>

      <Section icon="tune-variant" title={t('admin.prod.attributes')}>
        {!form.category_id ? (
          <Text color="textMuted">{t('admin.prod.pickCategoryFirst')}</Text>
        ) : fields.filter((f) => !f.deprecated).length === 0 ? (
          <Text color="textMuted">{t('admin.prod.noAttributes')}</Text>
        ) : (
          <Grid>
            {fields
              .filter((f) => !f.deprecated || form.attributes[f.key] !== undefined)
              .map((f) => (
                <AttributeInput
                  key={f.key}
                  field={f}
                  value={form.attributes[f.key]}
                  error={
                    attrErrors[f.key]
                      ? t(
                          `admin.prod.attr_${attrErrors[f.key] === 'required' ? 'required' : 'invalid'}`,
                        )
                      : null
                  }
                  onChange={(v) => set('attributes', { ...form.attributes, [f.key]: v })}
                />
              ))}
          </Grid>
        )}
      </Section>

      <Section
        icon="tag-multiple-outline"
        title={t('admin.prod.variantsTitle')}
        right={
          <Button
            title={t('admin.prod.addVariant')}
            icon="plus"
            variant="secondary"
            onPress={() => set('variants', [...form.variants, newVariant(false)])}
          />
        }
      >
        {form.variants.map((v, i) => (
          <VariantEditor
            key={v.id ?? `new-${i}`}
            v={v}
            index={i}
            onChange={(patch) => setVariant(i, patch)}
            onRemove={() => void removeVariant(i)}
          />
        ))}
      </Section>

      <Section
        icon="camera-outline"
        title={t('admin.prod.images')}
        right={
          <Button
            title={t('admin.addImage')}
            icon="image-plus"
            variant="secondary"
            onPress={() => void addImages()}
            loading={uploading}
          />
        }
      >
        <Text variant="caption" color="textMuted">
          {t('admin.prod.imagesHint')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {form.images.length === 0 ? (
            <Text color="textMuted">{t('admin.prod.noPhotos')}</Text>
          ) : null}
          {form.images.map((img, i) => (
            <ImageTile
              key={img.path}
              path={img.thumb_path}
              first={i === 0}
              onLeft={i > 0 ? () => set('images', moved(form.images, i, -1)) : undefined}
              onRight={
                i < form.images.length - 1
                  ? () => set('images', moved(form.images, i, 1))
                  : undefined
              }
              onRemove={() =>
                set(
                  'images',
                  form.images.filter((_, j) => j !== i),
                )
              }
            />
          ))}
        </View>
      </Section>
    </AdminShell>
  );
}

function VariantEditor({
  v,
  index,
  onChange,
  onRemove,
}: {
  v: VariantForm;
  index: number;
  onChange: (p: Partial<VariantForm>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const off = v.mrp && v.price ? discountPercent(v.price, v.mrp) : 0;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: v.is_default ? colors.primary : colors.border,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.md,
        opacity: v.is_active ? 1 : 0.6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text weight="semibold" style={{ flex: 1 }}>
          {t('admin.prod.variantN', { n: index + 1 })}
          {v.stock !== null ? ` · ${t('admin.prod.inStock', { count: v.stock })}` : ''}
        </Text>
        {v.is_default ? <Badge label={t('admin.prod.default')} tone="success" /> : null}
        {!v.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
        {off > 0 ? <Badge label={`${off}% OFF`} tone="info" /> : null}
        <IconButton
          icon="delete-outline"
          color="danger"
          accessibilityLabel={t('admin.remove')}
          onPress={onRemove}
        />
      </View>
      <LocalizedInput
        label={t('admin.prod.variantLabel')}
        value={v.label}
        onChange={(label) => onChange({ label })}
      />
      <Grid cols={3}>
        <TextField
          label={`${t('admin.prod.sku')} *`}
          value={v.sku}
          autoCapitalize="characters"
          onChangeText={(sku) => onChange({ sku })}
        />
        <TextField
          label={t('admin.prod.barcode')}
          value={v.barcode}
          keyboardType="number-pad"
          onChangeText={(barcode) => onChange({ barcode })}
        />
        <NumberField
          label={`${t('admin.prod.netQty')} *`}
          value={v.net_quantity}
          onChange={(net_quantity) => onChange({ net_quantity })}
        />
        <NumberField
          label={`${t('admin.prod.mrp')} *`}
          value={v.mrp}
          hint={t('admin.prod.mrpHint')}
          onChange={(mrp) => onChange({ mrp })}
        />
        <NumberField
          label={`${t('admin.prod.price')} *`}
          value={v.price}
          hint={v.price ? formatPrice(v.price) : undefined}
          error={
            v.price !== null && v.mrp !== null && v.price > v.mrp
              ? t('admin.prod.priceAboveMrp')
              : null
          }
          onChange={(price) => onChange({ price })}
        />
        <NumberField
          label={t('admin.prod.maxPerOrder')}
          value={v.max_per_order}
          onChange={(max_per_order) => onChange({ max_per_order })}
        />
        {v.id ? null : (
          <NumberField
            label={t('admin.prod.initialStock')}
            value={v.initial_stock}
            onChange={(initial_stock) => onChange({ initial_stock })}
          />
        )}
        <NumberField
          label={t('admin.prod.lowStockAt')}
          value={v.low_stock_threshold}
          onChange={(low_stock_threshold) => onChange({ low_stock_threshold })}
        />
      </Grid>
      <ChoiceRow
        label={`${t('admin.prod.unit')} *`}
        value={v.unit}
        onChange={(unit) => onChange({ unit })}
        options={UNITS.map((u) => ({ value: u as string, label: u }))}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip
          label={t('admin.prod.makeDefault')}
          selected={v.is_default}
          onPress={() => onChange({ is_default: true })}
        />
        <Chip
          label={t('admin.prod.selling')}
          selected={v.is_active}
          onPress={() => onChange({ is_active: !v.is_active })}
        />
      </View>
    </View>
  );
}

function ImageTile({
  path,
  first,
  onLeft,
  onRight,
  onRemove,
}: {
  path: string;
  first: boolean;
  onLeft?: () => void;
  onRight?: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const url = catalogImageUrl(path);
  return (
    <View style={{ width: 128, gap: spacing.xs }}>
      <View
        style={{
          width: 128,
          height: 128,
          borderRadius: radius.md,
          overflow: 'hidden',
          backgroundColor: colors.surfaceAlt,
          borderWidth: first ? 2 : 0,
          borderColor: colors.primary,
        }}
      >
        {url ? (
          <Image source={{ uri: url }} style={{ width: 128, height: 128 }} contentFit="cover" />
        ) : null}
      </View>
      {first ? (
        <Text variant="caption" color="primary">
          {t('admin.prod.mainPhoto')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <MoveButtons
          onUp={onLeft ?? (() => {})}
          onDown={onRight ?? (() => {})}
          disabledUp={!onLeft}
          disabledDown={!onRight}
        />
        <IconButton
          icon="delete-outline"
          color="danger"
          accessibilityLabel={t('admin.remove')}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}

/** One input per attribute type (the no-code engine's form side). */
function AttributeInput({
  field,
  value,
  onChange,
  error,
}: {
  field: AdminField;
  value: unknown;
  onChange: (v: unknown) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const label = `${l(field.label) || field.key}${field.unit ? ` (${field.unit})` : ''}${field.required ? ' *' : ''}`;
  const caption = error ? (
    <Text variant="caption" color="danger">
      {error}
    </Text>
  ) : field.deprecated ? (
    <Text variant="caption" color="warning">
      {t('admin.schema.deprecated')}
    </Text>
  ) : null;

  switch (field.type) {
    case 'number':
      return (
        <NumberField
          label={label}
          value={typeof value === 'number' ? value : null}
          error={error}
          onChange={(n) => onChange(n ?? undefined)}
        />
      );
    case 'localizedText':
      return (
        <LocalizedInput
          label={label}
          value={asLocalized(value)}
          onChange={onChange}
          error={error}
          requiredEn={!!field.required}
        />
      );
    case 'boolean':
      return (
        <View style={{ gap: spacing.xs }}>
          <ChoiceRow
            label={label}
            value={typeof value === 'boolean' ? value : null}
            onChange={(v) => onChange(v ?? undefined)}
            options={[
              { value: true as boolean | null, label: t('catalog.yes') },
              { value: false, label: t('catalog.no') },
              { value: null, label: '—' },
            ]}
          />
          {caption}
        </View>
      );
    case 'select':
      return (
        <View style={{ gap: spacing.xs }}>
          <ChoiceRow
            label={label}
            value={typeof value === 'string' ? value : null}
            onChange={(v) => onChange(v ?? undefined)}
            options={[
              { value: null as string | null, label: '—' },
              ...(field.options ?? []).map((o) => ({
                value: o.value as string | null,
                label: l(o.label) || o.value,
              })),
            ]}
          />
          {caption}
        </View>
      );
    case 'multiSelect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" weight="semibold" color="textMuted">
            {label}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(field.options ?? []).map((o) => (
              <Chip
                key={o.value}
                label={l(o.label) || o.value}
                selected={list.includes(o.value)}
                onPress={() =>
                  onChange(
                    list.includes(o.value) ? list.filter((x) => x !== o.value) : [...list, o.value],
                  )
                }
              />
            ))}
          </View>
          {caption}
        </View>
      );
    }
    case 'localizedList': {
      const text = Array.isArray(value) ? value.map((x) => asLocalized(x).en ?? '').join(', ') : '';
      return (
        <TextField
          label={label}
          defaultValue={text}
          hint={t('admin.prod.listHint')}
          error={error}
          onChangeText={(s) =>
            onChange(
              s
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .map((en) => ({ en })),
            )
          }
        />
      );
    }
    case 'date':
      return (
        <TextField
          label={label}
          value={typeof value === 'string' ? value : ''}
          placeholder="YYYY-MM-DD"
          error={error}
          onChangeText={(s) => onChange(s || undefined)}
        />
      );
    default:
      return (
        <TextField
          label={label}
          value={typeof value === 'string' ? value : ''}
          error={error}
          onChangeText={(s) => onChange(s || undefined)}
        />
      );
  }
}
