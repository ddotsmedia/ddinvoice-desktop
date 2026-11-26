import { format } from '@ddinvoice/domain';
import type { Tx } from '../core/prisma.service';

/** Allocates the next number from NumberSequence (row locked FOR UPDATE). Caller must be inside a transaction. */
export async function nextNumber(tx: Tx, companyId: string, docType: string, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  const rows = await tx.$queryRaw<{ pattern: string; nextValue: bigint }[]>`
    SELECT pattern, "nextValue" FROM "NumberSequence"
    WHERE "companyId" = ${companyId} AND "docType" = ${docType} AND year = ${year}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error(`No NumberSequence for ${docType} ${year}`);
  const seq = Number(row.nextValue);
  await tx.numberSequence.updateMany({
    where: { docType, year },
    data: { nextValue: BigInt(seq + 1) },
  });
  return format(row.pattern, seq, date);
}
