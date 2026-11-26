import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { LICENSE_PUBLIC_KEY_PEM } from './license-public-key';

export const LICENSE_MODULES = ['sales', 'purchases', 'banking', 'reports', 'payroll', 'einvoice', 'sync'] as const;
export type LicenseModule = (typeof LICENSE_MODULES)[number];

export const LICENSE_PREFIX = 'DDL1';
export const TRIAL_KEY = 'TRIAL';
export const DAY_MS = 24 * 3_600_000;
/** Offline grace: how long the app may run without a successful online validation (online check lands in Prompt 10). */
export const OFFLINE_GRACE_MS = 30 * DAY_MS;

export const LicensePayloadSchema = z.object({
  companyId: z.uuid(),
  companyName: z.string().min(1).max(200),
  trn: z.string().regex(/^\d{15}$/),
  seats: z.number().int().min(1).max(10_000),
  modules: z.array(z.enum(LICENSE_MODULES)).min(1),
  expiresAt: z.iso.datetime().optional(),
  issuedAt: z.iso.datetime(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export class LicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

/** Vendor-side: signs a payload. The private key comes from LICENSE_SIGNING_KEY (never from the repo). */
export function signLicense(payload: LicensePayload, privatePem: string): string {
  const body = Buffer.from(JSON.stringify(LicensePayloadSchema.parse(payload)), 'utf8');
  const sig = sign(null, body, createPrivateKey(privatePem));
  return `${LICENSE_PREFIX}.${body.toString('base64url')}.${sig.toString('base64url')}`;
}

/** Verifies the Ed25519 signature before anything in the payload is trusted. Throws LicenseError. */
export function parseLicense(text: string, publicPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload {
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) throw new LicenseError('Not a DDInvoice license file');
  const body = Buffer.from(parts[1]!, 'base64url');
  const sig = Buffer.from(parts[2]!, 'base64url');
  let valid = false;
  try {
    valid = verify(null, body, createPublicKey(publicPem), sig);
  } catch {
    valid = false;
  }
  if (!valid) throw new LicenseError('License signature is invalid');
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    throw new LicenseError('License payload is not JSON');
  }
  const parsed = LicensePayloadSchema.safeParse(json);
  if (!parsed.success) throw new LicenseError('License payload is invalid');
  return parsed.data;
}

export type LicenseMode = 'FULL' | 'READ_ONLY';
export type LicenseReason = 'NO_LICENSE' | 'EXPIRED' | 'OFFLINE_GRACE' | 'INVALID';

export interface LicenseState {
  mode: LicenseMode;
  reason?: LicenseReason;
  seats: number;
  modules: LicenseModule[];
  expiresAt?: string;
  trial: boolean;
}

/**
 * Expired (or past offline grace) → READ_ONLY: view, print and export only. Commands are refused by LicenseGuard
 * and login is still allowed so the owner can install a new license.
 */
export function evaluateLicense(
  payload: LicensePayload | undefined,
  now: Date,
  opts: { trial?: boolean; lastValidatedAt?: Date | null; invalid?: boolean } = {},
): LicenseState {
  if (!payload) {
    return { mode: 'READ_ONLY', reason: opts.invalid ? 'INVALID' : 'NO_LICENSE', seats: 0, modules: [], trial: false };
  }
  const base = { seats: payload.seats, modules: payload.modules, expiresAt: payload.expiresAt, trial: opts.trial ?? false };
  if (payload.expiresAt && now.getTime() >= new Date(payload.expiresAt).getTime()) {
    return { ...base, mode: 'READ_ONLY', reason: 'EXPIRED' };
  }
  if (opts.lastValidatedAt && now.getTime() - opts.lastValidatedAt.getTime() > OFFLINE_GRACE_MS) {
    return { ...base, mode: 'READ_ONLY', reason: 'OFFLINE_GRACE' };
  }
  return { ...base, mode: 'FULL' };
}
