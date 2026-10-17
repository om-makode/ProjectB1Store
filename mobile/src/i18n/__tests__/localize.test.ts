import { asLocalized, localize } from '../localize';

describe('localize', () => {
  it('returns the current language', () => {
    expect(localize({ en: 'Milk', mr: 'दूध', hi: 'दूध' }, 'mr')).toBe('दूध');
  });
  it('falls back to English when the current language is missing or blank', () => {
    expect(localize({ en: 'Milk', mr: '  ' }, 'mr')).toBe('Milk');
    expect(localize({ en: 'Milk' }, 'hi')).toBe('Milk');
  });
  it('falls back to the first non-empty value when English is missing', () => {
    expect(localize({ hi: 'दूध' }, 'en')).toBe('दूध');
  });
  it('handles null, undefined and empty objects', () => {
    expect(localize(null, 'en')).toBe('');
    expect(localize(undefined, 'en')).toBe('');
    expect(localize({}, 'en')).toBe('');
  });
});

describe('asLocalized', () => {
  it('keeps only string en/mr/hi values', () => {
    expect(asLocalized({ en: 'A', mr: 5, xx: 'z' })).toEqual({
      en: 'A',
      mr: undefined,
      hi: undefined,
    });
  });
  it('returns {} for non-objects', () => {
    expect(asLocalized('x')).toEqual({});
    expect(asLocalized([1])).toEqual({});
    expect(asLocalized(null)).toEqual({});
  });
});
