import { assertBalanced, Decimal, isPeriodOpen, type JournalLine, type Period } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { ApiException } from '../common/api-exception';
import { isoDate } from '../common/business-date';
import { nextNumber } from '../common/sequence';
import type { Tx } from '../core/prisma.service';

/** Application-level period check; the DB trigger (dd_guard_locked_period) is the backstop. */
export async function assertPeriodOpen(tx: Tx, date: Date): Promise<void> {
  const periods = await tx.period.findMany({ select: { start: true, end: true, status: true } });
  const domainPeriods: Period[] = periods.map((p) => ({
    start: isoDate(p.start),
    end: isoDate(p.end),
    status: p.status === 'OPEN' ? 'OPEN' : 'CLOSED',
  }));
  const iso = isoDate(date);
  if (!isPeriodOpen(iso, domainPeriods)) {
    throw ApiException.unprocessable(ErrorCode.PeriodLocked, `No open period covers ${iso}`);
  }
}

export interface PostLine {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
  branchId?: string | null;
}

/** Balance check (domain), period check, then Journal + JournalLine rows. Caller holds the transaction. */
export async function postJournal(
  tx: Tx,
  companyId: string,
  args: {
    date: Date;
    source: 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT' | 'MANUAL' | 'REVERSAL';
    sourceId: string | null;
    memo: string;
    reversalOfId?: string | null;
    lines: PostLine[];
  },
): Promise<{ id: string; number: string }> {
  assertBalanced(args.lines.map((l) => ({ accountCode: l.accountId, debit: l.debit, credit: l.credit })));
  await assertPeriodOpen(tx, args.date);
  const number = await nextNumber(tx, companyId, 'JV', args.date);
  const journal = await tx.journal.create({
    data: {
      companyId,
      number,
      date: args.date,
      source: args.source,
      sourceId: args.sourceId,
      memo: args.memo,
      reversalOfId: args.reversalOfId ?? null,
    },
  });
  await tx.journalLine.createMany({
    data: args.lines.map((l) => ({
      companyId,
      journalId: journal.id,
      accountId: l.accountId,
      debit: l.debit.toFixed(4),
      credit: l.credit.toFixed(4),
      description: l.description ?? '',
      branchId: l.branchId ?? null,
    })),
  });
  return { id: journal.id, number };
}

/** Domain JournalLine (accountCode = accountId) → persisted shape. */
export const toPostLines = (lines: JournalLine[]): PostLine[] =>
  lines.map((l) => ({ accountId: l.accountCode, debit: l.debit, credit: l.credit }));
