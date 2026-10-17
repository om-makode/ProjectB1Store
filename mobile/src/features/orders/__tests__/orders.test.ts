import { initI18n } from '@/i18n';

import { canCustomerCancel, canReportIssue, type OrderDetail } from '../api';
import { timelineSteps } from '../timeline';
import { orderActionCode, orderActionMessage } from '../errors';
import { buildInvoiceHtml, invoiceLines } from '../invoice';

beforeAll(() => initI18n('en'));

const ev = (status: OrderDetail['status'], created_at: string, id = 1) => ({
  id,
  status,
  note: null,
  created_at,
});

describe('timelineSteps', () => {
  it('marks steps up to the current status', () => {
    const steps = timelineSteps('packing', [
      ev('placed', '2026-10-17T10:00:00Z'),
      ev('confirmed', '2026-10-17T10:02:00Z'),
      ev('packing', '2026-10-17T10:05:00Z'),
    ]);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(steps[1]!.at).toBe('2026-10-17T10:02:00Z');
  });

  it('shows only reached steps, then the cancellation', () => {
    const steps = timelineSteps('cancelled', [
      ev('placed', '2026-10-17T10:00:00Z'),
      ev('cancelled', '2026-10-17T10:03:00Z'),
    ]);
    expect(steps.map((s) => `${s.status}:${s.state}`)).toEqual([
      'placed:done',
      'cancelled:current',
    ]);
  });

  it('a delivered order has every step done', () => {
    expect(timelineSteps('delivered', []).every((s) => s.state === 'done')).toBe(true);
  });
});

describe('customer rules (mirror the RPCs)', () => {
  it('can cancel only before packing', () => {
    expect(canCustomerCancel('placed')).toBe(true);
    expect(canCustomerCancel('confirmed')).toBe(true);
    expect(canCustomerCancel('packing')).toBe(false);
    expect(canCustomerCancel('delivered')).toBe(false);
  });

  it('can report an issue within 48 hours of delivery', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(canReportIssue({ status: 'delivered', delivered_at: '2026-10-16T13:00:00Z' }, now)).toBe(
      true,
    );
    expect(canReportIssue({ status: 'delivered', delivered_at: '2026-10-15T11:00:00Z' }, now)).toBe(
      false,
    );
    expect(canReportIssue({ status: 'packed', delivered_at: null }, now)).toBe(false);
  });
});

describe('order action errors', () => {
  it('maps RPC codes to friendly text', () => {
    const e = { message: 'CANCEL_NOT_ALLOWED', code: 'P0001' };
    expect(orderActionCode(e)).toBe('CANCEL_NOT_ALLOWED');
    expect(orderActionMessage(e)).toMatch(/started packing/);
    expect(orderActionMessage({ message: 'Network request failed' })).not.toMatch(/packing/);
  });
});

describe('invoice', () => {
  const order = {
    id: 'o1',
    order_number: 'NK-261017-0001',
    status: 'delivered',
    payment_method: 'cod',
    placed_at: '2026-10-17T10:00:00Z',
    grand_total: 143,
    delivery_fee: 25,
    small_cart_fee: 0,
    packaging_fee: 0,
    address_snapshot: { receiver_name: 'Asha', house: '12', area: 'Rajapeth', city: 'Amravati' },
    stores: {
      id: 1,
      name: { en: 'NearKart Rajapeth' },
      address: { en: 'Amravati' },
      phone: '+919800000000',
      whatsapp: null,
      gstin: '27ABCDE1234F1Z5',
      fssai_license: '11522999000123',
    },
    order_items: [
      {
        id: 1,
        status: 'active',
        name_snapshot: { en: 'Atta' },
        variant_label_snapshot: { en: '5 kg' },
        hsn_code: '1101',
        quantity: 1,
        price: 118,
        line_total: 118,
        gst_rate: 0,
      },
      {
        id: 2,
        status: 'unavailable',
        name_snapshot: { en: 'Biscuits <b>' },
        variant_label_snapshot: { en: '200 g' },
        hsn_code: '1905',
        quantity: 2,
        price: 30,
        line_total: 60,
        gst_rate: 18,
      },
    ],
    order_status_events: [],
  } as unknown as OrderDetail;

  it('skips unavailable lines and backs GST out of inclusive prices', () => {
    const lines = invoiceLines(order, 'en');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: 'Atta (5 kg)', taxable: 118, tax: 0 });

    const gstLine = invoiceLines(
      { ...order, order_items: [{ ...order.order_items[1]!, status: 'active' }] } as OrderDetail,
      'en',
    )[0]!;
    expect(gstLine.taxable).toBe(50.85); // 60 / 1.18
    expect(gstLine.tax).toBe(9.15);
  });

  it('renders seller details and escapes HTML', () => {
    const html = buildInvoiceHtml(
      { ...order, order_items: [{ ...order.order_items[1]!, status: 'active' }] } as OrderDetail,
      'en',
    );
    expect(html).toContain('GSTIN: 27ABCDE1234F1Z5');
    expect(html).toContain('FSSAI: 11522999000123');
    expect(html).toContain('Biscuits &lt;b&gt;');
    expect(html).toContain('NK-261017-0001');
  });
});
