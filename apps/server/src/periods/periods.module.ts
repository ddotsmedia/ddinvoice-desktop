import { Body, Controller, Get, Inject, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Perm, ZodBody } from '../common/decorators';
import { ApiException } from '../common/api-exception';
import { dateOnly, IsoDateString } from '../common/dto';
import { ZodPipe } from '../common/zod.pipe';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';

const CreatePeriodSchema = z.object({ start: IsoDateString, end: IsoDateString });
type CreatePeriodInput = z.infer<typeof CreatePeriodSchema>;

const toDto = (p: { id: string; start: Date; end: Date; status: string }) => ({
  id: p.id,
  start: dateOnly(p.start),
  end: dateOnly(p.end),
  status: p.status,
});

/** Accounting periods. A LOCKED period rejects posting (application check + DB trigger). */
@Injectable()
class PeriodsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  async create(input: CreatePeriodInput) {
    if (input.start > input.end) throw ApiException.validation('start must be on or before end', { end: 'before start' });
    const overlap = await this.db.period.findFirst({
      where: { start: { lte: new Date(`${input.end}T00:00:00Z`) }, end: { gte: new Date(`${input.start}T00:00:00Z`) } },
    });
    if (overlap) throw ApiException.conflict('CONFLICT', 'Period overlaps an existing period');
    const p = await this.db.period.create({
      data: { companyId: this.config.companyId, start: new Date(`${input.start}T00:00:00Z`), end: new Date(`${input.end}T00:00:00Z`) },
    });
    return toDto(p);
  }

  async list() {
    return (await this.db.period.findMany({ orderBy: { start: 'asc' } })).map(toDto);
  }

  async lock(id: string) {
    const p = await this.db.period.findFirst({ where: { id } });
    if (!p) throw ApiException.notFound('Period');
    return toDto(await this.db.period.update({ where: { id }, data: { status: 'LOCKED' } }));
  }
}

@ApiTags('periods')
@Controller('periods')
class PeriodsController {
  constructor(@Inject(PeriodsService) private readonly periods: PeriodsService) {}

  @Perm('period.create')
  @ZodBody(CreatePeriodSchema)
  @Post()
  create(@Body(new ZodPipe(CreatePeriodSchema)) body: CreatePeriodInput) {
    return this.periods.create(body);
  }

  @Perm('period.read')
  @Get()
  list() {
    return this.periods.list();
  }

  @Perm('period.update')
  @Post(':id/lock')
  lock(@Param('id', ParseUUIDPipe) id: string) {
    return this.periods.lock(id);
  }
}

@Module({ controllers: [PeriodsController], providers: [PeriodsService] })
export class PeriodsModule {}
