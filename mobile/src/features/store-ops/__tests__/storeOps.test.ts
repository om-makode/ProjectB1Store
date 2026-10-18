import type { OrderDetail } from '@/features/orders/api';
import { initI18n } from '@/i18n';

import { columnOf } from '../api';
import { staffErrorCode, staffErrorMessage } from '../errors';
import { countdown } from '../hooks';
import { buildPickListHtml, paperCss } from '../print';

beforeAll(() => initI18n('en'));

describe('columnOf', () => {
  it('maps every board status to its column and hides unpaid orders', () => {
    expect(columnOf('placed')).toBe('new');
    expect(columnOf('confirmed')).toBe('accepted');
    expect(columnOf('packing')).toBe('packing');
    expect(columnOf('packed')).toBe('ready');
    expect(columnOf('out_for_delivery')).toBe('out');
    expect(columnOf('delivered')).toBe('done');
    expect(columnOf('cancelled')).toBe('done');
    expect(columnOf('awaiting_payment')).toBeNull();
  });
});

describe('countdown', () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  it('formats minutes and seconds left, never negative', () => {
    expect(countdown('2026-10-17T10:04:05Z', now)).toBe('4:05');
    expect(countdown('2026-10-17T09:59:00Z', now)).toBe('0:00');
    expect(countdown(null, now)).toBeNull();
  });
});

describe('staff errors', () => {
  it('finds the RPC code and shows friendly text', () => {
    const e = { message: 'ITEMS_NOT_PICKED', code: 'P0001' };
    expect(staffErrorCode(e)).toBe('ITEMS_NOT_PICKED');
    expect(staffErrorMessage(e)).toMatch(/Pick every item/);
    expect(staffErrorMessage({ message: 'INVALID_ETA', code: 'P0001' })).toMatch(/between 0 and 240/i);
    expect(staffErrorMessage({ message: 'ORDER_LOCKED', code: 'P0001' })).toMatch(/can't be changed/i);
    expect(staffErrorMessage({ message: 'weird', code: 'XX000' })).toMatch(/Couldn't save/);
    expect(staffErrorMessage(new TypeError('Network request failed'))).toMatch(/internet/);
  });
});

describe('pick list', () => {
  const order = {
    id: 'o1',
    order_number: 'NK-261017-0001',
    placed_at: '2026-10-17T10:00:00Z',
    grand_total: 245,
    payment_method: 'cod',
    customer_note: 'Ring the bell <twice>',
    address_snapshot: {
      receiver_name: 'Asha',
      receiver_phone: '9876543210',
      house: '12',
      area: 'Rajapeth',
    },
    order_items: [
      {
        id: 1,
        status: 'active',
        quantity: 2,
        name_snapshot: { en: 'Amul Milk' },
        variant_label_snapshot: { en: '500 ml' },
      },
      {
        id: 2,
        status: 'unavailable',
        quantity: 1,
        name_snapshot: { en: 'Bread' },
        variant_label_snapshot: null,
      },
    ],
  } as unknown as OrderDetail;

  it('lists only active lines, escapes notes and asks to collect cash', () => {
    const html = buildPickListHtml(order, 'en', 'a4');
    expect(html).toContain('Amul Milk');
    expect(html).toContain('2×');
    expect(html).not.toContain('Bread');
    expect(html).toContain('Ring the bell &lt;twice&gt;');
    expect(html).toContain('Collect cash');
  });

  it('narrows the page for thermal printers', () => {
    expect(paperCss('80mm')).toContain('width:72mm');
    expect(paperCss('58mm')).toContain('width:48mm');
    expect(buildPickListHtml(order, 'en', '58mm')).toContain('size:58mm auto');
  });
});
