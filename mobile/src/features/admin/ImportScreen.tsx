import { type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { toAppError } from '@/lib/errors';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Text, showToast } from '@/ui';

import {
  fetchAllProductsForExport,
  importProducts,
  type ExportProduct,
  type ImportResult,
} from './api';
import { AdminShell, ErrorList, Section } from './components';
import {
  PRODUCT_COLUMNS,
  attributeCells,
  chunkByProduct,
  missingColumns,
  parseCsv,
  toCsv,
  toRecords,
  type CsvRecord,
} from './csv';
import { useRefreshCatalog } from './hooks';

/** Web only: open the browser's file chooser and read a CSV as text. */
function chooseCsvFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file
        .text()
        .then((text) => resolve({ name: file.name, text }))
        .catch(() => resolve(null));
    };
    input.click();
  });
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** All products → CSV rows (one per variant), with the same columns the import reads. */
export function productsToCsv(products: ExportProduct[]): string {
  const attrCols = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const p of products) {
    const name = (p.name ?? {}) as Record<string, string>;
    const desc = (p.description ?? {}) as Record<string, string>;
    const m = (p.manufacturer ?? {}) as { name?: string; address?: string };
    const brandName = (p.brands?.name ?? {}) as Record<string, string>;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries((p.attributes ?? {}) as Record<string, unknown>)) {
      Object.assign(attrs, attributeCells(k, v));
    }
    Object.keys(attrs).forEach((c) => attrCols.add(c));
    const variants = [...p.product_variants].sort((a, b) => a.sort_order - b.sort_order);
    for (const v of variants) {
      const label = (v.label ?? {}) as Record<string, string>;
      rows.push({
        product_slug: p.slug,
        category_slug: p.categories?.slug ?? '',
        brand_slug: p.brands?.slug ?? '',
        brand_name: brandName.en ?? '',
        name_en: name.en ?? '',
        name_mr: name.mr ?? '',
        name_hi: name.hi ?? '',
        description_en: desc.en ?? '',
        description_mr: desc.mr ?? '',
        description_hi: desc.hi ?? '',
        is_veg: p.is_veg === null ? '' : p.is_veg ? 'yes' : 'no',
        tags: (p.tags ?? []).join('|'),
        hsn_code: p.hsn_code ?? '',
        gst_rate: p.gst_rate,
        country_of_origin: p.country_of_origin,
        manufacturer_name: m.name ?? '',
        manufacturer_address: m.address ?? '',
        shelf_life: p.shelf_life ?? '',
        is_active: p.is_active ? 'yes' : 'no',
        sku: v.sku,
        barcode: v.barcode ?? '',
        variant_label_en: label.en ?? '',
        variant_label_mr: label.mr ?? '',
        variant_label_hi: label.hi ?? '',
        net_quantity: v.net_quantity,
        unit: v.unit,
        mrp: v.mrp,
        price: v.price,
        max_per_order: v.max_per_order,
        is_default: v.is_default ? 'yes' : 'no',
        stock: v.inventory?.[0]?.stock ?? '',
        low_stock_threshold: v.inventory?.[0]?.low_stock_threshold ?? '',
        ...attrs,
      });
    }
  }
  return toCsv([...PRODUCT_COLUMNS, ...[...attrCols].sort()], rows);
}

type Summary = { created: number; updated: number; errors: ImportResult['errors'] };

export function ImportScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const refresh = useRefreshCatalog();
  const web = Platform.OS === 'web';
  const [file, setFile] = useState<{ name: string; records: CsvRecord[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dry, setDry] = useState<Summary | null>(null);
  const [applied, setApplied] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<'export' | 'check' | 'apply' | null>(null);
  const [progress, setProgress] = useState('');

  const pick = async () => {
    setProblem(null);
    setDry(null);
    setApplied(null);
    const f = await chooseCsvFile();
    if (!f) return;
    const { header, records } = toRecords(parseCsv(f.text));
    const missing = missingColumns(header);
    if (missing.length) return setProblem(t('admin.imp.missingCols', { cols: missing.join(', ') }));
    if (!records.length) return setProblem(t('admin.imp.empty'));
    setFile({ name: f.name, records });
  };

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'apply');
    const total: Summary = { created: 0, updated: 0, errors: [] };
    const chunks = chunkByProduct(file.records);
    try {
      for (const [i, chunk] of chunks.entries()) {
        setProgress(t('admin.imp.progress', { done: i + 1, total: chunks.length }));
        const r = await importProducts(chunk, dryRun);
        total.created += r.created;
        total.updated += r.updated;
        total.errors.push(...r.errors);
      }
      if (dryRun) setDry(total);
      else {
        setApplied(total);
        refresh();
        showToast(
          t('admin.imp.done', { created: total.created, updated: total.updated }),
          'success',
        );
      }
    } catch (e) {
      setProblem(toAppError(e).message);
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const doExport = async () => {
    setBusy('export');
    try {
      const products = await fetchAllProductsForExport();
      downloadText(
        `nearkart-products-${new Date().toISOString().slice(0, 10)}.csv`,
        productsToCsv(products),
      );
    } catch (e) {
      showToast(toAppError(e).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const summary = (s: Summary, title: string) => (
    <View style={{ gap: spacing.sm }}>
      <Text weight="semibold">{title}</Text>
      <Text>
        {t('admin.imp.summary', {
          created: s.created,
          updated: s.updated,
          errors: s.errors.length,
        })}
      </Text>
      {s.errors.map((e, i) => (
        <View
          key={i}
          style={{ borderLeftWidth: 3, borderLeftColor: colors.danger, paddingLeft: spacing.sm }}
        >
          <Text weight="semibold">
            {e.product_slug ?? '?'} · {t('admin.imp.rows', { rows: (e.rows ?? []).join(', ') })}
          </Text>
          <Text color="danger">{e.message}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <AdminShell title={t('admin.imp.title')} back={'/admin/products' as Href}>
      {!web ? (
        <Section icon="monitor" title={t('admin.imp.webOnly')}>
          <Text color="textMuted">{t('admin.imp.webOnlyBody')}</Text>
        </Section>
      ) : (
        <>
          <Section icon="file-export-outline" title={t('admin.imp.exportTitle')}>
            <Text color="textMuted">{t('admin.imp.exportBody')}</Text>
            <Button
              title={t('admin.imp.export')}
              icon="download"
              variant="secondary"
              onPress={() => void doExport()}
              loading={busy === 'export'}
            />
          </Section>

          <Section icon="file-import-outline" title={t('admin.imp.importTitle')}>
            <Text color="textMuted">{t('admin.imp.importBody')}</Text>
            <Text variant="caption" color="textMuted" selectable>
              {PRODUCT_COLUMNS.join(', ')}, attr.&lt;key&gt;
            </Text>
            <Button
              title={t('admin.imp.choose')}
              icon="file-upload-outline"
              onPress={() => void pick()}
            />
            <ErrorList message={problem} />
            {file ? (
              <View style={{ gap: spacing.md }}>
                <Text>
                  {t('admin.imp.fileInfo', {
                    name: file.name,
                    rows: file.records.length,
                    products: new Set(file.records.map((r) => r.product_slug)).size,
                  })}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  <Button
                    title={t('admin.imp.check')}
                    icon="check-decagram-outline"
                    variant="secondary"
                    onPress={() => void run(true)}
                    loading={busy === 'check'}
                    disabled={!!busy}
                  />
                  <Button
                    title={t('admin.imp.apply')}
                    icon="database-import-outline"
                    onPress={() => void run(false)}
                    loading={busy === 'apply'}
                    disabled={!dry || !!busy}
                  />
                </View>
                {progress ? <Text color="textMuted">{progress}</Text> : null}
                {!dry ? (
                  <Text variant="caption" color="textMuted">
                    {t('admin.imp.checkFirst')}
                  </Text>
                ) : null}
                {dry ? summary(dry, t('admin.imp.dryResult')) : null}
                {applied ? summary(applied, t('admin.imp.applyResult')) : null}
              </View>
            ) : null}
          </Section>
        </>
      )}
    </AdminShell>
  );
}
