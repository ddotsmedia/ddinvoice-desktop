/** Thin fetch wrapper for the Local API. The server contract is in @ddinvoice/contracts (paths + error body). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** i18n key for a generic message; the screen shows field errors inline when `fields` is non-empty. */
  get messageKey(): string {
    if (this.status === 0) return 'errors.network';
    if (this.status === 401) return 'errors.unauthorized';
    if (this.status === 403) return 'errors.forbidden';
    if (this.status === 409) return 'errors.conflict';
    if (this.status === 422 || this.status === 400) return 'errors.validation';
    return 'errors.generic';
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  /** Required for commands (POST/PATCH/DELETE on business endpoints). Generated when omitted. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiConfig {
  origin: string;
  deviceId: string;
  getAccessToken: () => string | null;
  /** Returns true when a new access token is available after a refresh. */
  refresh: () => Promise<boolean>;
}

export class Api {
  constructor(private readonly cfg: ApiConfig) {}

  get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>('GET', path, opts);
  }

  post<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>('POST', path, { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() });
  }

  patch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>('PATCH', path, { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() });
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const u = new URL(path, this.cfg.origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async send<T>(method: string, path: string, opts: RequestOptions, retried = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': this.cfg.deviceId };
    const token = this.cfg.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', 'Server unreachable');
    }

    const authEndpoint = path === '/auth/refresh' || path === '/auth/login';
    if (res.status === 401 && !retried && !authEndpoint && (await this.cfg.refresh())) {
      return this.send<T>(method, path, opts, true);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const body = (json ?? {}) as { code?: string; message?: string; fields?: Record<string, string> };
      throw new ApiError(res.status, body.code ?? 'HTTP_ERROR', body.message ?? res.statusText, body.fields ?? {});
    }
    return json as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** True when `current` >= `minimum` for dotted numeric versions ("0.5.0"). */
export function versionAtLeast(current: string, minimum: string): boolean {
  const a = current.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = minimum.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
