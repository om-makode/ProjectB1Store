import { addRecent } from '../recent';

describe('recent searches', () => {
  it('puts the newest first, de-duplicates case-insensitively, trims and caps at 10', () => {
    let items: string[] = [];
    items = addRecent(items, 'milk');
    items = addRecent(items, '  Atta  ');
    items = addRecent(items, 'MILK');
    expect(items).toEqual(['MILK', 'Atta']);
    expect(addRecent(items, 'a')).toEqual(items); // too short
    for (let i = 0; i < 20; i++) items = addRecent(items, `item ${i}`);
    expect(items).toHaveLength(10);
    expect(items[0]).toBe('item 19');
  });
});
