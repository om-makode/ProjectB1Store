import i18n, { type Lang } from '@/i18n';
import { asLocalized, localize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import type { OrderDetail } from '@/features/orders/api';
import { buildInvoiceHtml, printHtml } from '@/features/orders/invoice';

import type { Paper } from './store';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Thermal receipt printers are 58 mm or 80 mm wide (≈ 48/72 mm printable). The browser / OS
 * print dialog sends to them like any printer, so a narrow page + big type is all it takes.
 */
export function paperCss(paper: Paper): string {
  if (paper === 'a4') return '@page{size:A4;margin:10mm}';
  const w = paper === '80mm' ? 72 : 48;
  return `@page{size:${paper === '80mm' ? 80 : 58}mm auto;margin:2mm}
body{margin:0 !important;width:${w}mm;font-size:${paper === '80mm' ? 12 : 10}px}
table{font-size:inherit} th,td{padding:3px 2px !important} .row{display:block !important}
h1{font-size:15px !important}`;
}

const withPaper = (html: string, paper: Paper) =>
  html.replace('</style>', `${paperCss(paper)}</style>`);

/** Pick list: what to take off the shelf, biggest font for the quantity, tick boxes. */
export function buildPickListHtml(order: OrderDetail, lang: Lang, paper: Paper): string {
  const t = (k: string, o?: Record<string, unknown>) => i18n.t(k as never, { lng: lang, ...o });
  const addr = (order.address_snapshot ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof addr[k] === 'string' ? (addr[k] as string) : '');
  const rows = order.order_items
    .filter((i) => i.status === 'active')
    .map((i) => {
      const label = localize(asLocalized(i.variant_label_snapshot), lang);
      return `<tr><td class="box">☐</td><td class="q">${i.quantity}×</td>
<td>${esc(localize(asLocalized(i.name_snapshot), lang))}${label ? ` <span class="muted">(${esc(label)})</span>` : ''}</td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(order.order_number)}</title>
<style>
  body{font-family:'Noto Sans','Noto Sans Devanagari',Arial,sans-serif;color:#000;margin:16px;font-size:14px}
  h1{font-size:22px;margin:0} .muted{color:#444} table{width:100%;border-collapse:collapse;margin-top:8px}
  td{border-bottom:1px dashed #999;padding:6px 4px;vertical-align:top} .q{font-weight:700;font-size:1.3em;white-space:nowrap}
  .box{width:1.4em;font-size:1.3em} .note{border:2px solid #000;padding:6px;margin-top:8px;font-weight:700}
</style></head><body>
<h1>${esc(order.order_number)}</h1>
<div class="muted">${esc(t('storeOps.print.pickList'))} · ${esc(formatDateTime(order.placed_at, lang))}</div>
<div><b>${esc(str('receiver_name'))}</b> ${esc(str('receiver_phone'))}<br>
${esc([str('house'), str('area'), str('landmark')].filter(Boolean).join(', '))}</div>
${order.customer_note ? `<div class="note">${esc(order.customer_note)}</div>` : ''}
<table><tbody>${rows}</tbody></table>
<p><b>${esc(t('order.grandTotal'))}: ${formatPrice(Number(order.grand_total))}</b>
${order.payment_method === 'cod' ? ` · ${esc(t('storeOps.collectCash'))}` : ''}</p>
</body></html>`;
  return withPaper(html, paper);
}

export const printPickList = (order: OrderDetail, lang: Lang, paper: Paper) =>
  printHtml(buildPickListHtml(order, lang, paper), { share: false });

export const printInvoice = (order: OrderDetail, lang: Lang, paper: Paper) =>
  printHtml(withPaper(buildInvoiceHtml(order, lang), paper), { share: false });
