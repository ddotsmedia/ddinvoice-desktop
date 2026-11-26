import { X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { ProbeResult } from '../shared/ipc';

/** Pinned server identity: the local CA PEM confirmed by the user at pairing. */
export interface Pin {
  origin: string;
  caPem: string;
}

export function fingerprintOf(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

interface RawResponse {
  status: number;
  body: string;
}

function send(origin: string, method: 'GET' | 'POST', path: string, opts: { ca?: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        host: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        servername: url.hostname,
        // Unpinned only for the probe (user confirms the fingerprint); pinned requests trust the stored CA alone.
        ca: opts.ca,
        rejectUnauthorized: opts.ca !== undefined,
        headers: { ...opts.headers, ...(opts.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(opts.body) } : {}) },
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Server did not respond in time')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Fetches the server CA over TLS without trust. The user must match the returned fingerprint with the server screen. */
export async function probeServer(origin: string): Promise<ProbeResult> {
  const res = await send(origin, 'GET', '/pairing/ca', {});
  if (res.status !== 200) throw new Error(`Server returned HTTP ${res.status} for its CA certificate`);
  return { caPem: res.body, caFingerprint: fingerprintOf(res.body) };
}

/** JSON request that trusts only the pinned CA. */
export async function pinnedJson(pin: Pin, method: 'POST', path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const res = await send(pin.origin, method, path, { ca: pin.caPem, headers, body: JSON.stringify(body) });
  let json: unknown = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * Electron certificate verifier for the renderer. Only the pinned host is decided here: the leaf must be
 * signed by the pinned CA, match the host and be within its validity. Everything else uses Chromium's result.
 * Returns the callback code: 0 = accept, -2 = reject, -3 = default verification.
 */
export function verifyPinned(pin: Pin | null, hostname: string, leafPem: string, now = new Date()): number {
  if (!pin) return -3;
  if (hostname !== new URL(pin.origin).hostname) return -3;
  try {
    const leaf = new X509Certificate(leafPem);
    const ca = new X509Certificate(pin.caPem);
    const ok =
      leaf.checkIssued(ca) &&
      leaf.verify(ca.publicKey) &&
      (leaf.checkHost(hostname) !== undefined || leaf.checkIP(hostname) !== undefined) &&
      new Date(leaf.validFrom) <= now &&
      now <= new Date(leaf.validTo);
    return ok ? 0 : -2;
  } catch {
    return -2;
  }
}
