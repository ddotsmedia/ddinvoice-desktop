/** Thin fetch wrapper for the Local API. The server contract is in @ddinvoice/contracts (paths + error body). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    /** Extra error body fields, e.g. `current` on 409 VERSION_CONFLICT. */
    readonly extra: Record<string, unknown> = {},
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
  /** Expected record version for optimistic locking (sent as If-Match). */
  ifMatch?: number;
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

  /**
   * Opens a streaming GET (SSE). Same auth and one refresh retry as `send`. Caller owns the body reader and abort signal.
   */
  async openStream(path: string, signal: AbortSignal, retried = false): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'X-Device-Id': this.cfg.deviceId };
    const token = this.cfg.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(this.url(path), { headers, signal });
    if (res.status === 401 && !retried && (await this.cfg.refresh())) return this.openStream(path, signal, true);
    if (!res.ok || !res.body) throw new ApiError(res.status, 'STREAM_FAILED', res.statusText || 'Stream unavailable');
    return res;
  }

  /** GET for binary responses (support bundle zip). Same auth and one refresh retry as `send`. */
  async getBytes(path: string, retried = false): Promise<Uint8Array> {
    const headers: Record<string, string> = { Accept: 'application/zip, application/octet-stream', 'X-Device-Id': this.cfg.deviceId };
    const token = this.cfg.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(this.url(path), { headers });
    if (res.status === 401 && !retried && (await this.cfg.refresh())) return this.getBytes(path, true);
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', res.statusText || 'Request failed');
    return new Uint8Array(await res.arrayBuffer());
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
    if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
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
      const body = (json ?? {}) as { code?: string; message?: string; fields?: Record<string, string>; [k: string]: unknown };
      const { code, message, fields, ...extra } = body;
      throw new ApiError(res.status, code ?? 'HTTP_ERROR', message ?? res.statusText, fields ?? {}, extra);
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

export type VersionGate = 'ok' | 'updateRequired' | 'serverNeedsUpdate';

/** Client below server minClient -> updateRequired; client newer than the server -> serverNeedsUpdate (main PC first). */
export function versionGateFor(appVersion: string, server: { version: string; minClient: string }): VersionGate {
  if (!versionAtLeast(appVersion, server.minClient)) return 'updateRequired';
  if (!versionAtLeast(server.version, appVersion)) return 'serverNeedsUpdate';
  return 'ok';
}

/** Local clock may be off by at most this much before the desktop warns (server time is authoritative for dates). */
export const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

/** Skew of the local clock against the server, measured at the request midpoint to cancel network latency. */
export function clockSkewMs(serverTimeIso: string, requestStartMs: number, requestEndMs: number): number {
  const midpoint = (requestStartMs + requestEndMs) / 2;
  return midpoint - Date.parse(serverTimeIso);
}
