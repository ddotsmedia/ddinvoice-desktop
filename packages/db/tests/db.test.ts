import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { companyScope, scoped, ScopeError, SCOPED_MODELS } from '../src/scope';
import { seedDemo } from '../src/seed';

const prisma = new PrismaClient();
const d = describe.skipIf(!!process.env.DD_SKIP_DB_TESTS);
let companyId = '';
let cash = '';
let sales = '';
let customerId = '';
let n = 0;
const uniq = () => `T${++n}-${Date.now()}`;

beforeAll(async () => {
  if (process.env.DD_SKIP_DB_TESTS) return;
  ({ companyId } = await seedDemo(prisma, 'test-password'));
  cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: '1000' } })).id;
  sales = (await prisma.account.findFirstOrThrow({ where: { companyId, code: '4000' } })).id;
  const ar = (await prisma.account.findFirstOrThrow({ where: { companyId, code: '1200' } })).id;
  customerId = (
    await prisma.customer.create({
      data: { companyId, code: 'C1', nameEn: 'Cust', nameAr: 'عميل', email: 'c@x.test', phone: '1', addressEn: 'a', addressAr: 'ع', receivableAccountId: ar },
    })
  ).id;
});
afterAll(() => prisma.$disconnect());

const journal = (date: string, debit: string, credit: string) =>
  prisma.journal.create({
    data: {
      companyId, number: uniq(), date: new Date(date), source: 'MANUAL',
      lines: {
        create: [
          { companyId, accountId: cash, debit, credit: '0' },
          { companyId, accountId: sales, debit: '0', credit },
        ],
      },
    },
  });

const invoice = (status: 'DRAFT' | 'ISSUED') =>
  prisma.invoice.create({
    data: {
      companyId, number: uniq(), customerId, status, dueDate: new Date('2026-12-31'),
      subtotal: '100', discountTotal: '0', taxTotal: '5', total: '105', totalAed: '105',
    },
  });

d('seed', () => {
  it('creates chart, tax codes, sequences, roles', async () => {
    expect(await prisma.account.count({ where: { companyId } })).toBeGreaterThanOrEqual(20);
    expect((await prisma.taxCode.findMany({ where: { companyId } })).map((t) => t.code).sort()).toEqual(['EX', 'OOS', 'RC', 'SR', 'ZR']);
    expect(await prisma.numberSequence.count({ where: { companyId } })).toBe(5);
    expect(await prisma.role.count({ where: { companyId } })).toBe(4);
  });
});

d('integrity triggers', () => {
  it('accepts a balanced journal and rejects an unbalanced one', async () => {
    await expect(journal('2026-03-01', '10.0000', '10.0000')).resolves.toBeTruthy();
    await expect(journal('2026-03-01', '10.0000', '9.9999')).rejects.toThrow(/unbalanced/);
  });

  it('rejects editing an issued invoice but allows settlement fields', async () => {
    const draft = await invoice('DRAFT');
    await expect(prisma.invoice.update({ where: { id: draft.id }, data: { notes: 'ok on draft' } })).resolves.toBeTruthy();
    const issued = await invoice('ISSUED');
    await expect(prisma.invoice.update({ where: { id: issued.id }, data: { total: '1' } })).rejects.toThrow(/immutable/);
    await expect(prisma.invoice.delete({ where: { id: issued.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(
      prisma.invoice.update({ where: { id: issued.id }, data: { amountPaid: '105', settlementStatus: 'PAID' } }),
    ).resolves.toBeTruthy();
  });

  it('rejects posting into a locked period', async () => {
    await prisma.period.create({ data: { companyId, start: new Date('2025-01-01'), end: new Date('2025-01-31'), status: 'LOCKED' } });
    await expect(journal('2025-01-15', '5', '5')).rejects.toThrow(/locked/);
    await expect(journal('2025-02-15', '5', '5')).resolves.toBeTruthy();
  });

  it('rejects deleting audit events as the app role', async () => {
    const ev = await prisma.auditEvent.create({ data: { companyId, action: 'x', entity: 'Invoice', entityId: '1' } });
    const run = (sql: string) =>
      prisma.$transaction([prisma.$executeRawUnsafe('SET LOCAL ROLE ddinvoice_app'), prisma.$executeRawUnsafe(sql)]);
    await expect(run(`DELETE FROM "AuditEvent" WHERE id = '${ev.id}'`)).rejects.toThrow(/permission denied/);
    await expect(run(`UPDATE "AuditEvent" SET action = 'y' WHERE id = '${ev.id}'`)).rejects.toThrow(/permission denied/);
  });

  it('appends change log rows', async () => {
    const before = await prisma.changeLog.count({ where: { companyId, entity: 'Customer' } });
    await prisma.customer.update({ where: { id: customerId }, data: { phone: '2' } });
    expect(await prisma.changeLog.count({ where: { companyId, entity: 'Customer' } })).toBe(before + 1);
  });
});

d('company scope extension', () => {
  it('throws without companyId', () => {
    expect(() => companyScope('')).toThrow(ScopeError);
    expect(() => scoped(prisma, undefined as unknown as string)).toThrow(ScopeError);
  });

  it('covers business models', () => {
    expect(SCOPED_MODELS.has('Invoice')).toBe(true);
    expect(SCOPED_MODELS.has('Company')).toBe(false);
  });

  it('forces companyId on reads and writes, rejects conflicts', async () => {
    const other = await prisma.company.create({
      data: { legalNameEn: 'Other', legalNameAr: 'آخر', trn: '100000000000011', tradeLicenseNo: 'O', emirate: 'DUBAI', addressEn: 'a', addressAr: 'ع' },
    });
    const db = scoped(prisma, companyId);
    expect((await db.account.findMany()).every((a) => a.companyId === companyId)).toBe(true);
    const otherDb = scoped(prisma, other.id);
    expect(await otherDb.account.count()).toBe(0);
    await expect(db.branch.create({ data: { companyId: other.id, code: 'X', nameEn: 'x', nameAr: 'x', address: 'x', emirate: 'DUBAI' } })).rejects.toThrow(/mismatch/);
    await expect(db.account.findMany({ where: { companyId: other.id } })).rejects.toThrow(/mismatch/);
    const b = await otherDb.branch.create({ data: { code: 'B', nameEn: 'b', nameAr: 'b', address: 'b', emirate: 'DUBAI' } as never });
    expect(b.companyId).toBe(other.id);
  });
});
