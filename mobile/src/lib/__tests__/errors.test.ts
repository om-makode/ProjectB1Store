import { AppError, toAppError, unwrap } from '../errors';

describe('toAppError', () => {
  it.each([
    [new TypeError('Network request failed'), 'network'],
    [{ code: '42501', message: 'denied' }, 'forbidden'],
    [{ code: 'PGRST116', message: '0 rows' }, 'notFound'],
    [{ code: '23505', message: 'dup' }, 'conflict'],
    [{ code: 'P0001', message: 'OUT_OF_STOCK' }, 'validation'],
    [{ code: 'PGRST301', message: 'jwt' }, 'unauthorized'],
    [{ code: 'XX000', message: 'boom' }, 'server'],
  ])('maps %p to %s', (input, kind) => {
    expect(toAppError(input).kind).toBe(kind);
  });

  it('passes AppError through', () => {
    const e = new AppError('config', 'x');
    expect(toAppError(e)).toBe(e);
  });

  it('marks network and server errors retryable', () => {
    expect(new AppError('network').retryable).toBe(true);
    expect(new AppError('validation').retryable).toBe(false);
  });
});

describe('unwrap', () => {
  it('returns data', async () => {
    await expect(unwrap(Promise.resolve({ data: [1], error: null }))).resolves.toEqual([1]);
  });
  it('throws AppError on error', async () => {
    await expect(
      unwrap(Promise.resolve({ data: null, error: { code: '42501', message: 'no' } })),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
