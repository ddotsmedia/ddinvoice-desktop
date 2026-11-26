import { Decimal, roundAed } from '@ddinvoice/domain';
import { DOC_TITLE, draftText, label, pageOfText, type DocType, type Lang } from './labels';

/** Party as frozen into the IssueSnapshot at issue time. Never read live records when rendering. */
export interface SnapshotParty {
  nameEn: string;
  nameAr: string;
  trn: string | null;
  addressEn: string;
  addressAr: string;
}

export interface SnapshotLine {
  lineNo: number;
  description: string;
  qty: string;
  unitPrice: string;
  taxCode: string;
  /** Percent as a decimal string (5 for 5%). */
  taxRate: string;
  net: string;
  tax: string;
  gross: string;
}

/** Payload written by invoices/credit-notes at issue time (JSON in IssueSnapshot.payload). */
export interface SnapshotPayload {
  docType: DocType;
  number: string;
  issueDate: string;
  supplyDate?: string | null;
  dueDate?: string | null;
  currency: string;
  fxRate: string;
  seller: SnapshotParty;
  buyer: SnapshotParty;
  invoiceNumber?: string;
  reason?: string;
  lines: SnapshotLine[];
  totals: { subtotal: string; discountTotal: string; taxTotal: string; total: string; totalAed: string };
  bank?: { bankName: string; iban: string; accountName: string } | null;
}

export interface Localized {
  text: string;
  dir: 'ltr' | 'rtl';
}

export interface ViewLine {
  lineNo: number;
  description: string;
  qty: string;
  unitPrice: string;
  taxCode: string;
  taxRate: string;
  net: string;
  taxAmount: string;
  gross: string;
}

/** Everything a v1 template reads. Strict Handlebars fails on any missing key, so every key is always present. */
export interface ViewModel {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  docType: DocType;
  templateVersion: string;
  fontBase: string;
  title: string;
  watermark: string | null;
  labels: Record<string, string>;
  pageOf: [string, string];
  number: string;
  issueDate: string;
  supplyDate: string | null;
  showSupplyDate: boolean;
  dueDate: string | null;
  currency: string;
  showFx: boolean;
  fxRate: string;
  seller: { names: Localized[]; addresses: Localized[]; trn: string | null };
  buyer: { names: Localized[]; addresses: Localized[]; trn: string | null };
  original: { number: string; issueDate: string | null } | null;
  reason: string | null;
  lines: ViewLine[];
  totals: { subtotal: string; discount: string; vat: string; total: string; totalAed: string };
  taxSummary: { code: string; rate: string; taxable: string; tax: string }[];
  bank: { bankName: string; iban: string; accountName: string } | null;
}

export interface BuildOptions {
  lang: Lang;
  templateVersion: string;
  fontBase: string;
  draft?: boolean;
}

/** Groups digits with commas: "1234567.80" -> "1,234,567.80". Inputs are already rounded strings. */
export function groupDigits(plain: string): string {
  const neg = plain.startsWith('-');
  const [int = '0', frac] = (neg ? plain.slice(1) : plain).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/** Money display: 2 dp, half-up (domain rounding), grouped. Never a JS number. */
export function money(v: string | Decimal): string {
  return groupDigits(roundAed(v).toFixed(2));
}

function localized(lang: Lang, en: string, ar: string): Localized[] {
  const ltr: Localized = { text: en, dir: 'ltr' };
  const rtl: Localized = { text: ar, dir: 'rtl' };
  if (lang === 'en') return [ltr];
  if (lang === 'ar') return [rtl];
  return [ltr, rtl];
}

function party(lang: Lang, p: SnapshotParty) {
  return {
    names: localized(lang, p.nameEn, p.nameAr),
    addresses: localized(lang, p.addressEn, p.addressAr),
    trn: p.trn,
  };
}

/** Per-code VAT summary; amounts are summed in Decimal, then rounded for display. */
export function taxSummary(lines: SnapshotLine[]): ViewModel['taxSummary'] {
  const byCode = new Map<string, { rate: string; taxable: Decimal; tax: Decimal }>();
  for (const l of lines) {
    const cur = byCode.get(l.taxCode) ?? { rate: l.taxRate, taxable: new Decimal(0), tax: new Decimal(0) };
    cur.taxable = cur.taxable.plus(l.net);
    cur.tax = cur.tax.plus(l.tax);
    byCode.set(l.taxCode, cur);
  }
  return [...byCode.entries()].map(([code, v]) => ({
    code,
    rate: new Decimal(v.rate).toFixed(),
    taxable: money(v.taxable),
    tax: money(v.tax),
  }));
}

/** Builds the template view from a stored snapshot payload only. Pure: same payload + lang → same view. */
export function buildViewModel(p: SnapshotPayload, opts: BuildOptions): ViewModel {
  const { lang } = opts;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const fx = new Decimal(p.fxRate);
  const isForeign = p.currency !== 'AED';
  const t = p.totals;
  // UAE: VAT total is shown in AED; document-currency tax converts at the snapshot rate.
  const vatAed = new Decimal(t.taxTotal).times(fx);
  const [pageOf0, pageOf1] = pageOfText(lang);
  const labels: Record<string, string> = {};
  for (const k of [
    'seller', 'buyer', 'trn', 'number', 'issueDate', 'supplyDate', 'dueDate', 'currency', 'fxRate', 'description', 'qty',
    'unitPrice', 'taxRate', 'taxAmount', 'net', 'subtotal', 'discount', 'vat', 'total', 'totalAed', 'taxSummary', 'code',
    'rate', 'taxable', 'originalInvoice', 'reason', 'bank',
  ] as const) {
    labels[k] = label(lang, k);
  }
  const isCredit = p.docType === 'CREDIT_NOTE';
  const supply = p.supplyDate ?? null;
  return {
    lang,
    dir,
    docType: p.docType,
    templateVersion: opts.templateVersion,
    fontBase: opts.fontBase,
    title: label(lang, DOC_TITLE[p.docType]),
    watermark: opts.draft ? draftText(lang) : null,
    labels,
    pageOf: [pageOf0, pageOf1],
    number: p.number,
    issueDate: p.issueDate,
    supplyDate: supply,
    // Supply date is printed only when it differs from the issue date (UAE tax invoice rule).
    showSupplyDate: supply !== null && supply !== p.issueDate,
    dueDate: isCredit ? null : (p.dueDate ?? null),
    currency: p.currency,
    showFx: isForeign,
    fxRate: fx.toFixed(6),
    seller: party(lang, p.seller),
    buyer: party(lang, p.buyer),
    original: isCredit && p.invoiceNumber ? { number: p.invoiceNumber, issueDate: null } : null,
    reason: isCredit ? (p.reason ?? '') : null,
    lines: p.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      qty: new Decimal(l.qty).toFixed(),
      unitPrice: money(l.unitPrice),
      taxCode: l.taxCode,
      taxRate: new Decimal(l.taxRate).toFixed(),
      net: money(l.net),
      taxAmount: money(l.tax),
      gross: money(l.gross),
    })),
    totals: {
      subtotal: money(t.subtotal),
      discount: money(t.discountTotal),
      vat: money(vatAed),
      total: money(t.total),
      totalAed: money(t.totalAed),
    },
    taxSummary: taxSummary(p.lines),
    bank: p.bank ?? null,
  };
}
