import { parseOrderError, recoveryFor } from '../orderErrors';

describe('parseOrderError', () => {
  it('reads the code and the fresh quote the server attached', () => {
    const quote = { grand_total: 412, lines: [] };
    const e = { message: 'PRICE_CHANGED', code: 'P0001', details: JSON.stringify(quote) };
    const r = parseOrderError(e);
    expect(r.code).toBe('PRICE_CHANGED');
    expect(r.quote).toMatchObject({ grand_total: 412 });
    expect(recoveryFor(r.code)).toBe('reviewCart');
  });

  it('maps rate limiting (SQLSTATE PT429) and blockers raised by place_order', () => {
    expect(parseOrderError({ message: 'RATE_LIMITED', code: 'PT429' }).code).toBe('RATE_LIMITED');
    const r = parseOrderError({ message: 'NOT_SERVICEABLE', code: 'P0001', details: 'not json' });
    expect(r).toEqual({ code: 'NOT_SERVICEABLE', quote: null });
    expect(recoveryFor(r.code)).toBe('changeAddress');
  });

  it('treats a dropped connection as NETWORK (safe to retry with the same key)', () => {
    const r = parseOrderError(new TypeError('Network request failed'));
    expect(r.code).toBe('NETWORK');
    expect(recoveryFor(r.code)).toBe('retry');
  });

  it('falls back to UNKNOWN for anything else', () => {
    expect(parseOrderError({ message: 'duplicate key', code: '23505' }).code).toBe('UNKNOWN');
  });
});
