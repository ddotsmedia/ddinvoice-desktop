import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { SKIP_PAIRING } from '../common/decorators';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';

/** Rejects every route except @SkipPairing ones unless X-Device-Id is a paired, non-revoked Device. */
@Injectable()
export class PairingGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.config.requirePairing) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_PAIRING, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const id = req.headers['x-device-id'];
    const device = id
      ? await this.prisma.scoped(this.config.companyId).device.findFirst({ where: { fingerprint: id, revokedAt: null } })
      : null;
    if (!device) throw new ApiException(403, 'DEVICE_NOT_PAIRED', 'This device is not paired with the server');
    return true;
  }
}
