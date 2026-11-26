// Generates prisma/schema.prisma (compact source of truth for the model list). Run: node tools/gen-schema.mjs
import fs from 'node:fs';
const M = '@db.Decimal(18,4)';
const Q = '@db.Decimal(18,6)';
const head = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Emirate {
  ABU_DHABI
  DUBAI
  SHARJAH
  AJMAN
  UMM_AL_QUWAIN
  RAS_AL_KHAIMAH
  FUJAIRAH
}
enum Locale {
  en
  ar
}
enum DeviceKind {
  SERVER
  WORKSTATION
}
enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  INCOME
  EXPENSE
}
enum PeriodStatus {
  OPEN
  LOCKED
}
enum QuoteStatus {
  DRAFT
  SENT
  ACCEPTED
  REJECTED
  EXPIRED
}
enum DocStatus {
  DRAFT
  ISSUED
}
enum SettlementStatus {
  UNPAID
  PARTIAL
  PAID
  OVERPAID
}
enum DeliveryStatus {
  NOT_SENT
  SENT
}
enum EInvoiceStatus {
  NOT_REQUIRED
  PENDING
  SUBMITTED
  ACCEPTED
  REJECTED
}
enum PayMethod {
  CASH
  BANK
  CARD
  CHEQUE
}
enum JournalSource {
  INVOICE
  CREDIT_NOTE
  PAYMENT
  MANUAL
  REVERSAL
  BILL
  PAYROLL
}
enum DocKind {
  PDF
  EINVOICE_XML
}
enum DocLanguage {
  en
  ar
  bi
}
enum OutboxStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
}
enum BackupKind {
  HOURLY
  DAILY
  MONTHLY
  MANUAL
}
enum BackupTarget {
  LOCAL
  FOLDER
  CLOUD
}

`;
const models = [];
const m = (name, fields, extra = [], co = true) => models.push({ name, fields, extra, co });
const idx = (...f) => `@@index([companyId, ${f.join(', ')}])`;

m(
  'Company',
  [
    'legalNameEn String', 'legalNameAr String', 'trn String', 'tin String?', 'tradeLicenseNo String', 'emirate Emirate',
    'addressEn String', 'addressAr String', 'baseCurrency String @default("AED")', 'fiscalYearStartMonth Int @default(1)',
    'logoFileId String?', 'einvoiceEnabled Boolean @default(false)', 'einvoiceFrom DateTime?', 'settings Json @default("{}")',
  ],
  ['@@unique([trn])'],
  false,
);
m('Branch', ['code String', 'nameEn String', 'nameAr String', 'address String', 'emirate Emirate'], ['@@unique([companyId, code])']);
m('User', [
  'email String', 'nameEn String', 'nameAr String?', 'passwordHash String', 'mfaSecret String?', 'isActive Boolean @default(true)',
  'locale Locale @default(en)', 'lastLoginAt DateTime?', 'failedLogins Int @default(0)', 'lockedUntil DateTime?',
  'roles UserRole[]', 'sessions Session[]',
], ['@@unique([companyId, email])']);
m('Role', ['name String', 'permissions String[]', 'users UserRole[]'], ['@@unique([companyId, name])']);
m('UserRole', [
  'userId String', 'roleId String',
  'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
  'role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)',
], ['@@unique([userId, roleId])', idx('userId')]);
m('Device', [
  'name String', 'kind DeviceKind', 'fingerprint String', 'lastSeenAt DateTime?', 'appVersion String', 'revokedAt DateTime?',
  'sessions Session[]',
], ['@@unique([companyId, fingerprint])']);
m('Session', [
  'userId String', 'deviceId String', 'refreshTokenHash String', 'expiresAt DateTime', 'revokedAt DateTime?', 'ip String', 'userAgent String',
  'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
  'device Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)',
], [idx('userId'), idx('refreshTokenHash')]);
m('Account', [
  'code String', 'nameEn String', 'nameAr String', 'type AccountType', 'subtype String?', 'isControl Boolean @default(false)',
  'parentId String?', 'isActive Boolean @default(true)',
  'parent Account? @relation("AccountTree", fields: [parentId], references: [id])', 'children Account[] @relation("AccountTree")',
], ['@@unique([companyId, code])']);
m('Period', ['start DateTime @db.Date', 'end DateTime @db.Date', 'status PeriodStatus @default(OPEN)'], [idx('start', 'end')]);
m('TaxCode', [
  'code String', 'rate Decimal ' + Q, 'labelEn String', 'labelAr String', 'outputAccountId String', 'inputAccountId String?',
  'effectiveFrom DateTime @db.Date', 'effectiveTo DateTime? @db.Date', 'isActive Boolean @default(true)',
], [idx('code'), '@@unique([companyId, code, effectiveFrom])']);
m('Customer', [
  'code String', 'nameEn String', 'nameAr String', 'trn String?', 'email String', 'phone String', 'addressEn String', 'addressAr String',
  'emirate Emirate?', 'country String @default("AE")', 'currency String @default("AED")', 'paymentTermsDays Int @default(30)',
  'creditLimit Decimal? ' + M, 'receivableAccountId String',
], ['@@unique([companyId, code])', idx('nameEn')]);
m('Item', [
  'sku String', 'nameEn String', 'nameAr String', 'unit String', 'salePrice Decimal ' + M, 'taxCodeId String', 'revenueAccountId String',
  'isActive Boolean @default(true)',
], ['@@unique([companyId, sku])']);
m('NumberSequence', ['docType String', 'pattern String', 'nextValue BigInt @default(1)', 'year Int?'], ['@@unique([companyId, docType, year])']);

const totals = ['subtotal Decimal ' + M, 'discountTotal Decimal ' + M, 'taxTotal Decimal ' + M, 'total Decimal ' + M];
const line = (rel) => [
  'lineNo Int', 'itemId String?', 'description String', 'qty Decimal ' + Q, 'unitPrice Decimal ' + Q,
  'discountPct Decimal @default(0) ' + Q, 'discountAmt Decimal @default(0) ' + M, 'taxCodeId String',
  'net Decimal ' + M, 'tax Decimal ' + M, 'gross Decimal ' + M, 'accountId String', rel,
];
m('Quote', [
  'number String?', 'revision Int @default(1)', 'status QuoteStatus @default(DRAFT)', 'customerId String', 'issueDate DateTime? @db.Date',
  'validUntil DateTime? @db.Date', 'currency String @default("AED")', 'fxRate Decimal @default(1) ' + Q, ...totals,
  'notes String @default("")', 'terms String @default("")', 'lines QuoteLine[]',
], [idx('status'), idx('customerId'), '@@unique([companyId, number, revision])']);
m('QuoteLine', ['quoteId String', ...line('quote Quote @relation(fields: [quoteId], references: [id], onDelete: Cascade)')], [idx('quoteId'), '@@unique([quoteId, lineNo])']);

const docHead = [
  'status DocStatus @default(DRAFT)', 'settlementStatus SettlementStatus @default(UNPAID)', 'deliveryStatus DeliveryStatus @default(NOT_SENT)',
  'einvoiceStatus EInvoiceStatus @default(NOT_REQUIRED)', 'issueDate DateTime? @db.Date', 'currency String @default("AED")',
  'fxRate Decimal @default(1) ' + Q, ...totals, 'totalAed Decimal ' + M, 'amountPaid Decimal @default(0) ' + M,
  'notes String @default("")', 'terms String @default("")', 'version Int @default(1)', 'issuedAt DateTime?', 'issuedById String?', 'snapshotId String?',
];
m('Invoice', [
  'branchId String?', 'number String?', 'customerId String', ...docHead, 'supplyDate DateTime? @db.Date', 'dueDate DateTime @db.Date',
  'legacyRef String?', 'lines InvoiceLine[]', 'creditNotes CreditNote[]', 'allocations Allocation[]',
], ['@@unique([companyId, number])', idx('status', 'issueDate'), idx('customerId'), idx('legacyRef')]);
m('InvoiceLine', ['invoiceId String', ...line('invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)')], [idx('invoiceId'), '@@unique([invoiceId, lineNo])']);
m('CreditNote', [
  'number String?', 'invoiceId String', 'customerId String', 'reason String', ...docHead, 'lines CreditNoteLine[]',
  'allocations Allocation[]', 'invoice Invoice @relation(fields: [invoiceId], references: [id])',
], ['@@unique([companyId, number])', idx('status', 'issueDate'), idx('invoiceId')]);
m('CreditNoteLine', ['creditNoteId String', ...line('creditNote CreditNote @relation(fields: [creditNoteId], references: [id], onDelete: Cascade)')], [idx('creditNoteId'), '@@unique([creditNoteId, lineNo])']);
m('Payment', [
  'number String', 'customerId String', 'date DateTime @db.Date', 'method PayMethod', 'bankAccountId String', 'amount Decimal ' + M,
  'currency String @default("AED")', 'fxRate Decimal @default(1) ' + Q, 'unallocated Decimal ' + M, 'reference String @default("")',
  'allocations Allocation[]',
], ['@@unique([companyId, number])', idx('customerId'), idx('date')]);
m('Allocation', [
  'paymentId String', 'invoiceId String?', 'creditNoteId String?', 'amount Decimal ' + M, 'date DateTime @db.Date',
  'payment Payment @relation(fields: [paymentId], references: [id])',
  'invoice Invoice? @relation(fields: [invoiceId], references: [id])',
  'creditNote CreditNote? @relation(fields: [creditNoteId], references: [id])',
], [idx('paymentId'), idx('invoiceId'), idx('creditNoteId')]);
m('Journal', [
  'number String', 'date DateTime @db.Date', 'source JournalSource', 'sourceId String?', 'memo String @default("")',
  'postedAt DateTime @default(now())', 'reversalOfId String?',
  'reversalOf Journal? @relation("Reversal", fields: [reversalOfId], references: [id])', 'reversals Journal[] @relation("Reversal")',
  'lines JournalLine[]',
], ['@@unique([companyId, number])', idx('date'), idx('source', 'sourceId')]);
m('JournalLine', [
  'journalId String', 'accountId String', 'debit Decimal @default(0) ' + M, 'credit Decimal @default(0) ' + M, 'branchId String?',
  'description String @default("")', 'journal Journal @relation(fields: [journalId], references: [id], onDelete: Cascade)',
], [idx('journalId'), idx('accountId')]);
m('IssueSnapshot', ['docType String', 'docId String', 'payload Json', 'sha256 String', 'templateVersion String'], [idx('docType', 'docId')]);
m('Document', ['docType String', 'docId String', 'snapshotId String', 'kind DocKind', 'language DocLanguage', 'path String', 'sha256 String', 'bytes Int'], [idx('docType', 'docId')]);
m('IdempotencyKey', ['key String', 'userId String', 'route String', 'requestHash String', 'responseJson Json'], ['@@unique([companyId, key])']);
m('Outbox', [
  'topic String', 'payload Json', 'status OutboxStatus @default(PENDING)', 'attempts Int @default(0)', 'nextAttemptAt DateTime @default(now())',
  'leaseUntil DateTime?', 'lastError String?', 'external Boolean @default(false)',
], [idx('status', 'nextAttemptAt')]);
m('AuditEvent', [
  'userId String?', 'action String', 'entity String', 'entityId String', 'before Json?', 'after Json?', 'reason String?', 'ip String?',
  'at DateTime @default(now())',
], [idx('entity', 'entityId'), idx('at')]);
m('SyncState', ['enabled Boolean @default(false)', 'lastSeqSent BigInt @default(0)', 'lastAckAt DateTime?'], ['@@unique([companyId])']);
m('ChangeLog', ['seq BigInt @default(autoincrement()) @unique', 'entity String', 'entityId String', 'op String', 'data Json', 'at DateTime @default(now())'], [idx('seq')]);
m('License', ['licenseKey String', 'payload Json', 'seats Int', 'modules String[]', 'expiresAt DateTime?', 'lastValidatedAt DateTime?', 'graceUntil DateTime?'], [idx('licenseKey')]);
m('BackupRecord', ['path String', 'sha256 String', 'sizeBytes BigInt', 'kind BackupKind', 'target BackupTarget', 'status String', 'at DateTime @default(now())'], [idx('at')]);

let out = head;
for (const x of models) {
  const base = `  id String @id @default(uuid())\n${x.co ? '  companyId String\n' : ''}  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n`;
  out += `model ${x.name} {\n${base}${x.fields.map((l) => '  ' + l).join('\n')}\n\n${x.extra.map((l) => '  ' + l).join('\n')}\n}\n\n`;
}
fs.writeFileSync('prisma/schema.prisma', out);
