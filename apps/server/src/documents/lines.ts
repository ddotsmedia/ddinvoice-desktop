import {
  calcDocument,
  convert,
  Decimal,
  DomainError,
  roundAed,
  UAE_TAX_CODES,
  type AccountMap,
  type DocResult,
  type LineInput,
  type TaxCodeId,
} from '@ddinvoice/domain';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../core/prisma.service';

/** Tax code row as stored; rate is a fraction (0.05) in the DB, percent (5) for the domain. */
export interface TaxRow {
  id: string;
  code: string;
  rate: { toString(): string };
  outputAccountId: string;
  inputAccountId: string | null;
}

export interface LineRequest {
  itemId?: string | undefined;
  description?: string | undefined;
  qty: string;
  unitPrice?: string | undefined;
  discountPct?: string | undefined;
  discountAmt?: string | undefined;
  taxCodeId?: string | undefined;
  accountId?: string | undefined;
}

/** Line with every reference resolved; amounts stay as strings. */
export interface ResolvedLine {
  description: string;
  itemId: string | null;
  qty: string;
  unitPrice: string;
  discountPct: string;
  discountAmt: string;
  tax: TaxRow;
  accountId: string;
}

/** Resolves item defaults and checks tax codes/accounts belong to this company (scoped queries). */
export async function resolveLines(tx: Tx, lines: LineRequest[]): Promise<ResolvedLine[]> {
  if (lines.length === 0) throw ApiException.validation('At least one line is required', { lines: 'required' });
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  const items = itemIds.length ? await tx.item.findMany({ where: { id: { in: itemIds } } }) : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const pending = lines.map((l, idx) => {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    if (l.itemId && !item) throw ApiException.unprocessable('UNKNOWN_ITEM', `Line ${idx + 1}: item not found`);
    const taxCodeId = l.taxCodeId ?? item?.taxCodeId;
    const accountId = l.accountId ?? item?.revenueAccountId;
    const description = l.description ?? item?.nameEn;
    const unitPrice = l.unitPrice ?? item?.salePrice.toString();
    if (!taxCodeId || !accountId || !description || unitPrice === undefined) {
      throw ApiException.validation(`Line ${idx + 1} is incomplete`, {
        [`lines.${idx}`]: 'description, unitPrice, taxCodeId and accountId are required',
      });
    }
    return { l, item, taxCodeId, accountId, description, unitPrice };
  });

  const taxIds = [...new Set(pending.map((p) => p.taxCodeId))];
  const accountIds = [...new Set(pending.map((p) => p.accountId))];
  const [taxes, accounts] = await Promise.all([
    tx.taxCode.findMany({ where: { id: { in: taxIds } } }),
    tx.account.findMany({ where: { id: { in: accountIds }, isActive: true }, select: { id: true } }),
  ]);
  const taxById = new Map(taxes.map((t) => [t.id, t]));
  const accountSet = new Set(accounts.map((a) => a.id));

  return pending.map(({ l, item, taxCodeId, accountId, description, unitPrice }, idx) => {
    const tax = taxById.get(taxCodeId);
    if (!tax) throw ApiException.unprocessable('UNKNOWN_TAX_CODE', `Line ${idx + 1}: tax code not found`);
    if (!accountSet.has(accountId)) throw ApiException.unprocessable('UNKNOWN_ACCOUNT', `Line ${idx + 1}: account not found`);
    return {
      description,
      itemId: item?.id ?? null,
      qty: l.qty,
      unitPrice,
      discountPct: l.discountPct ?? '0',
      discountAmt: l.discountAmt ?? '0',
      tax: { id: tax.id, code: tax.code, rate: tax.rate, outputAccountId: tax.outputAccountId, inputAccountId: tax.inputAccountId },
      accountId,
    };
  });
}

export interface ComputedLine {
  net: Decimal;
  tax: Decimal;
  gross: Decimal;
  discount: Decimal;
  reverseCharge: boolean;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  totalAed: Decimal;
  result: DocResult;
}

/** Recalculates with the domain engine. Client-supplied totals are never read. */
export function computeDocument(lines: ResolvedLine[], fxRate: string): ComputedDocument {
  const inputs: LineInput[] = lines.map((l) => {
    const code = l.tax.code as TaxCodeId;
    const meta = UAE_TAX_CODES[code];
    if (!meta) throw new DomainError('UNKNOWN_TAX_CODE', `Unsupported tax code ${l.tax.code}`);
    return {
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      discountAmt: l.discountAmt,
      taxCode: {
        code,
        rate: new Decimal(l.tax.rate.toString()).times(100).toFixed(),
        label: meta.label,
        reverseCharge: !!meta.reverseCharge,
      },
    };
  });
  const result = calcDocument(inputs);
  return {
    lines: result.lines,
    subtotal: result.subtotal,
    discountTotal: result.discountTotal,
    taxTotal: result.taxTotal,
    total: result.total,
    totalAed: roundAed(convert(result.total, fxRate)),
    result,
  };
}

/** Domain account map. VAT output must be a single account across taxable lines. */
export function accountMapFor(receivableAccountId: string, lines: ResolvedLine[]): AccountMap {
  const outputs = new Set(
    lines.filter((l) => l.tax.code !== 'RC' && Number(l.tax.rate.toString()) > 0).map((l) => l.tax.outputAccountId),
  );
  if (outputs.size > 1) throw ApiException.unprocessable('MIXED_VAT_ACCOUNTS', 'Taxable lines must share one VAT output account');
  const rc = lines.find((l) => l.tax.code === 'RC')?.tax;
  return {
    ar: receivableAccountId,
    vatOutput: [...outputs][0] ?? '',
    vatInputRc: rc?.inputAccountId ?? '',
    vatOutputRc: rc?.outputAccountId ?? '',
    bank: '',
  };
}

/** Domain journal input for a computed document; accountCode is the revenue accountId. */
export function journalDocLines(lines: ResolvedLine[], computed: ComputedDocument) {
  return lines.map((l, i) => ({
    accountCode: l.accountId,
    net: computed.lines[i]!.net,
    tax: computed.lines[i]!.tax,
    taxCode: l.tax.code as TaxCodeId,
    reverseCharge: l.tax.code === 'RC',
  }));
}
