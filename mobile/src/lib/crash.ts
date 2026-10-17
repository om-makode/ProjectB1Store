/**
 * Crash reporting hook (Phase 9.4). No SDK is bundled yet, so this is a no-op unless a
 * reporter is registered. To add Sentry later (needs a rebuild):
 *   npx expo install @sentry/react-native   → add its config plugin + metro wrapper
 *   Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })
 *   setCrashReporter((e, ctx) => Sentry.captureException(e, { extra: ctx }))
 */
type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: Reporter | null = null;

export function setCrashReporter(r: Reporter | null) {
  reporter = r;
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  try {
    reporter?.(error, context);
  } catch {
    // never let reporting crash the app
  }
}
