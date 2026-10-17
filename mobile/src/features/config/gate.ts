import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { asLocalized, type LocalizedString } from '@/i18n/localize';

import type { AppConfig } from './hooks';

/** The installed app's version (app.config.ts `version`). */
export const appVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** -1 / 0 / 1 comparing dotted numeric versions ("1.2.10" > "1.2.9"). Junk parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const versionFor = (v: unknown, os: string): string | undefined => {
  const s = obj(v)?.[os];
  return typeof s === 'string' ? s : undefined;
};

export type Gate =
  | { kind: 'ok' }
  | { kind: 'updateAvailable'; latest: string }
  | { kind: 'updateRequired'; min: string }
  /** Whole app paused. `orderingOnly` maintenance only blocks checkout (server enforces it too). */
  | { kind: 'maintenance'; message: LocalizedString }
  | { kind: 'orderingPaused'; message: LocalizedString };

/**
 * What the app should do at launch, from app_config (Phase 9.9).
 * Web always runs the latest build, so version checks are skipped there.
 */
export function computeGate(
  config: AppConfig,
  os: string = Platform.OS,
  current: string = appVersion(),
): Gate {
  const m = obj(config.maintenance);
  if (m?.enabled === true) {
    const message = asLocalized(m.message);
    return m.ordering_only === false
      ? { kind: 'maintenance', message }
      : { kind: 'orderingPaused', message };
  }
  if (os === 'web') return { kind: 'ok' };
  const min = versionFor(config.min_app_version, os);
  if (min && compareVersions(current, min) < 0) return { kind: 'updateRequired', min };
  const latest = versionFor(config.latest_app_version, os);
  if (latest && compareVersions(current, latest) < 0) return { kind: 'updateAvailable', latest };
  return { kind: 'ok' };
}

/** Play Store page for this build's package (Android); App Store search fallback on iOS. */
export function storeUrl(os: string = Platform.OS): string | null {
  if (os === 'android') {
    const pkg = Constants.expoConfig?.android?.package ?? 'in.nearkart.app';
    return `https://play.google.com/store/apps/details?id=${pkg}`;
  }
  if (os === 'ios') return 'https://apps.apple.com/in/search?term=NearKart';
  return null;
}
