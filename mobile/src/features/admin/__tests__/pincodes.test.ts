import { parsePincodes } from '../schema';

describe('parsePincodes', () => {
  it('splits on commas, spaces and newlines, dedupes and sorts', () => {
    expect(parsePincodes('444602, 444601\n444602  444603;')).toEqual({
      ok: ['444601', '444602', '444603'],
      bad: [],
    });
  });

  it('reports invalid entries (leading zero, wrong length, letters)', () => {
    expect(parsePincodes('044601, 44460, 4446011, abcdef, 444601').bad).toEqual([
      '044601',
      '44460',
      '4446011',
      'abcdef',
    ]);
  });

  it('empty text means no pincodes', () => {
    expect(parsePincodes('  ')).toEqual({ ok: [], bad: [] });
  });
});
