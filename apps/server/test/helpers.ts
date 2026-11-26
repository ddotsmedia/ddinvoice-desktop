import { randomInt, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, seedDemo, hashPassword } from '@ddinvoice/db';
import { createApp } from '../src/app.factory';
import { parseConfig, type ServerConfig } from '../src/config';

export const PASSWORD = 'correct-horse-battery-1';
export const DEVICE_ID = 'device-test-0001';

export interface Tenant {
  app: INestApplication;
  config: ServerConfig;
  companyId: string;
  prisma: PrismaClient;
  accounts: { ar: string; bank: string; revenue: string };
  taxCodes: { sr: string; zr: string; rc: string };
  token: string;
  refreshToken: string;
  close(): Promise<void>;
}

/** Each tenant is its own company on the shared test database, with its own app instance. */
export async function createTenant(opts: { openPeriod?: boolean } = {}): Promise<Tenant> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (root vitest globalSetup)');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const trn = '1' + String(randomInt(0, 1e12)).padStart(14, '0'); // unique 15-digit TRN per tenant
  const { companyId } = await seedDemo(prisma, PASSWORD, { trn });

  const account = (code: string) => prisma.account.findFirstOrThrow({ where: { companyId, code } });
  const tax = (code: string) => prisma.taxCode.findFirstOrThrow({ where: { companyId, code } });
  const [ar, bank, revenue, sr, zr, rc] = await Promise.all([
    account('1200'),
    account('1100'),
    account('4000'),
    tax('SR'),
    tax('ZR'),
    tax('RC'),
  ]);

  if (opts.openPeriod !== false) {
    await prisma.period.create({
      data: { companyId, start: new Date('2000-01-01T00:00:00Z'), end: new Date('2099-12-31T00:00:00Z') },
    });
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'ddinv-test-'));
  const config = parseConfig({ port: 47820, dbUrl: url, dataDir, companyId }) // never listens in tests;
  const app = await createApp(config, { logger: process.env.DD_TEST_LOG ? ['error'] : false });
  await app.init();

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'admin@demo.local', password: PASSWORD, deviceId: DEVICE_ID });
  if (login.status !== 201) throw new Error(`admin login failed: ${JSON.stringify(login.body)}`);

  return {
    app,
    config,
    companyId,
    prisma,
    accounts: { ar: ar.id, bank: bank.id, revenue: revenue.id },
    taxCodes: { sr: sr.id, zr: zr.id, rc: rc.id },
    token: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** Adds a user with the given role to the tenant (direct DB fixture). */
export async function addUser(t: Tenant, email: string, roleName: string): Promise<void> {
  const role = await t.prisma.role.findFirstOrThrow({ where: { companyId: t.companyId, name: roleName } });
  const user = await t.prisma.user.create({
    data: {
      companyId: t.companyId,
      email,
      nameEn: email,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  await t.prisma.userRole.create({ data: { companyId: t.companyId, userId: user.id, roleId: role.id } });
}

export async function createCustomer(t: Tenant, code = `C-${randomUUID().slice(0, 8)}`): Promise<string> {
  const res = await http(t).post('/customers', {
    code,
    nameEn: 'Customer LLC',
    nameAr: 'عميل',
    email: 'billing@customer.test',
    phone: '+971500000000',
    addressEn: 'Dubai',
    addressAr: 'دبي',
    receivableAccountId: t.accounts.ar,
  });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/** Thin wrapper: each command carries a fresh Idempotency-Key unless one is given. */
export function http(t: Tenant, token = t.token) {
  const srv = t.app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(srv).get(path)),
    post: (path: string, body: object = {}, key: string = randomUUID()) =>
      auth(request(srv).post(path)).set('Idempotency-Key', key).send(body),
    delete: (path: string, key: string = randomUUID()) => auth(request(srv).delete(path)).set('Idempotency-Key', key),
    patch: (path: string, body: object, ifMatch: number, key: string = randomUUID()) =>
      auth(request(srv).patch(path)).set('Idempotency-Key', key).set('If-Match', String(ifMatch)).send(body),
  };
}

export const invoiceLine = (t: Tenant, qty = '2', unitPrice = '100.00') => ({
  description: 'Consulting',
  qty,
  unitPrice,
  taxCodeId: t.taxCodes.sr,
  accountId: t.accounts.revenue,
});

/** Draft (not issued) invoice: 2 × 100.00 at 5% → net 200, tax 10, total 210. */
export async function createDraftInvoice(t: Tenant, customerId: string, qty = '2', unitPrice = '100.00'): Promise<{ id: string; version: number }> {
  const res = await http(t).post('/invoices', {
    customerId,
    lines: [invoiceLine(t, qty, unitPrice)],
  });
  if (res.status !== 201) throw new Error(`createDraftInvoice failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string, version: res.body.version as number };
}

export function issueInvoice(t: Tenant, id: string): Promise<request.Response> {
  return http(t).post(`/invoices/${id}/issue`);
}

export async function makePeriodLocked(t: Tenant): Promise<void> {
  const p = await t.prisma.period.findFirstOrThrow({ where: { companyId: t.companyId } });
  await t.prisma.period.update({ where: { id: p.id }, data: { status: 'LOCKED' } });
}

export const skipDb = !!process.env.DD_SKIP_DB_TESTS;
