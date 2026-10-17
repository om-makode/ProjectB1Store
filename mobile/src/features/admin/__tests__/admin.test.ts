import { attributeCells, chunkByProduct, missingColumns, parseCsv, toCsv, toRecords } from '../csv';
import {
  attributeErrors,
  effectiveAdminFields,
  hoursToText,
  keyFromLabel,
  parseBuckets,
  schemaProblems,
  slugify,
  textToHours,
  type AdminField,
} from '../schema';

const milkType: AdminField = {
  key: 'milk_type',
  type: 'select',
  label: { en: 'Milk type' },
  options: [
    { value: 'cow', label: { en: 'Cow' } },
    { value: 'buffalo', label: { en: 'Buffalo' } },
  ],
};
const fat: AdminField = {
  key: 'fat',
  type: 'number',
  label: { en: 'Fat' },
  unit: '%',
  min: 0,
  max: 100,
};

describe('csv', () => {
  it('parses quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",दूध\n\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'दूध'],
      ['1', '2', '3'],
    ]);
  });

  it('round-trips through toCsv', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x, "q"', b: 'दूध' }]);
    const { records } = toRecords(parseCsv(csv));
    expect(records[0]).toMatchObject({ a: 'x, "q"', b: 'दूध', _row: '2' });
  });

  it('reports missing required columns', () => {
    expect(missingColumns(['product_slug', 'sku'])).toContain('category_slug');
  });

  it('never splits a product across chunks', () => {
    const recs = toRecords(
      parseCsv('product_slug,sku\n' + ['a,1', 'a,2', 'b,3', 'b,4', 'c,5'].join('\n')),
    ).records;
    const chunks = chunkByProduct(recs, 3);
    expect(chunks.map((c) => c.map((r) => r.sku))).toEqual([
      ['1', '2'],
      ['3', '4', '5'],
    ]);
  });

  it('writes attribute cells by type', () => {
    expect(attributeCells('organic', true)).toEqual({ 'attr.organic': 'yes' });
    expect(attributeCells('tags', ['x', 'y'])).toEqual({ 'attr.tags': 'x|y' });
    expect(attributeCells('note', { en: 'Hi', mr: 'नमस्कार' })).toMatchObject({
      'attr.note_en': 'Hi',
      'attr.note_mr': 'नमस्कार',
    });
  });
});

describe('attribute schema', () => {
  it('makes keys and slugs', () => {
    expect(keyFromLabel('Fat %')).toBe('fat');
    expect(keyFromLabel('Milk type')).toBe('milk_type');
    expect(slugify('Amul Taaza Milk 500 ml')).toBe('amul-taaza-milk-500-ml');
    expect(parseBuckets('100, 0 50, 50')).toEqual([0, 50, 100]);
  });

  it('child fields override parent fields with the same key', () => {
    const child = { ...fat, unit: 'g' };
    expect(effectiveAdminFields([milkType, fat], [child]).map((f) => f.unit)).toEqual([
      undefined,
      'g',
    ]);
  });

  it('rejects deleting a saved field or changing its type', () => {
    const problems = schemaProblems([milkType, fat], [{ ...fat, type: 'text' }]);
    expect(problems).toEqual(
      expect.arrayContaining([
        { code: 'deleted', key: 'milk_type' },
        { code: 'typeChanged', key: 'fat' },
      ]),
    );
    expect(schemaProblems([milkType], [{ ...milkType, deprecated: true }])).toEqual([]);
  });

  it('validates attribute values like the server', () => {
    const fields = [milkType, { ...fat, required: true }];
    expect(attributeErrors(fields, { fat: 3, milk_type: 'cow' })).toEqual({});
    expect(attributeErrors(fields, { milk_type: 'camel' })).toMatchObject({
      fat: 'required',
      milk_type: 'invalid',
    });
    expect(attributeErrors(fields, { fat: 3, colour: 'red' })).toHaveProperty('_');
  });
});

describe('opening hours text', () => {
  it('round-trips ranges and rejects bad input', () => {
    expect(textToHours('07:00-13:00, 16:00-22:30')).toEqual([
      { open: '07:00', close: '13:00' },
      { open: '16:00', close: '22:30' },
    ]);
    expect(textToHours('')).toEqual([]);
    expect(textToHours('7am-9pm')).toBeNull();
    expect(hoursToText([{ open: '07:00', close: '22:30' }])).toBe('07:00-22:30');
  });
});
