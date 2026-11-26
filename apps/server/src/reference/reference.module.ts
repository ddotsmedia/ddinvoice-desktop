import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Perm } from '../common/decorators';
import { dec } from '../common/dto';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';

@Injectable()
class ReferenceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  accounts() {
    return this.db.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true, type: true, isControl: true },
    });
  }

  async taxCodes() {
    const rows = await this.db.taxCode.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    return rows.map((t) => ({ ...t, rate: dec(t.rate) }));
  }
}

@ApiTags('reference')
@Controller()
class ReferenceController {
  constructor(@Inject(ReferenceService) private readonly ref: ReferenceService) {}

  @Perm('account.read')
  @Get('accounts')
  accounts() {
    return this.ref.accounts();
  }

  @Perm('taxcode.read')
  @Get('tax-codes')
  taxCodes() {
    return this.ref.taxCodes();
  }
}

@Module({ controllers: [ReferenceController], providers: [ReferenceService] })
export class ReferenceModule {}
