import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { ApiException } from '../common/api-exception';
import { dec } from '../common/dto';
import type { CreateCustomerInput } from './customers.schemas';

const dto = (c: {
  id: string; code: string; nameEn: string; nameAr: string; trn: string | null; email: string; phone: string;
  addressEn: string; addressAr: string; emirate: string | null; country: string; currency: string;
  paymentTermsDays: number; creditLimit: { toString(): string } | null; receivableAccountId: string;
}) => ({ ...c, creditLimit: dec(c.creditLimit) });

@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  async create(input: CreateCustomerInput) {
    const acc = await this.db.account.findFirst({ where: { id: input.receivableAccountId, isActive: true } });
    if (!acc) throw ApiException.unprocessable('UNKNOWN_ACCOUNT', 'Receivable account not found');
    return dto(await this.db.customer.create({ data: { ...input, companyId: this.config.companyId } }));
  }

  async list(q: string | undefined, limit: number) {
    const rows = await this.db.customer.findMany({
      where: q ? { OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(dto);
  }

  async get(id: string) {
    const c = await this.db.customer.findFirst({ where: { id } });
    if (!c) throw ApiException.notFound('Customer');
    return dto(c);
  }
}
