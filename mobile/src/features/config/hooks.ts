import { useQuery } from '@tanstack/react-query';

import { fetchPublicConfig, type ConfigRow } from './api';

export type AppConfig = Record<string, unknown>;

export const toConfigMap = (rows: ConfigRow[]): AppConfig =>
  Object.fromEntries(rows.map((r) => [r.key, r.value]));

export const useAppConfig = () =>
  useQuery({
    queryKey: ['appConfig'],
    queryFn: fetchPublicConfig,
    staleTime: 10 * 60_000,
    select: toConfigMap,
  });

/** Safe readers for the known keys (values are jsonb, so never trust their shape). */
export function readMinVersion(config: AppConfig, os: string): string | undefined {
  const v = config.min_app_version;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const s = (v as Record<string, unknown>)[os];
    return typeof s === 'string' ? s : undefined;
  }
  return undefined;
}

export function readSupportPhone(config: AppConfig): string | undefined {
  const v = config.support;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const s = (v as Record<string, unknown>).phone;
    return typeof s === 'string' ? s : undefined;
  }
  return undefined;
}
