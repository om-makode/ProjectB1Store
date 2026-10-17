import en from '../locales/en.json';
import hi from '../locales/hi.json';
import mr from '../locales/mr.json';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('translation key parity', () => {
  const enKeys = keys(en).sort();
  it.each([
    ['mr', mr],
    ['hi', hi],
  ])('%s has exactly the English keys', (_, locale) => {
    expect(keys(locale).sort()).toEqual(enKeys);
  });
});
