import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { statfs } from 'node:fs/promises';
import { Public, SkipPairing } from '../common/decorators';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { SERVER_VERSION } from '../version';

@Injectable()
class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async status() {
    let db: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    const fs = await statfs(this.config.dataDir);
    const diskFreeGb = Math.round((Number(fs.bavail) * Number(fs.bsize)) / 1e9 * 100) / 100;
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      version: SERVER_VERSION,
      time: new Date().toISOString(),
      diskFreeGb,
    };
  }
}

@ApiTags('system')
@Controller()
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Public()
  @SkipPairing()
  @Get('health')
  get() {
    return this.health.status();
  }
}

@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
