import { Body, Controller, Get, Inject, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Decimal } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import { businessDate } from '../common/business-date';
import { dateOnly, dec } from '../common/dto';
import { Perm, ZodBody } from '../common/decorators';
import { SerialQueue } from '../common/serial-queue';
import { withSerializable } from '../common/transactions';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService, type Db, type Tx } from '../core/prisma.service';
import { postJournal } from '../documents/posting';
import { ZodPipe } from '../common/zod.pipe';
import { CreateJournalSchema, type CreateJournalInput } from './journals.schemas';

@Injectable()
class JournalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(SerialQueue) private readonly queue: SerialQueue,
  ) {}

  private get db(): Db {
    return this.prisma.scoped(this.config.companyId);
  }

  /** Manual journal: balanced, posted immediately (the journal table has no draft state yet). */
  async post(body: CreateJournalInput) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const accountIds = [...new Set(body.lines.map((l) => l.accountId))];
        const found = await tx.account.findMany({ where: { id: { in: accountIds }, isActive: true }, select: { id: true } });
        if (found.length !== accountIds.length) throw ApiException.unprocessable('UNKNOWN_ACCOUNT', 'Unknown or inactive account');
        const journal = await postJournal(tx, this.config.companyId, {
          date: new Date(`${body.date}T00:00:00Z`),
          source: 'MANUAL',
          sourceId: null,
          memo: body.memo,
          lines: body.lines.map((l) => ({
            accountId: l.accountId,
            debit: new Decimal(l.debit),
            credit: new Decimal(l.credit),
            description: l.description,
          })),
        });
        return this.load(tx, journal.id);
      }),
    );
  }

  /** Reversal journal (swapped Dr/Cr). A journal can be reversed once. */
  async reverse(id: string) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const original = await tx.journal.findFirst({ where: { id }, include: { lines: true } });
        if (!original) throw ApiException.notFound('Journal');
        const existing = await tx.journal.findFirst({ where: { reversalOfId: id } });
        if (existing) throw ApiException.conflict(ErrorCode.Conflict, 'Journal is already reversed');
        const reversal = await postJournal(tx, this.config.companyId, {
          date: businessDate(),
          source: 'REVERSAL',
          sourceId: original.id,
          memo: `Reversal of ${original.number}`,
          reversalOfId: original.id,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debit: new Decimal(l.credit.toString()),
            credit: new Decimal(l.debit.toString()),
            description: l.description,
          })),
        });
        return this.load(tx, reversal.id);
      }),
    );
  }

  async get(id: string) {
    return this.load(this.db, id);
  }

  private async load(tx: Tx | Db, id: string) {
    const j = await tx.journal.findFirst({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!j) throw ApiException.notFound('Journal');
    return {
      id: j.id,
      number: j.number,
      date: dateOnly(j.date),
      source: j.source,
      sourceId: j.sourceId,
      memo: j.memo,
      reversalOfId: j.reversalOfId,
      postedAt: j.postedAt.toISOString(),
      lines: j.lines.map((l) => ({
        accountId: l.accountId,
        debit: dec(l.debit),
        credit: dec(l.credit),
        description: l.description,
      })),
    };
  }
}

@ApiTags('journals')
@Controller('journals')
class JournalsController {
  constructor(@Inject(JournalsService) private readonly journals: JournalsService) {}

  @Perm('journal.post')
  @ZodBody(CreateJournalSchema)
  @Post()
  post(@Body(new ZodPipe(CreateJournalSchema)) body: CreateJournalInput) {
    return this.journals.post(body);
  }

  @Perm('journal.post')
  @Post(':id/reverse')
  reverse(@Param('id', ParseUUIDPipe) id: string) {
    return this.journals.reverse(id);
  }

  @Perm('journal.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.journals.get(id);
  }
}

@Module({ controllers: [JournalsController], providers: [JournalsService] })
export class JournalsModule {}

