import { Inject, Injectable } from '@nestjs/common';
import { buildCreditNoteJournal, Decimal, issue as issueDocument, type DocStatus } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import { businessDate, isoDate } from '../common/business-date';
import { dateOnly, dec } from '../common/dto';
import { SerialQueue } from '../common/serial-queue';
import { withSerializable } from '../common/transactions';
import { nextNumber } from '../common/sequence';
import type { AuthContext } from '../common/auth-context';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService, type Db, type Tx } from '../core/prisma.service';
import { accountMapFor, computeDocument, journalDocLines, resolveLines, type ComputedDocument, type ComputedLine, type ResolvedLine } from '../documents/lines';
import { assertPeriodOpen, postJournal, toPostLines } from '../documents/posting';
import { buyerParty, enqueueRenders, refreshSettlement, resolveStoredLines, sellerParty, snapshotLines, writeSnapshot } from '../documents/stored';
import type { CreateCreditNoteInput } from './credit-notes.schemas';

const lineRow = (companyId: string, creditNoteId: string, lineNo: number, l: ResolvedLine, c: ComputedLine) => ({
  companyId,
  creditNoteId,
  lineNo,
  itemId: l.itemId,
  description: l.description,
  qty: l.qty,
  unitPrice: l.unitPrice,
  discountPct: l.discountPct,
  discountAmt: l.discountAmt,
  taxCodeId: l.tax.id,
  net: c.net.toFixed(4),
  tax: c.tax.toFixed(4),
  gross: c.gross.toFixed(4),
  accountId: l.accountId,
});

const totalsData = (c: ComputedDocument) => ({
  subtotal: c.subtotal.toFixed(4),
  discountTotal: c.discountTotal.toFixed(4),
  taxTotal: c.taxTotal.toFixed(4),
  total: c.total.toFixed(4),
  totalAed: c.totalAed.toFixed(4),
});

@Injectable()
export class CreditNotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(SerialQueue) private readonly queue: SerialQueue,
  ) {}

  private get db(): Db {
    return this.prisma.scoped(this.config.companyId);
  }

  /** Draft against an ISSUED invoice; the invoice's currency and rate are inherited. */
  async create(body: CreateCreditNoteInput) {
    return withSerializable(this.db, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id: body.invoiceId } });
      if (!inv) throw ApiException.notFound('Invoice');
      if (inv.status !== 'ISSUED') {
        throw ApiException.unprocessable(ErrorCode.IllegalTransition, 'A credit note needs an issued invoice');
      }
      const lines = await resolveLines(tx, body.lines);
      const fxRate = inv.fxRate.toString();
      const computed = computeDocument(lines, inv.currency === 'AED' ? '1' : fxRate);
      const cn = await tx.creditNote.create({
        data: {
          companyId: this.config.companyId,
          invoiceId: inv.id,
          customerId: inv.customerId,
          reason: body.reason,
          currency: inv.currency,
          fxRate,
          ...totalsData(computed),
        },
      });
      await tx.creditNoteLine.createMany({ data: lines.map((l, i) => lineRow(this.config.companyId, cn.id, i + 1, l, computed.lines[i]!)) });
      return this.load(tx, cn.id);
    });
  }

  /** Issue: same pattern as invoices; reduces the invoice's open balance via refreshSettlement. */
  async issue(auth: AuthContext, id: string) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const cn = await tx.creditNote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
        if (!cn) throw ApiException.notFound('Credit note');
        issueDocument(cn.status as DocStatus);
        const inv = await tx.invoice.findFirstOrThrow({ where: { id: cn.invoiceId } });
        const customer = await tx.customer.findFirstOrThrow({ where: { id: cn.customerId } });
        const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: this.config.companyId } });

        const credited = await tx.creditNote.aggregate({ where: { invoiceId: inv.id, status: 'ISSUED' }, _sum: { total: true } });
        const alreadyCredited = new Decimal(credited._sum.total?.toString() ?? 0);
        const resolved = await resolveStoredLines(tx, cn.lines);
        const fxRate = cn.fxRate.toString();
        const computed = computeDocument(resolved, cn.currency === 'AED' ? '1' : fxRate);
        if (alreadyCredited.plus(computed.total).gt(inv.total.toString())) {
          throw ApiException.unprocessable('OVER_CREDIT', 'Credit notes would exceed the invoice total');
        }

        const today = businessDate();
        await assertPeriodOpen(tx, today);
        const number = await nextNumber(tx, this.config.companyId, 'CN', today);
        for (const [i, row] of cn.lines.entries()) {
          const c = computed.lines[i]!;
          await tx.creditNoteLine.update({
            where: { id: row.id },
            data: { net: c.net.toFixed(4), tax: c.tax.toFixed(4), gross: c.gross.toFixed(4) },
          });
        }

        const journal = buildCreditNoteJournal(
          { lines: journalDocLines(resolved, computed), fxRate: cn.currency === 'AED' ? undefined : fxRate },
          accountMapFor(customer.receivableAccountId, resolved),
        );
        const posted = await postJournal(tx, this.config.companyId, {
          date: today,
          source: 'CREDIT_NOTE',
          sourceId: cn.id,
          memo: `Credit note ${number}`,
          lines: toPostLines(journal),
        });

        const payload = {
          docType: 'CREDIT_NOTE',
          number,
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          issueDate: isoDate(today),
          reason: cn.reason,
          customerId: cn.customerId,
          currency: cn.currency,
          fxRate,
          seller: sellerParty(company),
          buyer: buyerParty(customer),
          journalNumber: posted.number,
          lines: snapshotLines(resolved, computed.lines),
          totals: totalsData(computed),
        };
        const snapshotId = await writeSnapshot(tx, this.config.companyId, 'CREDIT_NOTE', cn.id, payload);
        await tx.creditNote.update({
          where: { id: cn.id },
          data: {
            number,
            status: issueDocument(cn.status as DocStatus),
            issueDate: today,
            issuedAt: new Date(),
            issuedById: auth.userId,
            ...totalsData(computed),
            snapshotId,
            version: { increment: 1 },
          },
        });
        await refreshSettlement(tx, inv.id);
        await enqueueRenders(tx, this.config.companyId, 'CREDIT_NOTE', cn.id, snapshotId);
        return this.load(tx, cn.id);
      }),
    );
  }

  async get(id: string) {
    return this.load(this.db, id);
  }

  async list(invoiceId?: string) {
    const rows = await this.db.creditNote.findMany({
      where: invoiceId ? { invoiceId } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => dto(r));
  }

  private async load(tx: Tx, id: string) {
    const cn = await tx.creditNote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!cn) throw ApiException.notFound('Credit note');
    const { lines, ...head } = cn;
    return dto(head, lines);
  }
}

function dto(
  cn: {
    id: string; number: string | null; invoiceId: string; customerId: string; reason: string; status: string;
    settlementStatus: string; currency: string; fxRate: { toString(): string }; issueDate: Date | null;
    subtotal: { toString(): string }; discountTotal: { toString(): string }; taxTotal: { toString(): string };
    total: { toString(): string }; totalAed: { toString(): string }; version: number; issuedAt: Date | null; snapshotId: string | null;
  },
  lines?: {
    id: string; lineNo: number; description: string; qty: { toString(): string }; unitPrice: { toString(): string };
    taxCodeId: string; accountId: string; net: { toString(): string }; tax: { toString(): string }; gross: { toString(): string };
  }[],
) {
  return {
    id: cn.id,
    number: cn.number,
    invoiceId: cn.invoiceId,
    customerId: cn.customerId,
    reason: cn.reason,
    status: cn.status,
    settlementStatus: cn.settlementStatus,
    currency: cn.currency,
    fxRate: dec(cn.fxRate),
    issueDate: dateOnly(cn.issueDate),
    subtotal: dec(cn.subtotal),
    discountTotal: dec(cn.discountTotal),
    taxTotal: dec(cn.taxTotal),
    total: dec(cn.total),
    totalAed: dec(cn.totalAed),
    version: cn.version,
    issuedAt: cn.issuedAt?.toISOString() ?? null,
    snapshotId: cn.snapshotId,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        qty: dec(l.qty),
        unitPrice: dec(l.unitPrice),
        taxCodeId: l.taxCodeId,
        accountId: l.accountId,
        net: dec(l.net),
        tax: dec(l.tax),
        gross: dec(l.gross),
      })),
    }),
  };
}
