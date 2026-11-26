import { Inject, Injectable } from '@nestjs/common';
import { buildInvoiceJournal, Decimal, issue as issueDocument, markSent, type DocStatus } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { Prisma } from '@ddinvoice/db';
import { ApiException } from '../common/api-exception';
import { businessDate, addDays, isoDate } from '../common/business-date';
import { dateOnly, dec } from '../common/dto';
import { SerialQueue } from '../common/serial-queue';
import { withSerializable } from '../common/transactions';
import { nextNumber } from '../common/sequence';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService, type Tx } from '../core/prisma.service';
import { accountMapFor, computeDocument, journalDocLines, resolveLines, type ComputedDocument, type ComputedLine, type ResolvedLine } from '../documents/lines';
import { assertPeriodOpen, postJournal, toPostLines } from '../documents/posting';
import { resolveStoredLines, writeSnapshot } from '../documents/stored';
import type { AuthContext } from '../common/auth-context';
import type { CreateInvoiceInput, ListInvoicesQuery, UpdateInvoiceInput } from './invoices.schemas';

const fxFor = (currency: string, fx: string | undefined): string => {
  if (currency === 'AED') return '1';
  if (!fx) throw ApiException.validation('fxRate is required for foreign-currency invoices', { fxRate: 'required' });
  return fx;
};

const lineRow = (companyId: string, invoiceId: string, lineNo: number, l: ResolvedLine, c: ComputedLine) => ({
  companyId,
  invoiceId,
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

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

/** Response shape. openBalance = total − issued credit notes − allocated receipts. */
function invoiceDto(inv: Omit<InvoiceRow, 'lines'>, credited: Decimal, lines?: InvoiceRow['lines']) {
  const open = new Decimal(inv.total.toString()).minus(credited).minus(inv.amountPaid.toString());
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    settlementStatus: inv.settlementStatus,
    deliveryStatus: inv.deliveryStatus,
    einvoiceStatus: inv.einvoiceStatus,
    customerId: inv.customerId,
    branchId: inv.branchId,
    currency: inv.currency,
    fxRate: dec(inv.fxRate),
    issueDate: dateOnly(inv.issueDate),
    dueDate: dateOnly(inv.dueDate),
    supplyDate: dateOnly(inv.supplyDate),
    subtotal: dec(inv.subtotal),
    discountTotal: dec(inv.discountTotal),
    taxTotal: dec(inv.taxTotal),
    total: dec(inv.total),
    totalAed: dec(inv.totalAed),
    amountPaid: dec(inv.amountPaid),
    openBalance: open.toFixed(4),
    notes: inv.notes,
    terms: inv.terms,
    version: inv.version,
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    snapshotId: inv.snapshotId,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        itemId: l.itemId,
        description: l.description,
        qty: dec(l.qty),
        unitPrice: dec(l.unitPrice),
        discountPct: dec(l.discountPct),
        discountAmt: dec(l.discountAmt),
        taxCodeId: l.taxCodeId,
        accountId: l.accountId,
        net: dec(l.net),
        tax: dec(l.tax),
        gross: dec(l.gross),
      })),
    }),
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(SerialQueue) private readonly queue: SerialQueue,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  async create(auth: AuthContext, body: CreateInvoiceInput) {
    return withSerializable(this.db, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: body.customerId } });
      if (!customer) throw ApiException.notFound('Customer');
      const currency = body.currency.toUpperCase();
      const fxRate = fxFor(currency, body.fxRate);
      const lines = await resolveLines(tx, body.lines);
      const computed = computeDocument(lines, fxRate);
      const today = businessDate();
      const inv = await tx.invoice.create({
        data: {
          companyId: this.config.companyId,
          customerId: customer.id,
          branchId: body.branchId ?? null,
          currency,
          fxRate,
          ...totalsData(computed),
          notes: body.notes,
          terms: body.terms,
          dueDate: addDays(today, customer.paymentTermsDays),
          supplyDate: body.supplyDate ? new Date(`${body.supplyDate}T00:00:00Z`) : null,
        },
      });
      await tx.invoiceLine.createMany({ data: lines.map((l, i) => lineRow(this.config.companyId, inv.id, i + 1, l, computed.lines[i]!)) });
      return this.load(tx, inv.id);
    });
  }

  async update(id: string, body: UpdateInvoiceInput, expectedVersion: number) {
    return withSerializable(this.db, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!inv) throw ApiException.notFound('Invoice');
      if (inv.status !== 'DRAFT') {
        throw ApiException.unprocessable(ErrorCode.ImmutableRecord, 'Issued invoices cannot be edited; issue a credit note');
      }
      if (inv.version !== expectedVersion) {
        throw new ApiException(412, ErrorCode.PreconditionFailed, `Version ${expectedVersion} is stale; current is ${inv.version}`);
      }
      const customerId = body.customerId ?? inv.customerId;
      const customer = await tx.customer.findFirst({ where: { id: customerId } });
      if (!customer) throw ApiException.notFound('Customer');
      const currency = (body.currency ?? inv.currency).toUpperCase();
      const fxRate = fxFor(currency, body.fxRate ?? inv.fxRate.toString());
      const lines = body.lines ? await resolveLines(tx, body.lines) : await resolveStoredLines(tx, inv.lines);
      const computed = computeDocument(lines, fxRate);
      const updated = await tx.invoice.updateMany({
        where: { id, status: 'DRAFT', version: expectedVersion },
        data: {
          customerId,
          branchId: body.branchId !== undefined ? body.branchId : inv.branchId,
          currency,
          fxRate,
          ...totalsData(computed),
          dueDate: addDays(businessDate(), customer.paymentTermsDays),
          supplyDate:
            body.supplyDate !== undefined ? (body.supplyDate ? new Date(`${body.supplyDate}T00:00:00Z`) : null) : inv.supplyDate,
          notes: body.notes ?? inv.notes,
          terms: body.terms ?? inv.terms,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ApiException(412, ErrorCode.PreconditionFailed, 'Version is stale');
      if (body.lines) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLine.createMany({ data: lines.map((l, i) => lineRow(this.config.companyId, id, i + 1, l, computed.lines[i]!)) });
      }
      return this.load(tx, id);
    });
  }

  async remove(id: string) {
    return withSerializable(this.db, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id } });
      if (!inv) throw ApiException.notFound('Invoice');
      if (inv.status !== 'DRAFT') {
        throw ApiException.unprocessable(ErrorCode.ImmutableRecord, 'Issued invoices cannot be deleted; issue a credit note');
      }
      await tx.invoice.deleteMany({ where: { id, status: 'DRAFT' } });
      return { id, deleted: true };
    });
  }

  /** Issue: one SERIALIZABLE transaction, serialized per company in-process. */
  async issue(auth: AuthContext, id: string) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const inv = await tx.invoice.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
        if (!inv) throw ApiException.notFound('Invoice');
        issueDocument(inv.status as DocStatus);
        if (inv.lines.length === 0) throw ApiException.validation('Invoice has no lines', { lines: 'required' });
        const customer = await tx.customer.findFirst({ where: { id: inv.customerId } });
        if (!customer) throw ApiException.notFound('Customer');
        const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: this.config.companyId } });

        const today = businessDate();
        await assertPeriodOpen(tx, today);
        const number = await nextNumber(tx, this.config.companyId, 'INV', today);
        const resolved = await resolveStoredLines(tx, inv.lines);
        const fxRate = fxFor(inv.currency, inv.fxRate.toString());
        const computed = computeDocument(resolved, fxRate);

        for (const [i, row] of inv.lines.entries()) {
          const c = computed.lines[i]!;
          await tx.invoiceLine.update({
            where: { id: row.id },
            data: { net: c.net.toFixed(4), tax: c.tax.toFixed(4), gross: c.gross.toFixed(4) },
          });
        }

        const journal = buildInvoiceJournal(
          { lines: journalDocLines(resolved, computed), fxRate: inv.currency === 'AED' ? undefined : fxRate },
          accountMapFor(customer.receivableAccountId, resolved),
        );
        const posted = await postJournal(tx, this.config.companyId, {
          date: today,
          source: 'INVOICE',
          sourceId: inv.id,
          memo: `Invoice ${number}`,
          lines: toPostLines(journal),
        });

        const dueDate = addDays(today, customer.paymentTermsDays);
        const payload = {
          docType: 'INVOICE',
          number,
          issueDate: isoDate(today),
          dueDate: isoDate(dueDate),
          customerId: inv.customerId,
          currency: inv.currency,
          fxRate,
          journalNumber: posted.number,
          lines: resolved.map((l, i) => ({
            lineNo: i + 1,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            taxCode: l.tax.code,
            net: computed.lines[i]!.net.toFixed(4),
            tax: computed.lines[i]!.tax.toFixed(4),
            gross: computed.lines[i]!.gross.toFixed(4),
            accountId: l.accountId,
          })),
          totals: totalsData(computed),
        };
        const snapshotId = await writeSnapshot(tx, this.config.companyId, 'INVOICE', inv.id, payload);

        const einvoiceApplies = company.einvoiceEnabled && (!company.einvoiceFrom || today >= company.einvoiceFrom);
        const einvoiceStatus = einvoiceApplies ? 'PENDING' : 'NOT_REQUIRED';
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            number,
            status: issueDocument(inv.status as DocStatus),
            issueDate: today,
            issuedAt: new Date(),
            issuedById: auth.userId,
            dueDate,
            ...totalsData(computed),
            snapshotId,
            einvoiceStatus,
            settlementStatus: 'UNPAID',
            version: { increment: 1 },
          },
        });

        await tx.outbox.create({ data: { companyId: this.config.companyId, topic: 'document.render', payload: { docType: 'INVOICE', docId: inv.id, snapshotId } } });
        if (einvoiceApplies) {
          await tx.outbox.create({ data: { companyId: this.config.companyId, topic: 'einvoice.submit', payload: { docType: 'INVOICE', docId: inv.id, snapshotId } } });
        }
        return this.load(tx, inv.id);
      }),
    );
  }

  async markSent(id: string) {
    return withSerializable(this.db, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id } });
      if (!inv) throw ApiException.notFound('Invoice');
      if (inv.status !== 'ISSUED') throw ApiException.unprocessable(ErrorCode.IllegalTransition, 'Only issued invoices can be sent');
      await tx.invoice.update({ where: { id }, data: { deliveryStatus: markSent() } });
      return this.load(tx, id);
    });
  }

  async get(id: string) {
    return this.load(this.db, id);
  }

  async list(q: ListInvoicesQuery) {
    const db = this.db;
    const where: Prisma.InvoiceWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.settlement) where.settlementStatus = q.settlement;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.issueDate = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00Z`) }),
        ...(q.to && { lte: new Date(`${q.to}T00:00:00Z`) }),
      };
    }
    if (q.q) {
      const customers = await db.customer.findMany({
        where: { OR: [{ nameEn: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] },
        select: { id: true },
      });
      const ids = customers.map((c) => c.id);
      where.OR = [
        { number: { contains: q.q, mode: 'insensitive' } },
        ...(ids.length ? [{ customerId: { in: ids } }] : []),
      ];
    }
    const rows = await db.invoice.findMany({
      where,
      orderBy: [{ [q.sort]: q.dir }, { id: q.dir }],
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const credits = await db.creditNote.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: page.map((r) => r.id) }, status: 'ISSUED' },
      _sum: { total: true },
    });
    const creditedById = new Map(credits.map((c) => [c.invoiceId, new Decimal(c._sum.total?.toString() ?? 0)]));
    return {
      items: page.map((r) => invoiceDto(r, creditedById.get(r.id) ?? new Decimal(0))),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  private async load(tx: Tx, id: string) {
    const inv = await tx.invoice.findFirst({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!inv) throw ApiException.notFound('Invoice');
    const agg = await tx.creditNote.aggregate({ where: { invoiceId: id, status: 'ISSUED' }, _sum: { total: true } });
    const { lines, ...head } = inv;
    return invoiceDto(head, new Decimal(agg._sum.total?.toString() ?? 0), lines);
  }

}
