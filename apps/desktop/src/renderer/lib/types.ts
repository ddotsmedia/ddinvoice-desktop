/** Server DTOs used by the renderer. Money and quantities are decimal strings; never convert them to JS numbers. */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type DocStatus = 'DRAFT' | 'ISSUED';
export type Settlement = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
export type Delivery = 'NOT_SENT' | 'SENT';
export type EInvoice = 'NOT_REQUIRED' | 'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: DocStatus;
  settlementStatus: Settlement;
  deliveryStatus: Delivery;
  einvoiceStatus: EInvoice;
  customerId: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  supplyDate: string;
  total: string;
  totalAed: string;
  amountPaid: string;
  openBalance: string;
  version: number;
}

export interface InvoiceLine {
  id: string;
  lineNo: number;
  description: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  discountAmt: string;
  taxCodeId: string | null;
  accountId: string | null;
  net: string;
  tax: string;
  gross: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  branchId: string | null;
  fxRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  notes: string;
  terms: string;
  lines: InvoiceLine[];
}

export interface Customer {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  email: string;
  trn: string | null;
  currency: string;
  paymentTermsDays: number;
}

export interface TaxCodeRow {
  id: string;
  code: 'SR' | 'ZR' | 'EX' | 'RC' | 'OOS';
  rate: string;
  labelEn: string;
  labelAr: string;
}

export interface Account {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
}
