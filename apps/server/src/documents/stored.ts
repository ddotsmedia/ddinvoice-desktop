import { Decimal, deriveSettlement } from '@ddinvoice/domain';
import { canonicalJson, sha256Hex } from '../common/canonical';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../core/prisma.service';
import { TEMPLATE_VERSION, type SnapshotLine, type SnapshotParty } from '@ddinvoice/documents';
import type { ComputedLine, ResolvedLine } from './lines';

export const PDF_LANGUAGES = ['en', 'ar', 'bi'] as const;

export interface StoredLineRow {
  description: string;
  itemId: string | null;
  qty: { toString(): string };
  unitPrice: { toString(): string };
  discountPct: { toString(): string };
  discountAmt: { toString(): string };
  taxCodeId: string;
  accountId: string;
}

/** Rebuilds resolved lines from persisted rows so issue-time recalculation uses stored inputs only. */
export async function resolveStoredLines(tx: Tx, rows: StoredLineRow[]): Promise<ResolvedLine[]> {
  const taxes = await tx.taxCode.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.taxCodeId))] } } });
  const byId = new Map(taxes.map((t) => [t.id, t]));
  return rows.map((r) => {
    const tax = byId.get(r.taxCodeId);
    if (!tax) throw ApiException.unprocessable('UNKNOWN_TAX_CODE', 'Tax code not found');
    return {
      description: r.description,
      itemId: r.itemId,
      qty: r.qty.toString(),
      unitPrice: r.unitPrice.toString(),
      discountPct: r.discountPct.toString(),
      discountAmt: r.discountAmt.toString(),
      tax: { id: tax.id, code: tax.code, rate: tax.rate, outputAccountId: tax.outputAccountId, inputAccountId: tax.inputAccountId },
      accountId: r.accountId,
    };
  });
}

/** Stores an immutable IssueSnapshot (canonical JSON + sha256). Returns its id. */
export async function writeSnapshot(tx: Tx, companyId: string, docType: string, docId: string, payload: object): Promise<string> {
  const json = canonicalJson(payload);
  const snap = await tx.issueSnapshot.create({
    data: { companyId, docType, docId, payload: JSON.parse(json) as object, sha256: sha256Hex(json), templateVersion: TEMPLATE_VERSION },
  });
  return snap.id;
}

/** Amount still due = document total less issued credit notes; settlement derived from allocated cash. */
export async function refreshSettlement(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
  const credited = await tx.creditNote.aggregate({ where: { invoiceId, status: 'ISSUED' }, _sum: { total: true } });
  const due = new Decimal(inv.total.toString()).minus(new Decimal(credited._sum.total?.toString() ?? 0));
  const paid = new Decimal(inv.amountPaid.toString());
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { settlementStatus: deriveSettlement(due, paid) },
  });
  return { due: due.toFixed(4), paid: paid.toFixed(4), open: due.minus(paid).toFixed(4) };
}

/** Seller as frozen on the snapshot (company legal identity at issue time). */
export function sellerParty(c: { legalNameEn: string; legalNameAr: string; trn: string; addressEn: string; addressAr: string }): SnapshotParty {
  return { nameEn: c.legalNameEn, nameAr: c.legalNameAr, trn: c.trn, addressEn: c.addressEn, addressAr: c.addressAr };
}

/** Buyer as frozen on the snapshot; TRN is printed only when the customer is VAT-registered. */
export function buyerParty(c: { nameEn: string; nameAr: string; trn: string | null; addressEn: string; addressAr: string }): SnapshotParty {
  return { nameEn: c.nameEn, nameAr: c.nameAr, trn: c.trn ?? null, addressEn: c.addressEn, addressAr: c.addressAr };
}

/** Line rows for the PDF snapshot: amounts already computed by the domain engine. */
export function snapshotLines(lines: ResolvedLine[], computed: ComputedLine[]): SnapshotLine[] {
  return lines.map((l, i) => ({
    lineNo: i + 1,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    taxCode: l.tax.code,
    taxRate: new Decimal(l.tax.rate.toString()).times(100).toFixed(),
    net: computed[i]!.net.toFixed(4),
    tax: computed[i]!.tax.toFixed(4),
    gross: computed[i]!.gross.toFixed(4),
  }));
}

/** One outbox row per language: each archived PDF is rendered by the worker from the snapshot. */
export async function enqueueRenders(tx: Tx, companyId: string, docType: string, docId: string, snapshotId: string): Promise<void> {
  for (const lang of PDF_LANGUAGES) {
    await tx.outbox.create({ data: { companyId, topic: 'document.render', payload: { docType, docId, snapshotId, lang } } });
  }
}
