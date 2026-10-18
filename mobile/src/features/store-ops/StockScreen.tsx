import { useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Sheet,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import {
  adjustStock,
  listStock,
  receiveStock,
  setAvailable,
  setStock,
  type StockFilter,
  type StockReason,
  type StockRow,
} from './api';
import { BarcodeScannerSheet, canScanWithCamera } from './BarcodeScanner';
import { staffErrorMessage } from './errors';
import { useStaffAction, useStock, useStoreId } from './hooks';
import { QtyStepper } from './QtyStepper';
import { StoreNav } from './StoreGate';

const FILTERS: StockFilter[] = ['all', 'low', 'out', 'off'];
const REASONS = ['restock', 'adjustment', 'damage'] as const satisfies readonly StockReason[];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function StockPill({ row }: { row: StockRow }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const low = row.stock > 0 && row.stock <= row.low_stock_threshold;
  const tone = row.stock === 0 ? colors.danger : low ? colors.warning : colors.success;
  return (
    <View
      accessibilityLabel={
        row.stock === 0
          ? t('storeOps.stock.out')
          : t('storeOps.stock.stockLabel', { count: row.stock })
      }
      style={{
        minWidth: 56,
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: tone,
      }}
    >
      <Text variant="title" weight="bold" style={{ color: tone }}>
        {row.stock}
      </Text>
      <Text variant="caption" weight="semibold" style={{ color: tone, fontSize: 10 }}>
        {row.stock === 0
          ? t('storeOps.stock.out')
          : low
            ? t('storeOps.stock.low')
            : t('storeOps.ui.inStock')}
      </Text>
    </View>
  );
}

function StockLine({ row, onAdjust }: { row: StockRow; onAdjust: () => void }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const l = useLocalize();
  const storeId = useStoreId();
  const avail = useStaffAction(setAvailable);
  const bump = useStaffAction(adjustStock);
  const name = l(asLocalized(row.product_name));
  const onError = (e: unknown) => showToast(staffErrorMessage(e), 'danger');
  const step = (d: 1 | -1) =>
    storeId && bump.mutate([storeId, row.variant_id, d, 'adjustment', undefined], { onError });

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderWidth: isDark ? 1 : 0,
        borderColor: colors.border,
        opacity: row.is_available ? 1 : 0.7,
      }}
    >
      <ProductImage path={row.thumb_path} name={name} size={52} />
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <Text weight="semibold" numberOfLines={2}>
          {name}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {l(asLocalized(row.variant_label))} · {formatPrice(Number(row.price))}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          SKU {row.sku}
          {row.barcode ? ` · ${row.barcode}` : ''}
        </Text>
        {!row.is_available ? <Badge label={t('storeOps.stock.hidden')} tone="neutral" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <IconButton
          icon="minus"
          accessibilityLabel={t('storeOps.ui.minusOne')}
          onPress={() => step(-1)}
        />
        <StockPill row={row} />
        <IconButton
          icon="plus"
          accessibilityLabel={t('storeOps.ui.plusOne')}
          onPress={() => step(1)}
        />
      </View>
      <View style={{ alignItems: 'center', gap: spacing.xs }}>
        <Switch
          accessibilityLabel={
            row.is_available ? t('storeOps.stock.available') : t('storeOps.stock.hidden')
          }
          value={row.is_available}
          disabled={avail.isPending || !storeId}
          trackColor={{ true: colors.primary, false: colors.border }}
          onValueChange={(v) => avail.mutate([storeId!, row.variant_id, v], { onError })}
        />
        <Button
          title={t('storeOps.stock.adjust')}
          variant="ghost"
          icon="pencil-outline"
          onPress={onAdjust}
        />
      </View>
    </View>
  );
}

function AdjustSheet({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const storeId = useStoreId();
  const [mode, setMode] = useState<'delta' | 'exact'>('delta');
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('restock');
  const [exact, setExact] = useState(row ? String(row.stock) : '');
  const [note, setNote] = useState('');
  const adjust = useStaffAction(adjustStock);
  const set = useStaffAction(setStock);

  if (!row || !storeId) return null;
  // Reason decides the sign: new stock adds, damage removes, a correction can go either way.
  const signed =
    reason === 'damage' ? -Math.abs(delta) : reason === 'restock' ? Math.abs(delta) : delta;
  const onDone = () => {
    showToast(t('storeOps.stock.saved'), 'success');
    onClose();
  };
  const onError = (e: unknown) => showToast(staffErrorMessage(e), 'danger');

  return (
    <Sheet visible onClose={onClose} title={t('storeOps.stock.adjustTitle')} scroll>
      <View style={{ gap: spacing.md }}>
        <Text weight="semibold">
          {l(asLocalized(row.product_name))} · {l(asLocalized(row.variant_label))}
        </Text>
        <Text color="textMuted">{t('storeOps.stock.stockLabel', { count: row.stock })}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip
            label={t('storeOps.stock.adjust')}
            selected={mode === 'delta'}
            onPress={() => setMode('delta')}
          />
          <Chip
            label={t('storeOps.stock.setExact')}
            selected={mode === 'exact'}
            onPress={() => setMode('exact')}
          />
        </View>
        {mode === 'delta' ? (
          <>
            <Text weight="semibold">{t('storeOps.stock.reason')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {REASONS.map((r) => (
                <Chip
                  key={r}
                  label={t(`storeOps.stock.reasons.${r}`)}
                  selected={reason === r}
                  onPress={() => setReason(r)}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text>{t('storeOps.stock.delta')}</Text>
              <QtyStepper value={Math.abs(delta)} onChange={setDelta} min={1} />
              <Text weight="bold">→ {Math.max(0, row.stock + signed)}</Text>
            </View>
          </>
        ) : (
          <TextField
            label={t('storeOps.stock.exactLabel')}
            value={exact}
            onChangeText={(v) => setExact(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={5}
          />
        )}
        <TextField
          label={t('storeOps.stock.noteLabel')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
        <Button
          title={t('storeOps.stock.save')}
          loading={adjust.isPending || set.isPending}
          disabled={mode === 'exact' && exact === ''}
          fullWidth
          onPress={() =>
            mode === 'delta'
              ? adjust.mutate([storeId, row.variant_id, signed, reason, note || undefined], {
                  onSuccess: onDone,
                  onError,
                })
              : set.mutate([storeId, row.variant_id, Number(exact), note || undefined], {
                  onSuccess: onDone,
                  onError,
                })
          }
        />
      </View>
    </Sheet>
  );
}

type ReceiveLine = { row: StockRow; qty: number };

/** Supplier delivery: scan/search each item, enter qty, add everything in one transaction. */
function ReceiveSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const storeId = useStoreId();
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [code, setCode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const receive = useStaffAction(receiveStock);

  const addByCode = async (raw: string) => {
    const q = raw.trim();
    if (!q || !storeId) return;
    try {
      const rows = await listStock(storeId, 'all', q, 0);
      const row =
        rows.find((r) => r.barcode === q || r.sku === q) ??
        (rows.length === 1 ? rows[0] : undefined);
      if (!row) {
        showToast(t('storeOps.stock.notFound'), 'warning');
        return;
      }
      setLines((ls) => {
        const i = ls.findIndex((x) => x.row.variant_id === row.variant_id);
        if (i >= 0) return ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
        return [...ls, { row, qty: 1 }];
      });
      setCode('');
    } catch (e) {
      showToast(staffErrorMessage(e), 'danger');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('storeOps.stock.receiveTitle')} scroll>
      <View style={{ gap: spacing.md }}>
        <Text color="textMuted">{t('storeOps.stock.receiveHint')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('storeOps.stock.search')}
              value={code}
              onChangeText={setCode}
              onSubmitEditing={() => void addByCode(code)}
              autoCapitalize="none"
              returnKeyType="done"
            />
          </View>
          <Button
            title={t('storeOps.stock.addLine')}
            variant="secondary"
            onPress={() => void addByCode(code)}
          />
          {canScanWithCamera() ? (
            <IconButton
              icon="barcode-scan"
              accessibilityLabel={t('storeOps.stock.scan')}
              onPress={() => setScanOpen(true)}
            />
          ) : null}
        </View>
        {lines.map((x) => (
          <View
            key={x.row.variant_id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
          >
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {l(asLocalized(x.row.product_name))} · {l(asLocalized(x.row.variant_label))}
            </Text>
            <QtyStepper
              value={x.qty}
              onChange={(v) =>
                setLines((ls) =>
                  v <= 0
                    ? ls.filter((y) => y !== x)
                    : ls.map((y) => (y === x ? { ...y, qty: v } : y)),
                )
              }
            />
          </View>
        ))}
        <Button
          title={t('storeOps.stock.receiveSave', { count: lines.length })}
          disabled={lines.length === 0 || !storeId}
          loading={receive.isPending}
          fullWidth
          onPress={() =>
            receive.mutate(
              [storeId!, lines.map((x) => ({ variant_id: x.row.variant_id, qty: x.qty }))],
              {
                onSuccess: () => {
                  showToast(t('storeOps.stock.received'), 'success');
                  onClose();
                },
                onError: (e) => showToast(staffErrorMessage(e), 'danger'),
              },
            )
          }
        />
      </View>
      <BarcodeScannerSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={(c) => void addByCode(c)}
      />
    </Sheet>
  );
}

export function StockScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const storeId = useStoreId();
  const [filter, setFilter] = useState<StockFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const stock = useStock(storeId, filter, q);
  const rows = useMemo(() => stock.data?.pages.flat() ?? [], [stock.data]);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StoreNav />
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('storeOps.stock.search')}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoFocus={Platform.OS === 'web'} // USB scanners type straight into it
              returnKeyType="search"
            />
          </View>
          {canScanWithCamera() ? (
            <Button
              title={t('storeOps.stock.scan')}
              icon="barcode-scan"
              size="lg"
              onPress={() => setScanOpen(true)}
            />
          ) : null}
        </View>
        {Platform.OS === 'web' ? (
          <Text variant="caption" color="textMuted">
            {t('storeOps.ui.usbScannerHint')}
          </Text>
        ) : null}
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f}
              label={t(`storeOps.stock.filters.${f}`)}
              selected={filter === f}
              onPress={() => setFilter(f)}
            />
          ))}
          <View style={{ flex: 1 }} />
          <Button
            title={t('storeOps.stock.receive')}
            icon="truck-delivery-outline"
            onPress={() => setReceiveOpen(true)}
          />
        </View>
      </View>

      {stock.isPending ? (
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={80} />
        </View>
      ) : stock.isError ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.variant_id)}
          contentContainerStyle={{
            padding: spacing.md,
            gap: spacing.sm,
            paddingBottom: spacing.xxl,
          }}
          renderItem={({ item }) => <StockLine row={item} onAdjust={() => setAdjusting(item)} />}
          ListEmptyComponent={
            <EmptyState icon="package-variant" title={t('storeOps.stock.empty')} />
          }
          onEndReached={() => {
            if (stock.hasNextPage && !stock.isFetchingNextPage) void stock.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          refreshing={stock.isRefetching}
          onRefresh={() => void stock.refetch()}
        />
      )}

      {/* Remounted per product / per open, so each starts with fresh values. */}
      <AdjustSheet
        key={adjusting?.variant_id ?? 'none'}
        row={adjusting}
        onClose={() => setAdjusting(null)}
      />
      {receiveOpen ? <ReceiveSheet visible onClose={() => setReceiveOpen(false)} /> : null}
      <BarcodeScannerSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={setSearch}
      />
    </SafeAreaView>
  );
}
