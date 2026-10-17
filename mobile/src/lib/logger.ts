import { captureException } from './crash';

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;

export const logger = {
  // eslint-disable-next-line no-console
  debug: (...a: unknown[]) => enabled && console.log('[nk]', ...a),
  warn: (...a: unknown[]) => console.warn('[nk]', ...a),
  error: (...a: unknown[]) => {
    console.error('[nk]', ...a);
    captureException(a.find((x) => x instanceof Error) ?? new Error(String(a[0])), { args: a });
  },
};
