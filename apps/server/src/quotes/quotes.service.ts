import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import { addDays, businessDate } from '../common/business-date';
import { dateOnly, dec } from '../common/dto';
import { SerialQueue } from '../common/serial-queue';
import { withSerializable } from '../common/transactions';
import { nextNumber } from '../common/sequence';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService, type Db, type Tx } from '../core/prisma.service';
import { computeDocument, resolveLines, type ComputedLine, type ResolvedLine } from '../documents/lines';
import { resolveStoredLines } from '../documents/stored';
import type { CreateQuoteInput, UpdateQuoteInput } from './quotes.schemas';

const fxFor = (currency: string, fx: string | undefined): string => {
  if (currency === 'AED') return '1';
  if (!fx) throw ApiException.validation('fxRate is required for foreign-currency quotes', { fxRate: 'required' });
  return fx;
};

const lineRow = (companyId: string, quoteId: string, lineNo: number, l: ResolvedLine, c: ComputedLine) => ({
  companyId,
  quoteId,
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

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(SerialQueue) private readonly queue: SerialQueue,
  ) {}

  private get db(): Db {
    return this.prisma.scoped(this.config.companyId);
  }

  async create(body: CreateQuoteInput) {
    return withSerializable(this.db, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: body.customerId } });
      if (!customer) throw ApiException.notFound('Customer');
      const currency = body.currency.toUpperCase();
      const fxRate = fxFor(currency, body.fxRate);
      const lines = await resolveLines(tx, body.lines);
      const computed = computeDocument(lines, fxRate);
      const q = await tx.quote.create({
        data: {
          companyId: this.config.companyId,
          customerId: customer.id,
          currency,
          fxRate,
          validUntil: body.validUntil ? new Date(`${body.validUntil}T00:00:00Z`) : null,
          notes: body.notes,
          terms: body.terms,
          subtotal: computed.subtotal.toFixed(4),
          discountTotal: computed.discountTotal.toFixed(4),
          taxTotal: computed.taxTotal.toFixed(4),
          total: computed.total.toFixed(4),
        },
      });
      await tx.quoteLine.createMany({ data: lines.map((l, i) => lineRow(this.config.companyId, q.id, i + 1, l, computed.lines[i]!)) });
      return this.load(tx, q.id);
    });
  }

  /** Draft-only edit. Sent quotes change through revise(). */
  async update(id: string, body: UpdateQuoteInput) {
    return withSerializable(this.db, async (tx) => {
      const q = await tx.quote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!q) throw ApiException.notFound('Quote');
      if (q.status !== 'DRAFT') throw ApiException.unprocessable(ErrorCode.IllegalTransition, 'Only draft quotes can be edited; revise instead');
      const currency = (body.currency ?? q.currency).toUpperCase();
      const fxRate = fxFor(currency, body.fxRate ?? q.fxRate.toString());
      const lines = body.lines ? await resolveLines(tx, body.lines) : await resolveStoredLines(tx, q.lines);
      const computed = computeDocument(lines, fxRate);
      await tx.quote.update({
        where: { id },
        data: {
          customerId: body.customerId ?? q.customerId,
          currency,
          fxRate,
          validUntil: body.validUntil !== undefined ? (body.validUntil ? new Date(`${body.validUntil}T00:00:00Z`) : null) : q.validUntil,
          notes: body.notes ?? q.notes,
          terms: body.terms ?? q.terms,
          subtotal: computed.subtotal.toFixed(4),
          discountTotal: computed.discountTotal.toFixed(4),
          taxTotal: computed.taxTotal.toFixed(4),
          total: computed.total.toFixed(4),
        },
      });
      if (body.lines) {
        await tx.quoteLine.deleteMany({ where: { quoteId: id } });
        await tx.quoteLine.createMany({ data: lines.map((l, i) => lineRow(this.config.companyId, id, i + 1, l, computed.lines[i]!)) });
      }
      return this.load(tx, id);
    });
  }

  /** DRAFT → SENT. Assigns the quote number on first send. */
  async send(id: string) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const q = await tx.quote.findFirst({ where: { id } });
        if (!q) throw ApiException.notFound('Quote');
        if (q.status !== 'DRAFT') throw ApiException.unprocessable(ErrorCode.IllegalTransition, `Cannot send a ${q.status.toLowerCase()} quote`);
        const today = businessDate();
        const number = q.number ?? (await nextNumber(tx, this.config.companyId, 'QT', today));
        await tx.quote.update({
          where: { id },
          data: {
            number,
            status: 'SENT',
            issueDate: q.issueDate ?? today,
            validUntil: q.validUntil ?? addDays(today, 30),
          },
        });
        return this.load(tx, id);
      }),
    );
  }

  /** New DRAFT revision (revision + 1, same number) of a sent, rejected or expired quote. */
  async revise(id: string) {
    return withSerializable(this.db, async (tx) => {
      const q = await tx.quote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!q) throw ApiException.notFound('Quote');
      if (!['SENT', 'REJECTED', 'EXPIRED'].includes(q.status)) {
        throw ApiException.unprocessable(ErrorCode.IllegalTransition, `Cannot revise a ${q.status.toLowerCase()} quote`);
      }
      const rev = await tx.quote.create({
        data: {
          companyId: this.config.companyId,
          number: q.number,
          revision: q.revision + 1,
          status: 'DRAFT',
          customerId: q.customerId,
          issueDate: q.issueDate,
          validUntil: q.validUntil,
          currency: q.currency,
          fxRate: q.fxRate.toString(),
          subtotal: q.subtotal.toString(),
          discountTotal: q.discountTotal.toString(),
          taxTotal: q.taxTotal.toString(),
          total: q.total.toString(),
          notes: q.notes,
          terms: q.terms,
        },
      });
      await tx.quoteLine.createMany({
        data: q.lines.map((l) => ({
          companyId: this.config.companyId,
          quoteId: rev.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
          discountPct: l.discountPct.toString(),
          discountAmt: l.discountAmt.toString(),
          taxCodeId: l.taxCodeId,
          net: l.net.toString(),
          tax: l.tax.toString(),
          gross: l.gross.toString(),
          accountId: l.accountId,
        })),
      });
      return this.load(tx, rev.id);
    });
  }

  /** SENT → ACCEPTED, then a DRAFT invoice is created from the quote lines (issue it separately). */
  async accept(id: string) {
    return withSerializable(this.db, async (tx) => {
      const q = await tx.quote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!q) throw ApiException.notFound('Quote');
      if (q.status !== 'SENT') throw ApiException.unprocessable(ErrorCode.IllegalTransition, 'Only sent quotes can be accepted');
      const customer = await tx.customer.findFirstOrThrow({ where: { id: q.customerId } });
      const lines = await resolveStoredLines(tx, q.lines);
      const fxRate = q.currency === 'AED' ? '1' : q.fxRate.toString();
      const computed = computeDocument(lines, fxRate);
      const today = businessDate();
      const inv = await tx.invoice.create({
        data: {
          companyId: this.config.companyId,
          customerId: q.customerId,
          currency: q.currency,
          fxRate,
          subtotal: computed.subtotal.toFixed(4),
          discountTotal: computed.discountTotal.toFixed(4),
          taxTotal: computed.taxTotal.toFixed(4),
          total: computed.total.toFixed(4),
          totalAed: computed.totalAed.toFixed(4),
          notes: q.notes,
          terms: q.terms,
          dueDate: addDays(today, customer.paymentTermsDays),
        },
      });
      await tx.invoiceLine.createMany({
        data: lines.map((l, i) => ({
          companyId: this.config.companyId,
          invoiceId: inv.id,
          lineNo: i + 1,
          itemId: l.itemId,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          discountAmt: l.discountAmt,
          taxCodeId: l.tax.id,
          net: computed.lines[i]!.net.toFixed(4),
          tax: computed.lines[i]!.tax.toFixed(4),
          gross: computed.lines[i]!.gross.toFixed(4),
          accountId: l.accountId,
        })),
      });
      await tx.quote.update({ where: { id }, data: { status: 'ACCEPTED' } });
      return { quote: await this.load(tx, id), invoiceId: inv.id };
    });
  }

  async get(id: string) {
    return this.load(this.db, id);
  }

  async list(status?: string) {
    const rows = await this.db.quote.findMany({
      where: status ? { status: status as 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => quoteDto(r));
  }

  private async load(tx: Tx | Db, id: string) {
    const q = await tx.quote.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!q) throw ApiException.notFound('Quote');
    const { lines, ...head } = q;
    return quoteDto(head, lines);
  }
}

// Shape kept loose: only the fields the response exposes.
function quoteDto(
  q: {
    id: string; number: string | null; revision: number; status: string; customerId: string;
    issueDate: Date | null; validUntil: Date | null; currency: string; fxRate: { toString(): string };
    subtotal: { toString(): string }; discountTotal: { toString(): string }; taxTotal: { toString(): string };
    total: { toString(): string }; notes: string; terms: string;
  },
  lines?: {
    id: string; lineNo: number; description: string; qty: { toString(): string }; unitPrice: { toString(): string };
    net: { toString(): string }; tax: { toString(): string }; gross: { toString(): string }; taxCodeId: string; accountId: string;
  }[],
) {
  return {
    id: q.id,
    number: q.number,
    revision: q.revision,
    status: q.status,
    customerId: q.customerId,
    issueDate: dateOnly(q.issueDate),
    validUntil: dateOnly(q.validUntil),
    currency: q.currency,
    fxRate: dec(q.fxRate),
    subtotal: dec(q.subtotal),
    discountTotal: dec(q.discountTotal),
    taxTotal: dec(q.taxTotal),
    total: dec(q.total),
    notes: q.notes,
    terms: q.terms,
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
