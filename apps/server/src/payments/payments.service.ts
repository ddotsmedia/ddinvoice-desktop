import { Inject, Injectable } from '@nestjs/common';
import { allocate, buildReceiptJournal, Decimal, type OpenInvoice } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import { businessDate, isoDate } from '../common/business-date';
import { dateOnly, dec } from '../common/dto';
import { SerialQueue } from '../common/serial-queue';
import { withSerializable } from '../common/transactions';
import { nextNumber } from '../common/sequence';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService, type Db, type Tx } from '../core/prisma.service';
import { postJournal, toPostLines } from '../documents/posting';
import { refreshSettlement } from '../documents/stored';
import type { AllocateInput, CreatePaymentInput } from './payments.schemas';

const EMPTY_MAP = { ar: '', vatOutput: '', vatInputRc: '', vatOutputRc: '', bank: '' };

interface PaymentDto {
  id: string;
  number: string;
  customerId: string;
  date: string | null;
  method: string;
  bankAccountId: string;
  amount: string | null;
  currency: string;
  fxRate: string | null;
  unallocated: string | null;
  reference: string;
  allocations: { invoiceId: string | null; amount: string | null; date: string | null }[];
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(SerialQueue) private readonly queue: SerialQueue,
  ) {}

  private get db(): Db {
    return this.prisma.scoped(this.config.companyId);
  }

  /** Receipt: Dr bank / Cr AR for the full amount; allocations (if any) are applied in the same transaction. */
  async create(body: CreatePaymentInput) {
    if (body.currency.toUpperCase() !== 'AED') {
      throw ApiException.unprocessable('CURRENCY_NOT_SUPPORTED', 'Payments are AED-only in this version');
    }
    const amount = new Decimal(body.amount);
    if (!amount.gt(0)) throw ApiException.validation('amount must be greater than zero', { amount: 'must be > 0' });
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: body.customerId } });
        if (!customer) throw ApiException.notFound('Customer');
        const bank = await tx.account.findFirst({ where: { id: body.bankAccountId, isActive: true } });
        if (!bank) throw ApiException.unprocessable('UNKNOWN_ACCOUNT', 'Bank account not found');
        const date = new Date(`${body.date}T00:00:00Z`);
        const number = await nextNumber(tx, this.config.companyId, 'RCT', date);
        const payment = await tx.payment.create({
          data: {
            companyId: this.config.companyId,
            number,
            customerId: customer.id,
            date,
            method: body.method,
            bankAccountId: bank.id,
            amount: amount.toFixed(4),
            currency: 'AED',
            fxRate: '1',
            unallocated: amount.toFixed(4),
            reference: body.reference,
          },
        });
        const receipt = buildReceiptJournal(amount, { ...EMPTY_MAP, ar: customer.receivableAccountId, bank: bank.id });
        await postJournal(tx, this.config.companyId, {
          date,
          source: 'PAYMENT',
          sourceId: payment.id,
          memo: `Receipt ${number}`,
          lines: toPostLines(receipt),
        });
        if (body.allocations && body.allocations.length > 0) {
          await this.applyAllocations(tx, payment.id, body.allocations);
        }
        return this.load(tx, payment.id);
      }),
    );
  }

  async allocate(id: string, body: AllocateInput) {
    return withSerializable(this.db, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id } });
      if (!payment) throw ApiException.notFound('Payment');
      await this.applyAllocations(tx, id, body.allocations ?? []);
      return this.load(tx, id);
    });
  }

  /** Reverses the receipt journal and removes its allocations; a second reversal is rejected. */
  async reverse(id: string) {
    return this.queue.run(this.config.companyId, () =>
      withSerializable(this.db, async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id } });
        if (!payment) throw ApiException.notFound('Payment');
        const receipt = await tx.journal.findFirst({
          where: { source: 'PAYMENT', sourceId: id, reversalOfId: null },
          include: { lines: true },
        });
        if (!receipt) throw ApiException.notFound('Receipt journal');
        const already = await tx.journal.findFirst({ where: { reversalOfId: receipt.id } });
        if (already) throw ApiException.conflict(ErrorCode.Conflict, 'Payment is already reversed');

        const today = businessDate();
        await postJournal(tx, this.config.companyId, {
          date: today,
          source: 'REVERSAL',
          sourceId: id,
          memo: `Reversal of receipt ${payment.number}`,
          reversalOfId: receipt.id,
          lines: receipt.lines.map((l) => ({
            accountId: l.accountId,
            debit: new Decimal(l.credit.toString()),
            credit: new Decimal(l.debit.toString()),
            description: l.description,
          })),
        });

        const allocations = await tx.allocation.findMany({ where: { paymentId: id } });
        for (const a of allocations) {
          if (!a.invoiceId) continue;
          const inv = await tx.invoice.findFirstOrThrow({ where: { id: a.invoiceId } });
          await tx.invoice.update({
            where: { id: inv.id },
            data: { amountPaid: new Decimal(inv.amountPaid.toString()).minus(a.amount.toString()).toFixed(4) },
          });
          await refreshSettlement(tx, inv.id);
        }
        await tx.allocation.deleteMany({ where: { paymentId: id } });
        await tx.payment.update({ where: { id }, data: { unallocated: '0.0000' } });
        return this.load(tx, id);
      }),
    );
  }

  async get(id: string) {
    return this.load(this.db, id);
  }

  /** Applies manual allocations, or oldest-first auto allocation when none are given. */
  private async applyAllocations(tx: Tx, paymentId: string, manual: { invoiceId: string; amount: string }[]) {
    const payment = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
    const invoices = await tx.invoice.findMany({
      where: { customerId: payment.customerId, status: 'ISSUED' },
      orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
    });
    const credits = await tx.creditNote.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoices.map((i) => i.id) }, status: 'ISSUED' },
      _sum: { total: true },
    });
    const creditedById = new Map(credits.map((c) => [c.invoiceId, new Decimal(c._sum.total?.toString() ?? 0)]));
    const open: OpenInvoice[] = invoices
      .map((i) => ({
        id: i.id,
        date: i.issueDate ? isoDate(i.issueDate) : '',
        open: new Decimal(i.total.toString()).minus(creditedById.get(i.id) ?? 0).minus(i.amountPaid.toString()),
      }))
      .filter((o) => o.open.gt(0));

    const result = allocate(
      payment.unallocated.toString(),
      open,
      manual.length > 0 ? manual.map((m) => ({ invoiceId: m.invoiceId, amount: m.amount })) : undefined,
    );

    for (const a of result.allocations) {
      await tx.allocation.create({
        data: { companyId: this.config.companyId, paymentId, invoiceId: a.invoiceId, amount: a.amount.toFixed(4), date: payment.date },
      });
      const inv = invoices.find((i) => i.id === a.invoiceId)!;
      await tx.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: new Decimal(inv.amountPaid.toString()).plus(a.amount).toFixed(4) },
      });
      await refreshSettlement(tx, inv.id);
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { unallocated: result.customerCredit.toFixed(4) },
    });
    return result;
  }

  private async load(tx: Tx, id: string): Promise<PaymentDto> {
    const p = await tx.payment.findFirst({ where: { id }, include: { allocations: { orderBy: { createdAt: 'asc' } } } });
    if (!p) throw ApiException.notFound('Payment');
    return {
      id: p.id,
      number: p.number,
      customerId: p.customerId,
      date: dateOnly(p.date),
      method: p.method,
      bankAccountId: p.bankAccountId,
      amount: dec(p.amount),
      currency: p.currency,
      fxRate: dec(p.fxRate),
      unallocated: dec(p.unallocated),
      reference: p.reference,
      allocations: p.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: dec(a.amount), date: dateOnly(a.date) })),
    };
  }
}
