import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStoreId } from '@/features/store-ops/hooks';
import { asLocalized, type LocalizedString } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { Button, ErrorState, Skeleton, Text, TextField, showToast } from '@/ui';

import { updateStoreSettings, type StoreRow } from './api';
import { hoursToText, parsePincodes, textToHours, type HoursRange as Range } from './schema';
import {
  AdminShell,
  ErrorList,
  Grid,
  LocalizedInput,
  NumberField,
  Section,
  SwitchRow,
} from './components';
import { useRefreshCatalog, useStoreRow } from './hooks';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];

const NUMBER_KEYS = [
  'min_order_value',
  'delivery_fee',
  'free_delivery_above',
  'small_cart_threshold',
  'small_cart_fee',
  'packaging_fee',
  'max_cod_order_value',
  'max_open_orders_per_user',
  'auto_cancel_minutes',
  'eta_minutes',
  'service_radius_km',
  'payment_hold_minutes',
] as const;
type NumberKey = (typeof NUMBER_KEYS)[number];

type Form = {
  name: LocalizedString;
  address: LocalizedString;
  phone: string;
  whatsapp: string;
  gstin: string;
  fssai_license: string;
  numbers: Record<NumberKey, number | null>;
  hours: Record<Day, string>;
  /** Delivery pincodes as typed: comma / space / newline separated. */
  pincodes: string;
  upi_enabled: boolean;
};

const fromRow = (s: StoreRow): Form => {
  const hours = (s.opening_hours ?? {}) as Partial<Record<Day, Range[]>>;
  return {
    name: asLocalized(s.name),
    address: asLocalized(s.address),
    phone: s.phone ?? '',
    whatsapp: s.whatsapp ?? '',
    gstin: s.gstin ?? '',
    fssai_license: s.fssai_license ?? '',
    numbers: Object.fromEntries(NUMBER_KEYS.map((k) => [k, Number(s[k])])) as Record<
      NumberKey,
      number | null
    >,
    hours: Object.fromEntries(DAYS.map((d) => [d, hoursToText(hours[d])])) as Record<Day, string>,
    pincodes: (s.serviceable_pincodes ?? []).join(', '),
    upi_enabled: !!s.upi_enabled,
  };
};

/** Loads the store row, then mounts the form seeded from it. */
export function StoreSettingsScreen() {
  const { t } = useTranslation();
  const storeId = useStoreId();
  const q = useStoreRow(storeId);

  if (!storeId || q.isPending) {
    return (
      <AdminShell title={t('admin.nav.settings')}>
        <Skeleton width="100%" height={400} />
      </AdminShell>
    );
  }
  if (q.error) {
    return (
      <AdminShell title={t('admin.nav.settings')}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </AdminShell>
    );
  }
  return <StoreSettingsForm storeId={storeId} initial={fromRow(q.data)} />;
}

function StoreSettingsForm({ storeId, initial }: { storeId: number; initial: Form }) {
  const { t } = useTranslation();
  const refresh = useRefreshCatalog();
  const [form, setForm] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setNum = (k: NumberKey) => (v: number | null) =>
    setForm({ ...form, numbers: { ...form.numbers, [k]: v } });

  const save = async () => {
    setErr(null);
    const opening_hours: Partial<Record<Day, Range[]>> = {};
    const bad: string[] = [];
    for (const d of DAYS) {
      const r = textToHours(form.hours[d]);
      if (r === null) bad.push(t(`admin.store.day_${d}`));
      else opening_hours[d] = r;
    }
    if (bad.length) return setErr(t('admin.store.errHours', { days: bad.join(', ') }));
    const missing = NUMBER_KEYS.filter((k) => form.numbers[k] === null);
    if (missing.length)
      return setErr(
        t('admin.store.errNumbers', {
          fields: missing.map((k) => t(`admin.store.${k}`)).join(', '),
        }),
      );
    const pincodes = parsePincodes(form.pincodes);
    if (pincodes.bad.length)
      return setErr(t('admin.store.errPincodes', { codes: pincodes.bad.join(', ') }));
    setBusy(true);
    try {
      const updated = (await updateStoreSettings(storeId, {
        name: form.name,
        address: form.address,
        phone: form.phone.trim(),
        whatsapp: form.whatsapp.trim(),
        gstin: form.gstin.trim(),
        fssai_license: form.fssai_license.trim(),
        opening_hours,
        ...form.numbers,
        serviceable_pincodes: pincodes.ok,
        upi_enabled: form.upi_enabled,
      })) as unknown as StoreRow;
      setForm(fromRow(updated));
      refresh();
      showToast(t('admin.saved'), 'success');
    } catch (e) {
      setErr(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell
      title={t('admin.nav.settings')}
      subtitle={t('admin.ui.settingsSubtitle')}
      actions={
        <Button
          title={t('admin.save')}
          icon="content-save"
          onPress={() => void save()}
          loading={busy}
        />
      }
      footer={
        <Button
          title={t('admin.save')}
          icon="content-save"
          size="lg"
          onPress={() => void save()}
          loading={busy}
        />
      }
    >
      <ErrorList message={err} />
      <Section icon="cash" title={t('admin.store.fees')}>
        <Text variant="caption" color="textMuted">
          {t('admin.store.feesHint')}
        </Text>
        <Grid cols={3}>
          {(
            [
              'min_order_value',
              'delivery_fee',
              'free_delivery_above',
              'small_cart_threshold',
              'small_cart_fee',
              'packaging_fee',
            ] as const
          ).map((k) => (
            <NumberField
              key={k}
              label={`${t(`admin.store.${k}`)} (₹)`}
              value={form.numbers[k]}
              onChange={setNum(k)}
            />
          ))}
        </Grid>
      </Section>
      <Section icon="shield-check-outline" title={t('admin.store.limits')}>
        <Grid cols={3}>
          <NumberField
            label={`${t('admin.store.max_cod_order_value')} (₹)`}
            value={form.numbers.max_cod_order_value}
            onChange={setNum('max_cod_order_value')}
          />
          <NumberField
            label={t('admin.store.max_open_orders_per_user')}
            hint="1–10"
            value={form.numbers.max_open_orders_per_user}
            onChange={setNum('max_open_orders_per_user')}
          />
          <NumberField
            label={t('admin.store.auto_cancel_minutes')}
            hint="2–60"
            value={form.numbers.auto_cancel_minutes}
            onChange={setNum('auto_cancel_minutes')}
          />
          <NumberField
            label={t('admin.store.eta_minutes')}
            hint="5–240"
            value={form.numbers.eta_minutes}
            onChange={setNum('eta_minutes')}
          />
          <NumberField
            label={t('admin.store.service_radius_km')}
            hint="0.3–30"
            value={form.numbers.service_radius_km}
            onChange={setNum('service_radius_km')}
          />
        </Grid>
      </Section>
      <Section icon="map-marker-radius-outline" title={t('admin.store.delivery')}>
        <TextField
          label={t('admin.store.pincodes')}
          value={form.pincodes}
          placeholder="444601, 444602, 444603"
          multiline
          hint={t('admin.store.pincodesHint', { count: parsePincodes(form.pincodes).ok.length })}
          error={
            parsePincodes(form.pincodes).bad.length
              ? t('admin.store.errPincodes', { codes: parsePincodes(form.pincodes).bad.join(', ') })
              : null
          }
          keyboardType="numbers-and-punctuation"
          onChangeText={(pincodes) => setForm({ ...form, pincodes })}
        />
      </Section>
      <Section icon="credit-card-outline" title={t('admin.store.payments')}>
        <SwitchRow
          label={t('admin.store.upi_enabled')}
          hint={t('admin.store.upiHint')}
          value={form.upi_enabled}
          onChange={(upi_enabled) => setForm({ ...form, upi_enabled })}
        />
        <Grid cols={3}>
          <NumberField
            label={t('admin.store.payment_hold_minutes')}
            hint="5–60"
            value={form.numbers.payment_hold_minutes}
            onChange={setNum('payment_hold_minutes')}
          />
        </Grid>
      </Section>
      <Section icon="clock-outline" title={t('admin.store.hours')}>
        <Text variant="caption" color="textMuted">
          {t('admin.store.hoursHint')}
        </Text>
        <Grid cols={2}>
          {DAYS.map((d) => (
            <TextField
              key={d}
              label={t(`admin.store.day_${d}`)}
              value={form.hours[d]}
              placeholder="07:00-22:30"
              error={textToHours(form.hours[d]) === null ? t('admin.store.badRange') : null}
              hint={form.hours[d].trim() ? undefined : t('admin.store.closedDay')}
              onChangeText={(s) => setForm({ ...form, hours: { ...form.hours, [d]: s } })}
            />
          ))}
        </Grid>
      </Section>
      <Section icon="card-account-details-outline" title={t('admin.store.identity')}>
        <LocalizedInput
          label={t('admin.store.name')}
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
        />
        <LocalizedInput
          label={t('admin.store.address')}
          value={form.address}
          onChange={(address) => setForm({ ...form, address })}
          multiline
        />
        <Grid>
          <TextField
            label={t('admin.store.phone')}
            value={form.phone}
            keyboardType="phone-pad"
            onChangeText={(phone) => setForm({ ...form, phone })}
          />
          <TextField
            label={t('admin.store.whatsapp')}
            value={form.whatsapp}
            keyboardType="phone-pad"
            onChangeText={(whatsapp) => setForm({ ...form, whatsapp })}
          />
          <TextField
            label="GSTIN"
            value={form.gstin}
            autoCapitalize="characters"
            hint={t('admin.store.gstinHint')}
            onChangeText={(gstin) => setForm({ ...form, gstin: gstin.toUpperCase() })}
          />
          <TextField
            label={t('admin.store.fssai')}
            value={form.fssai_license}
            keyboardType="number-pad"
            hint={t('admin.store.fssaiHint')}
            onChangeText={(fssai_license) =>
              setForm({ ...form, fssai_license: fssai_license.replace(/\D/g, '') })
            }
          />
        </Grid>
      </Section>
    </AdminShell>
  );
}
