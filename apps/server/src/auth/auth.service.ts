import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { verify as verifyPassword } from 'argon2';
import { verify as verifyTotp } from 'otplib';
import { ErrorCode } from '@ddinvoice/contracts';
import { sha256Hex } from '../common/canonical';
import { ApiException } from '../common/api-exception';
import type { Permission } from '@ddinvoice/contracts';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_MS, TokenService } from './token.service';
import type { LoginInput } from './auth.schemas';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionMeta {
  ip: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  async login(input: LoginInput, meta: SessionMeta) {
    const db = this.db;
    const now = new Date();
    const user = await db.user.findFirst({ where: { email: input.email.trim().toLowerCase() } });
    if (!user || !user.isActive) throw invalidCredentials();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new ApiException(423, ErrorCode.AccountLocked, 'Account is locked; try again later');
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.recordFailure(user.id, user.failedLogins);
      throw invalidCredentials();
    }
    if (user.mfaSecret) {
      if (!input.totp) throw new ApiException(401, ErrorCode.MfaRequired, 'Two-factor code required');
      const { valid } = await verifyTotp({ secret: user.mfaSecret, token: input.totp });
      if (!valid) {
        await this.recordFailure(user.id, user.failedLogins);
        throw invalidCredentials();
      }
    }

    const device = await db.device.upsert({
      where: { companyId_fingerprint: { companyId: this.config.companyId, fingerprint: input.deviceId } },
      create: {
        companyId: this.config.companyId,
        name: `Device ${input.deviceId.slice(0, 8)}`,
        kind: 'WORKSTATION',
        fingerprint: input.deviceId,
        appVersion: input.appVersion ?? 'unknown',
        lastSeenAt: now,
      },
      update: { lastSeenAt: now, appVersion: input.appVersion ?? 'unknown' },
    });
    if (device.revokedAt) throw ApiException.forbidden('Device is revoked');

    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });

    const sessionId = randomUUID();
    const { secret, hash } = this.tokens.newRefreshSecret();
    await db.session.create({
      data: {
        companyId: this.config.companyId,
        id: sessionId,
        userId: user.id,
        deviceId: device.id,
        refreshTokenHash: hash,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return this.issue(user.id, sessionId, secret);
  }

  /** Rotates the refresh token. Presenting an old secret revokes the whole session (reuse detection). */
  async refresh(refreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    const db = this.db;
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret) throw unauthorized();
    const now = new Date();
    const session = await db.session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: now } },
      include: { user: { select: { isActive: true } } },
    });
    if (!session || !session.user.isActive) throw unauthorized();

    if (session.refreshTokenHash !== sha256Hex(secret)) {
      await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
      throw unauthorized('Refresh token reuse detected; session revoked');
    }

    const next = this.tokens.newRefreshSecret();
    const rotated = await db.session.updateMany({
      where: { id: sessionId, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      data: { refreshTokenHash: next.hash, ip: meta.ip, userAgent: meta.userAgent },
    });
    if (rotated.count !== 1) throw unauthorized();
    return this.issue(session.userId, sessionId, next.secret);
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Live sessions (not revoked, not expired) with user and device. Read by admins; `activeCount` is the seat counter for Prompt 8. */
  async listSessions(currentSessionId: string) {
    const now = new Date();
    const rows = await this.db.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, nameEn: true } }, device: { select: { name: true, kind: true, lastSeenAt: true } } },
    });
    return {
      activeCount: rows.length,
      sessions: rows.map((s) => ({
        id: s.id,
        current: s.id === currentSessionId,
        userEmail: s.user.email,
        userName: s.user.nameEn,
        deviceName: s.device.name,
        deviceKind: s.device.kind,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.device.lastSeenAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(),
      })),
    };
  }

  /** Number of live sessions in this company (license seat counter; enforced in Prompt 8). */
  async countActiveSessions(): Promise<number> {
    return this.db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
  }

  async revokeSession(sessionId: string): Promise<number> {
    const res = await this.db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw ApiException.notFound('Session');
    return res.count;
  }

  async me(userId: string, permissions: ReadonlySet<string>) {
    const user = await this.db.user.findFirst({ where: { id: userId } });
    if (!user) throw ApiException.notFound('User');
    return {
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      nameEn: user.nameEn,
      nameAr: user.nameAr,
      locale: user.locale,
      permissions: [...permissions].sort() as Permission[],
    };
  }

  private async issue(userId: string, sessionId: string, secret: string): Promise<TokenPair> {
    const accessToken = await this.tokens.signAccess({ userId, companyId: this.config.companyId, sessionId });
    return { accessToken, refreshToken: `${sessionId}.${secret}`, expiresIn: ACCESS_TTL_SECONDS };
  }

  private async recordFailure(userId: string, failedLogins: number): Promise<void> {
    const count = failedLogins + 1;
    const lock = count >= MAX_FAILED_LOGINS;
    await this.db.user.update({
      where: { id: userId },
      data: lock
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
        : { failedLogins: count },
    });
  }
}

const invalidCredentials = () => new ApiException(401, ErrorCode.InvalidCredentials, 'Invalid email or password');
const unauthorized = (message = 'Invalid or expired session') => new ApiException(401, ErrorCode.Unauthorized, message);
