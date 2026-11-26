import { Body, Controller, Get, Header, Headers, Inject, Injectable, Module, NotFoundException, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { X509Certificate, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiException } from '../common/api-exception';
import { Perm, Public, SkipIdempotency, SkipPairing, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { PairingCodes } from './pairing-codes';

export const PairSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  deviceName: z.string().min(1).max(100),
  fingerprint: z.string().min(8).max(200),
});
type PairInput = z.infer<typeof PairSchema>;

export function caFingerprint(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

@Injectable()
export class PairingService {
  readonly codes = new PairingCodes();
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  caPem(): string {
    if (!this.config.caPath) throw new NotFoundException('No CA configured');
    return readFileSync(this.config.caPath, 'utf8');
  }

  caFingerprint(): string | null {
    return this.config.caPath ? caFingerprint(this.caPem()) : null;
  }

  /** Loopback + local token only: lets the server screen/CLI bootstrap the first device. */
  localCode(token: string | undefined, remote: string | undefined) {
    const expected = this.config.localToken;
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected ?? '');
    if (!expected || !loopback || a.length !== b.length || !timingSafeEqual(a, b)) throw ApiException.forbidden();
    const { code, expiresAt } = this.codes.issue();
    return { code, expiresAt: expiresAt.toISOString(), caFingerprint: this.caFingerprint() };
  }

  async pair(input: PairInput) {
    if (!this.codes.consume(input.code)) throw new ApiException(403, 'PAIRING_CODE_INVALID', 'Pairing code is invalid or expired');
    const db = this.prisma.scoped(this.config.companyId);
    const existing = await db.device.findFirst({ where: { fingerprint: input.fingerprint } });
    if (existing?.revokedAt) throw ApiException.forbidden('Device is revoked');
    const device = existing
      ? await db.device.update({ where: { id: existing.id }, data: { name: input.deviceName } })
      : await db.device.create({
          data: { companyId: this.config.companyId, name: input.deviceName, kind: 'WORKSTATION', fingerprint: input.fingerprint, appVersion: 'unknown' },
        });
    return { deviceId: device.id, caFingerprint: this.caFingerprint() };
  }
}

@ApiTags('pairing')
@Controller('pairing')
class PairingController {
  constructor(@Inject(PairingService) private readonly svc: PairingService) {}

  @Public()
  @SkipPairing()
  @Get('ca')
  @Header('Content-Type', 'application/x-pem-file')
  ca() {
    return this.svc.caPem();
  }

  @Public()
  @SkipPairing()
  @SkipIdempotency()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ZodBody(PairSchema)
  @Post()
  pair(@Body(new ZodPipe(PairSchema)) body: PairInput) {
    return this.svc.pair(body);
  }

  @Public()
  @SkipPairing()
  @SkipIdempotency()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('local-code')
  localCode(@Headers('x-local-token') token: string | undefined, @Req() req: { socket: { remoteAddress?: string } }) {
    return this.svc.localCode(token, req.socket.remoteAddress);
  }

  /** Paired admin device: shows the code and the CA fingerprint. */
  @Perm('device.create')
  @Post('code')
  issue() {
    const { code, expiresAt } = this.svc.codes.issue();
    return { code, expiresAt: expiresAt.toISOString(), caFingerprint: this.svc.caFingerprint() };
  }
}

@Module({ controllers: [PairingController], providers: [PairingService], exports: [PairingService] })
export class PairingModule {}
