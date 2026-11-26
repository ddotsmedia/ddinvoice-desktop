import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify, type CryptoKey } from 'jose';
import type { Permission } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import type { AuthContext } from '../common/auth-context';
import { IS_PUBLIC, PERMS } from '../common/decorators';
import { CONFIG, KEYS } from '../core/tokens';
import type { JwtKeys } from '../core/keys';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { JWT_AUDIENCE, JWT_ISSUER } from './token.service';

type RequestWithAuth = { headers: Record<string, string | undefined>; ip?: string; auth?: AuthContext };

/** Verifies the EdDSA access token, then checks the session is live and the user active. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(KEYS) private readonly keys: JwtKeys,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ApiException(401, 'UNAUTHORIZED', 'Missing bearer token');

    let payload: { sub?: string; sid?: string; cid?: string };
    try {
      ({ payload } = await jwtVerify(token, this.keys.publicKey as CryptoKey, {
        algorithms: ['EdDSA'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }));
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    if (!payload.sub || !payload.sid || payload.cid !== this.config.companyId) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid token');
    }

    const user = await this.prisma.scoped(this.config.companyId).user.findFirst({
      where: {
        id: payload.sub,
        isActive: true,
        sessions: { some: { id: payload.sid, revokedAt: null, expiresAt: { gt: new Date() } } },
      },
      include: { roles: { include: { role: { select: { permissions: true } } } } },
    });
    if (!user) throw new ApiException(401, 'UNAUTHORIZED', 'Session is no longer valid');

    const permissions = new Set(user.roles.flatMap((r) => r.role.permissions));
    req.auth = {
      userId: user.id,
      companyId: this.config.companyId,
      sessionId: payload.sid,
      permissions,
      ip: req.ip ?? '',
      userAgent: req.headers['user-agent'] ?? '',
    };
    return true;
  }
}

/** Every permission listed on the route must be held by the caller's roles. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMS, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    const held = req.auth?.permissions;
    if (!held || required.some((p) => !held.has(p))) throw ApiException.forbidden();
    return true;
  }
}
