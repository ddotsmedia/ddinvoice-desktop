import { randomInt, timingSafeEqual } from 'node:crypto';

export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_PAIRING_FAILURES = 5;

/** One active 6-digit code at a time; expires after 10 min, single use, locked after repeated wrong guesses. */
export class PairingCodes {
  private current?: { code: string; expiresAt: number; failures: number };

  constructor(private readonly now: () => number = Date.now) {}

  issue(): { code: string; expiresAt: Date } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.current = { code, expiresAt, failures: 0 };
    return { code, expiresAt: new Date(expiresAt) };
  }

  /** True once; consumes the code. */
  consume(candidate: string): boolean {
    const c = this.current;
    if (!c || this.now() >= c.expiresAt) {
      this.current = undefined;
      return false;
    }
    const a = Buffer.from(candidate.padEnd(6).slice(0, 6));
    const ok = candidate.length === 6 && timingSafeEqual(a, Buffer.from(c.code));
    if (ok) {
      this.current = undefined;
      return true;
    }
    if (++c.failures >= MAX_PAIRING_FAILURES) this.current = undefined;
    return false;
  }
}
