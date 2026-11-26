import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import { KEYS } from '../core/tokens';
import type { JwtKeys } from '../core/keys';
import { sha256Hex } from '../common/canonical';

export const JWT_ISSUER = 'ddinvoice-server';
export const JWT_AUDIENCE = 'ddinvoice-client';
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 3600_000;

/** Access JWT (EdDSA, 15 min). Refresh tokens are opaque: `<sessionId>.<secret>`, only sha256(secret) is stored. */
@Injectable()
export class TokenService {
  constructor(@Inject(KEYS) private readonly keys: JwtKeys) {}

  signAccess(p: { userId: string; companyId: string; sessionId: string }): Promise<string> {
    return new SignJWT({ cid: p.companyId, sid: p.sessionId })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(p.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.keys.privateKey);
  }

  newRefreshSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: sha256Hex(secret) };
  }
}
