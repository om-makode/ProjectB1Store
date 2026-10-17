import { shouldPersistQuery } from '@/lib/queryClient';

import { compareVersions, computeGate } from '../gate';

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.0.0', android: { package: 'x' } },
}));

const msg = { en: 'Back soon' };

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });
});

describe('computeGate', () => {
  const versions = {
    min_app_version: { android: '1.0.0' },
    latest_app_version: { android: '1.1.0' },
  };

  it('blocks builds below the minimum', () => {
    expect(computeGate(versions, 'android', '0.9.0')).toEqual({
      kind: 'updateRequired',
      min: '1.0.0',
    });
  });

  it('suggests an update between min and latest', () => {
    expect(computeGate(versions, 'android', '1.0.0').kind).toBe('updateAvailable');
    expect(computeGate(versions, 'android', '1.1.0').kind).toBe('ok');
  });

  it('skips version checks on web', () => {
    expect(computeGate(versions, 'web', '0.0.1').kind).toBe('ok');
  });

  it('maintenance: ordering-only by default, full app when ordering_only is false', () => {
    expect(
      computeGate({ maintenance: { enabled: true, message: msg } }, 'android', '1.0.0').kind,
    ).toBe('orderingPaused');
    expect(
      computeGate({ maintenance: { enabled: true, ordering_only: false, message: msg } }, 'web')
        .kind,
    ).toBe('maintenance');
    expect(computeGate({ maintenance: { enabled: false } }, 'android', '1.0.0').kind).toBe('ok');
  });

  it('ignores malformed config', () => {
    expect(computeGate({ min_app_version: 'oops', maintenance: [] }, 'android', '1.0.0').kind).toBe(
      'ok',
    );
  });
});

describe('offline cache whitelist', () => {
  it('persists customer data but not staff/admin or fresh-only queries', () => {
    expect(shouldPersistQuery(['catalog', 'home'])).toBe(true);
    expect(shouldPersistQuery(['orders', 'list'])).toBe(true);
    expect(shouldPersistQuery(['admin', 'products'])).toBe(false);
    expect(shouldPersistQuery(['store-ops', 'board', 1])).toBe(false);
    expect(shouldPersistQuery(['cartQuote'])).toBe(false);
    expect(shouldPersistQuery(['serviceability', 1, 2])).toBe(false);
  });
});
