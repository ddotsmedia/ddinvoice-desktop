import Decimal from 'decimal.js';
import { DomainError } from './errors';

export interface OpenInvoice {
  id: string;
  /** ISO date; used for oldest-first ordering */
  date: string;
  open: Decimal.Value;
}
export interface Allocation {
  invoiceId: string;
  amount: Decimal;
}
export interface AllocationResult {
  allocations: Allocation[];
  allocated: Decimal;
  /** overpayment held as customer credit */
  customerCredit: Decimal;
}

/** Oldest-first by default; pass `manual` to choose amounts explicitly. */
export function allocate(
  payment: Decimal.Value,
  invoices: OpenInvoice[],
  manual?: { invoiceId: string; amount: Decimal.Value }[],
): AllocationResult {
  const pay = new Decimal(payment);
  if (!pay.gt(0)) throw new DomainError('INVALID_AMOUNT', 'payment must be > 0');
  const open = new Map(invoices.map((i) => [i.id, new Decimal(i.open)]));
  const allocations: Allocation[] = [];
  let left = pay;
  if (manual) {
    for (const m of manual) {
      const a = new Decimal(m.amount);
      const o = open.get(m.invoiceId);
      if (!o) throw new DomainError('UNKNOWN_INVOICE', m.invoiceId);
      if (!a.gt(0) || a.gt(o)) throw new DomainError('OVER_ALLOCATION', `exceeds open balance of ${m.invoiceId}`);
      if (a.gt(left)) throw new DomainError('OVER_ALLOCATION', 'exceeds unallocated payment');
      open.set(m.invoiceId, o.minus(a));
      left = left.minus(a);
      allocations.push({ invoiceId: m.invoiceId, amount: a });
    }
  } else {
    const sorted = [...invoices].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
    for (const inv of sorted) {
      if (left.isZero()) break;
      const a = Decimal.min(open.get(inv.id)!, left);
      if (a.lte(0)) continue;
      left = left.minus(a);
      allocations.push({ invoiceId: inv.id, amount: a });
    }
  }
  return { allocations, allocated: pay.minus(left), customerCredit: left };
}
