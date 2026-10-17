import { notificationHref } from '@/features/notifications/api';

import { buyAgainToCard, parseScheduleIST, type BuyAgainRow } from '../api';
import { productShareUrl, shareText } from '../share';

const row: BuyAgainRow = {
  product_id: 7,
  product_slug: 'amul-taaza-milk',
  product_name: { en: 'Amul Taaza Milk', mr: 'अमूल ताजा दूध' },
  is_veg: true,
  variant_id: 70,
  variant_label: { en: '500 ml' },
  price: 27,
  mrp: 30,
  max_per_order: 6,
  thumb_path: 'products/x_thumb.webp',
  stock: 3,
  in_stock: true,
  times_bought: 4,
  last_bought_at: '2026-10-01T00:00:00Z',
};

describe('buyAgainToCard', () => {
  it('maps a buy_again row to the shared card shape', () => {
    const c = buyAgainToCard(row);
    expect(c).toMatchObject({
      id: 7,
      slug: 'amul-taaza-milk',
      thumb_path: 'products/x_thumb.webp',
    });
    expect(c.variant).toMatchObject({ id: 70, price: 27, mrp: 30, discount_pct: 10 });
    expect(c.variant.available_qty).toBe(3); // min(stock, max_per_order)
    expect(c.variant.low_stock).toBe(true);
  });
  it('is unavailable when out of stock or switched off', () => {
    expect(buyAgainToCard({ ...row, in_stock: false }).variant.available_qty).toBe(0);
    expect(buyAgainToCard({ ...row, stock: 40 }).variant.available_qty).toBe(6);
  });
});

describe('notification links (Phase 8)', () => {
  it('opens the review screen and campaign / price-drop links', () => {
    expect(notificationHref({ order_id: 'o1', route: '/order/o1/review' })).toBe(
      '/order/o1/review',
    );
    expect(notificationHref({ link: { type: 'product', value: 345 } })).toBe('/product/345');
    expect(notificationHref({ link: { type: 'category', value: 'dairy' } })).toBe(
      '/category/dairy',
    );
    expect(notificationHref({ link: { type: 'search', value: 'doodh' } })).toBe('/search?q=doodh');
    expect(notificationHref({ link: { type: 'bogus', value: 'x' } })).toBeNull();
  });
});

describe('share links', () => {
  it('builds /p/<slug> on the web host', () => {
    expect(productShareUrl('amul milk', 'https://nearkart.pages.dev/')).toBe(
      'https://nearkart.pages.dev/p/amul%20milk',
    );
    expect(shareText('Milk', '₹27', 'https://x/p/m')).toBe('Milk · ₹27\nhttps://x/p/m');
  });
});

describe('parseScheduleIST', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  it('reads IST wall-clock time', () => {
    expect(parseScheduleIST('2026-11-14 10:30', now)?.toISOString()).toBe(
      '2026-11-14T05:00:00.000Z',
    );
  });
  it('rejects bad input and past times', () => {
    expect(parseScheduleIST('14/11/2026 10:30', now)).toBeNull();
    expect(parseScheduleIST('2026-13-01 10:00', now)).toBeNull();
    expect(parseScheduleIST('2026-10-01 10:00', now)).toBeNull();
  });
});
