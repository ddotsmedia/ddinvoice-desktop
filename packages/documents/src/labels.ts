export type Lang = 'en' | 'ar' | 'bi';
export type DocType = 'INVOICE' | 'CREDIT_NOTE';

/** Every visible word of the v1 templates. Bilingual labels are "English / Arabic" pairs. */
export const LABELS = {
  en: {
    invoice: 'Tax Invoice',
    creditNote: 'Tax Credit Note',
    seller: 'Supplier',
    buyer: 'Customer',
    trn: 'TRN',
    number: 'Number',
    issueDate: 'Issue date',
    supplyDate: 'Supply date',
    dueDate: 'Due date',
    currency: 'Currency',
    fxRate: 'Exchange rate',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price',
    taxRate: 'Tax rate',
    taxAmount: 'Tax amount',
    net: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    vat: 'VAT total',
    total: 'Total',
    totalAed: 'Total (AED)',
    taxSummary: 'Tax summary by code',
    code: 'Code',
    rate: 'Rate',
    taxable: 'Taxable amount',
    originalInvoice: 'Original invoice',
    reason: 'Reason',
    bank: 'Bank details',
    pageOf: ['Page', 'of'],
    draft: 'DRAFT',
  },
  ar: {
    invoice: 'فاتورة ضريبية',
    creditNote: 'إشعار دائن ضريبي',
    seller: 'المورد',
    buyer: 'العميل',
    trn: 'الرقم الضريبي',
    number: 'الرقم',
    issueDate: 'تاريخ الإصدار',
    supplyDate: 'تاريخ التوريد',
    dueDate: 'تاريخ الاستحقاق',
    currency: 'العملة',
    fxRate: 'سعر الصرف',
    description: 'الوصف',
    qty: 'الكمية',
    unitPrice: 'سعر الوحدة',
    taxRate: 'نسبة الضريبة',
    taxAmount: 'مبلغ الضريبة',
    net: 'المبلغ',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    vat: 'إجمالي ضريبة القيمة المضافة',
    total: 'الإجمالي',
    totalAed: 'الإجمالي (درهم)',
    taxSummary: 'ملخص الضريبة حسب الرمز',
    code: 'الرمز',
    rate: 'النسبة',
    taxable: 'المبلغ الخاضع للضريبة',
    originalInvoice: 'الفاتورة الأصلية',
    reason: 'السبب',
    bank: 'تفاصيل البنك',
    pageOf: ['صفحة', 'من'],
    draft: 'مسودة',
  },
} as const;

type Dict = (typeof LABELS)['en'];

const pair = (k: Exclude<keyof Dict, 'pageOf' | 'draft'>): string => `${LABELS.en[k]} / ${LABELS.ar[k]}`;

/** Label text for a language; bi pairs English and Arabic with a slash. */
export function label(lang: Lang, key: Exclude<keyof Dict, 'pageOf' | 'draft'>): string {
  if (lang === 'bi') return pair(key);
  return LABELS[lang][key];
}

export function pageOfText(lang: Lang): [string, string] {
  if (lang === 'bi') return ['Page / صفحة', 'of / من'];
  return [...LABELS[lang].pageOf] as [string, string];
}

export function draftText(lang: Lang): string {
  return lang === 'bi' ? `${LABELS.en.draft} / ${LABELS.ar.draft}` : LABELS[lang].draft;
}

export const DOC_TITLE: Record<DocType, Exclude<keyof Dict, 'pageOf' | 'draft'>> = {
  INVOICE: 'invoice',
  CREDIT_NOTE: 'creditNote',
};
