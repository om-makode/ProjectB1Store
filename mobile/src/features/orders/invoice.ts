import { Platform } from 'react-native';

import i18n, { type Lang } from '@/i18n';
import { asLocalized, localize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { hasExpoModule } from '@/lib/nativeOptional';

import type { OrderDetail } from './api';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const round2 = (n: number) => Math.round(n * 100) / 100;

export type InvoiceLine = {
  name: string;
  hsn: string;
  qty: number;
  rate: number;
  gstRate: number;
  amount: number; // GST-inclusive, as charged
  taxable: number;
  tax: number;
};

/**
 * Prices on the order are GST-inclusive (MRP rules), so tax is backed out per line:
 * taxable = amount / (1 + rate/100); intra-state supply → CGST = SGST = tax / 2.
 */
export function invoiceLines(order: OrderDetail, lang: Lang): InvoiceLine[] {
  return order.order_items
    .filter((i) => i.status === 'active')
    .map((i) => {
      const amount = Number(i.line_total);
      const gstRate = Number(i.gst_rate);
      const taxable = round2(amount / (1 + gstRate / 100));
      const label = localize(asLocalized(i.variant_label_snapshot), lang);
      return {
        name: `${localize(asLocalized(i.name_snapshot), lang)}${label ? ` (${label})` : ''}`,
        hsn: i.hsn_code ?? '',
        qty: i.quantity,
        rate: Number(i.price),
        gstRate,
        amount,
        taxable,
        tax: round2(amount - taxable),
      };
    });
}

export function buildInvoiceHtml(order: OrderDetail, lang: Lang): string {
  const t = (k: string, o?: Record<string, unknown>) => i18n.t(k as never, { lng: lang, ...o });
  const lines = invoiceLines(order, lang);
  const store = order.stores;
  const storeAddress = store ? localize(asLocalized(store.address), lang) : '';
  const addr = (order.address_snapshot ?? {}) as Record<string, unknown>;
  const addrText = ['receiver_name', 'house', 'area', 'landmark', 'city', 'pincode']
    .map((k) => addr[k])
    .filter((v): v is string => typeof v === 'string' && !!v.trim())
    .join(', ');
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  const taxableTotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
  const fees = [
    ['order.deliveryFee', order.delivery_fee],
    ['order.smallCartFee', order.small_cart_fee],
    ['order.packagingFee', order.packaging_fee],
  ] as const;

  const rows = lines
    .map(
      (l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.hsn)}</td><td class="r">${l.qty}</td>
<td class="r">${formatPrice(l.rate)}</td><td class="r">${l.gstRate}%</td><td class="r">${formatPrice(l.amount)}</td></tr>`,
    )
    .join('');
  const feeRows = fees
    .filter(([, v]) => Number(v) > 0)
    .map(
      ([k, v]) =>
        `<tr><td colspan="5">${esc(t(k))}</td><td class="r">${formatPrice(Number(v))}</td></tr>`,
    )
    .join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(order.order_number)}</title>
<style>
  body{font-family:'Noto Sans','Noto Sans Devanagari',Arial,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} .muted{color:#555} .row{display:flex;justify-content:space-between;gap:16px;margin:12px 0}
  table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
  th{background:#f3f4f6} .r{text-align:right} .total td{font-weight:700;border-top:2px solid #111}
  @media print{body{margin:8mm}}
</style></head><body>
<h1>${esc(t('invoice.title'))}</h1>
<div class="row">
  <div><b>${esc(t('invoice.seller'))}</b><br>${esc(store ? localize(asLocalized(store.name), lang) : '')}<br>
  <span class="muted">${esc(storeAddress)}</span><br>
  ${store?.gstin ? `GSTIN: ${esc(store.gstin)}<br>` : ''}${store?.fssai_license ? `FSSAI: ${esc(store.fssai_license)}` : ''}</div>
  <div class="r"><b>${esc(t('invoice.number'))}</b> ${esc(order.order_number)}<br>
  <b>${esc(t('invoice.date'))}</b> ${esc(formatDateTime(order.placed_at, lang))}<br>
  <b>${esc(t('invoice.payment'))}</b> ${esc(order.payment_method === 'cod' ? t('order.payCod') : t('order.payOnline'))}</div>
</div>
<div><b>${esc(t('invoice.billTo'))}</b><br>${esc(addrText)}</div>
<table><thead><tr><th>${esc(t('invoice.item'))}</th><th>${esc(t('invoice.hsn'))}</th><th class="r">${esc(t('invoice.qty'))}</th>
<th class="r">${esc(t('invoice.rate'))}</th><th class="r">${esc(t('invoice.gst'))}</th><th class="r">${esc(t('invoice.amount'))}</th></tr></thead>
<tbody>${rows}${feeRows}
<tr class="total"><td colspan="5">${esc(t('order.grandTotal'))}</td><td class="r">${formatPrice(Number(order.grand_total))}</td></tr>
</tbody></table>
<table><tbody>
<tr><td>${esc(t('invoice.taxable'))}</td><td class="r">${formatPrice(taxableTotal)}</td></tr>
<tr><td>${esc(t('invoice.cgst'))}</td><td class="r">${formatPrice(round2(taxTotal / 2))}</td></tr>
<tr><td>${esc(t('invoice.sgst'))}</td><td class="r">${formatPrice(round2(taxTotal - round2(taxTotal / 2)))}</td></tr>
</tbody></table>
<p class="muted">${esc(t('invoice.inclusive'))}</p>
</body></html>`;
}

/** Invoices need expo-print on phones (present after the next native rebuild); web uses the browser. */
export const canPrintInvoice = () => Platform.OS === 'web' || hasExpoModule('ExpoPrint');

export async function openInvoice(order: OrderDetail, lang: Lang): Promise<void> {
  await printHtml(buildInvoiceHtml(order, lang));
}

/**
 * Print/share any HTML (invoice, staff pick list).
 * Web: its own window + the browser print dialog. Phones: PDF share sheet, or the OS print dialog.
 */
export async function printHtml(html: string, opts: { share?: boolean } = {}): Promise<void> {
  if (Platform.OS === 'web') {
    // expo-print on web prints the current page, so print our HTML in its own window.
    const w = window.open('', '_blank');
    if (!w) throw new Error('POPUP_BLOCKED');
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    return;
  }
  const Print = await import('expo-print');
  if (opts.share !== false && hasExpoModule('ExpoSharing')) {
    const { uri } = await Print.printToFileAsync({ html });
    const Sharing = await import('expo-sharing');
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } else {
    await Print.printAsync({ html });
  }
}
