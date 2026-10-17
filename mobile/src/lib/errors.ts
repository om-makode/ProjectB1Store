export type AppErrorKind =
  | 'config'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'conflict'
  | 'server';

export class AppError extends Error {
  constructor(
    public kind: AppErrorKind,
    message?: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message ?? kind);
    this.name = 'AppError';
  }

  get retryable() {
    return this.kind === 'network' || this.kind === 'server';
  }
}

type LooseError = { message?: unknown; code?: unknown; status?: unknown; details?: unknown };

/**
 * Map supabase-js / PostgREST / Postgres errors to AppError.
 * Our RPCs raise with SQLSTATE 'P0001' and a machine code in the message, e.g. 'OUT_OF_STOCK'.
 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = (e ?? {}) as LooseError;
  const msg = typeof err.message === 'string' ? err.message : String(e);
  const code = typeof err.code === 'string' ? err.code : '';
  const status = typeof err.status === 'number' ? err.status : undefined;

  if (/Network request failed|Failed to fetch|fetch failed|NetworkError/i.test(msg))
    return new AppError('network', msg);
  if (code === 'PGRST301' || code === 'PGRST302' || status === 401)
    return new AppError('unauthorized', msg, code);
  if (code === '42501') return new AppError('forbidden', msg, code); // RLS / privilege
  if (code === 'PGRST116') return new AppError('notFound', msg, code); // .single() found 0 rows
  if (code === '23505') return new AppError('conflict', msg, code); // unique violation
  if (code.startsWith('23') || code === '22P02' || code === 'P0001')
    return new AppError('validation', msg, code, err.details);
  return new AppError('server', msg, code);
}

/** Unwrap { data, error } from any supabase call. */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let res: { data: T | null; error: unknown };
  try {
    res = await p;
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}
