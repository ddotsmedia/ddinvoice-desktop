import Decimal from 'decimal.js';
import { DomainError } from './errors';

export type DocStatus = 'DRAFT' | 'ISSUED';
export type Settlement = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
export type Delivery = 'NOT_SENT' | 'SENT';
export type EInvoice = 'NOT_REQUIRED' | 'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';

export function issue(s: DocStatus): DocStatus {
  if (s !== 'DRAFT') throw new DomainError('ILLEGAL_TRANSITION', `Cannot issue from ${s}`);
  return 'ISSUED';
}

/** Issued documents are never voided in place; use a credit note. */
export function voidDocument(s: DocStatus): never {
  throw new DomainError(
    'ILLEGAL_TRANSITION',
    s === 'ISSUED' ? 'Issued documents can only be reversed via credit note' : 'Drafts are deleted, not voided',
  );
}

/** Resending is allowed and idempotent. */
export function markSent(): Delivery {
  return 'SENT';
}

const EINV: Record<EInvoice, EInvoice[]> = {
  NOT_REQUIRED: [],
  PENDING: ['SUBMITTED'],
  SUBMITTED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: ['PENDING'],
};

export function transitionEInvoice(from: EInvoice, to: EInvoice): EInvoice {
  if (!EINV[from].includes(to)) throw new DomainError('ILLEGAL_TRANSITION', `e-invoice ${from} -> ${to}`);
  return to;
}

/** Settlement derived from amount due (after credit notes) and allocated receipts/credits. */
export function deriveSettlement(total: Decimal.Value, allocated: Decimal.Value): Settlement {
  const t = new Decimal(total);
  const a = new Decimal(allocated);
  if (a.lte(0)) return 'UNPAID';
  const c = a.cmp(t);
  return c < 0 ? 'PARTIAL' : c === 0 ? 'PAID' : 'OVERPAID';
}
