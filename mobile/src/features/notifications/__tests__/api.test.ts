import { notificationHref, toNotification } from '../api';

describe('notificationHref', () => {
  it('uses the server url for customer routes', () => {
    expect(notificationHref({ url: '/order/abc', order_id: 'abc' })).toBe('/order/abc');
    expect(notificationHref({ url: '/product/amul-milk' })).toBe('/product/amul-milk');
  });
  it('falls back to the order id, and ignores staff or foreign links', () => {
    expect(notificationHref({ order_id: 'xyz' })).toBe('/order/xyz');
    expect(notificationHref({ url: '/store/order/1' })).toBeNull();
    expect(notificationHref({ url: 'https://evil.example' })).toBeNull();
    expect(notificationHref(null)).toBeNull();
  });
});

describe('toNotification', () => {
  it('narrows localized title/body', () => {
    const n = toNotification({
      id: 1,
      type: 'order_status',
      title: { en: 'Packed', mr: 'पॅक', hi: 42 },
      body: 'oops',
      data: {},
      read_at: null,
      created_at: '2026-10-17T10:00:00Z',
    } as never);
    expect(n.title).toEqual({ en: 'Packed', mr: 'पॅक', hi: undefined });
    expect(n.body).toEqual({});
  });
});
