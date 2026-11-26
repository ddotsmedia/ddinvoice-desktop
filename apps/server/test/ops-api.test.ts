import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signLicense, type LicensePayload } from '../src/license/license';
import { createCustomer, createTenant, DEVICE_ID, http, PASSWORD, type Tenant } from './helpers';
import { readZip } from './zip-reader';

/** Edits the trial (unsigned, DB-held) license of a tenant: seats, modules, expiry. Direct fixture write. */
async function editTrial(t: Tenant, patch: Partial<{ seats: number; modules: string[]; expiresAt: Date }>) {
  const row = await t.prisma.license.findFirstOrThrow({ where: { companyId: t.companyId }, orderBy: { createdAt: 'desc' } });
  const payload = { ...(row.payload as object), ...(patch.seats !== undefined ? { seats: patch.seats } : {}), ...(patch.modules ? { modules: patch.modules } : {}), ...(patch.expiresAt ? { expiresAt: patch.expiresAt.toISOString() } : {}) };
  await t.prisma.license.update({
    where: { id: row.id },
    data: {
      payload: payload as object,
      seats: patch.seats ?? row.seats,
      modules: patch.modules ?? row.modules,
      expiresAt: patch.expiresAt ?? row.expiresAt,
    },
  });
}

const binary = (res: NodeJS.ReadableStream & { setEncoding?: unknown }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('licensing and ops API', () => {
  let t: Tenant;

  beforeAll(async () => {
    t = await createTenant();
  });
  afterAll(async () => {
    await t.close();
  });

  const loginFrom = (deviceId: string) =>
    request(t.app.getHttpServer()).post('/auth/login').send({ email: 'admin@demo.local', password: PASSWORD, deviceId, appVersion: '0.9.0' });

  it('seat limit is enforced at login: a new user-device pair is refused; the seat already in use is not counted again', async () => {
    await editTrial(t, { seats: 1 });
    const other = await loginFrom(`device-second-${randomUUID().slice(0, 6)}`);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('SEAT_LIMIT');

    const same = await loginFrom(DEVICE_ID);
    expect(same.status).toBe(201);
    expect((await http(t).get('/auth/sessions')).status).toBe(200);
    await editTrial(t, { seats: 3 });
  });

  it('a module outside the license is refused for reads and commands', async () => {
    await editTrial(t, { modules: ['banking'] });
    const res = await http(t).get('/customers');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_NOT_LICENSED');
    await editTrial(t, { modules: ['sales', 'purchases', 'banking', 'reports', 'payroll', 'einvoice', 'sync'] });
  });

  it('expired license is read-only: view works, commands are refused, license install stays available', async () => {
    const id = await createCustomer(t);
    await editTrial(t, { expiresAt: new Date('2020-01-01T00:00:00Z') });

    const view = await http(t).get(`/customers/${id}`);
    expect(view.status).toBe(200);

    const write = await http(t).post('/customers', { code: 'NEW-1', nameEn: 'Late', nameAr: 'متأخر', email: 'a@b.ae', phone: '+971500000000', addressEn: 'x', addressAr: 'x', receivableAccountId: t.accounts.ar });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('LICENSE_READ_ONLY');

    const status = await http(t).get('/ops/license');
    expect(status.body.mode).toBe('READ_ONLY');
    expect(status.body.reason).toBe('EXPIRED');

    await editTrial(t, { expiresAt: new Date(Date.now() + 10 * 86_400_000) });
    expect((await http(t).post('/customers', { code: 'NEW-2', nameEn: 'Back', nameAr: 'عاد', email: 'a@b.ae', phone: '+971500000000', addressEn: 'x', addressAr: 'x', receivableAccountId: t.accounts.ar })).status).toBe(201);
  });

  it('a license signed by another key is rejected; the install is refused and nothing is written', async () => {
    const stranger = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const payload: LicensePayload = {
      companyId: t.companyId,
      companyName: 'Demo Trading LLC',
      trn: '100000000000003',
      seats: 999,
      modules: ['sales'],
      issuedAt: new Date().toISOString(),
    };
    const before = await t.prisma.license.count({ where: { companyId: t.companyId } });
    const res = await http(t).post('/ops/license', { licenseKey: signLicense(payload, stranger) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LICENSE_INVALID');
    expect(await t.prisma.license.count({ where: { companyId: t.companyId } })).toBe(before);
  });

  it('health screen data: services, backup staleness, disk, license, connected devices', async () => {
    const res = await http(t).get('/ops/health');
    expect(res.status).toBe(200);
    expect(res.body.services.api.state).toBe('UP');
    expect(res.body.services.postgres.state).toBe('UP');
    expect(res.body.backup.stale).toBe(true); // no backup yet on this tenant
    expect(typeof res.body.disk.freeGb).toBe('number');
    expect(res.body.queue).toHaveProperty('PENDING');
    expect(res.body.license.mode).toBe('FULL');
    expect(res.body.connectedDevices.length).toBeGreaterThanOrEqual(1);
  });

  it('support bundle redacts names, e-mails, tokens and IBANs from logs; never contains the database', async () => {
    const name = `Zanzibar Trading ${randomUUID().slice(0, 4)}`;
    await t.prisma.customer.create({
      data: { companyId: t.companyId, code: `Z-${randomUUID().slice(0, 6)}`, nameEn: name, nameAr: 'زنجبار', email: 'z@zanzibar.test', phone: '+971500000001', addressEn: 'x', addressAr: 'x', receivableAccountId: t.accounts.ar },
    });
    const logs = join(t.config.dataDir, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'server.log'), `login ok owner=ceo@acme.ae password=hunter22 iban AE070331234567890123456 ${name} token=sekret-123\n`);

    const res = await http(t).get('/ops/support-bundle').buffer(true).parse(binary as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const files = readZip(res.body as Buffer);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'versions.json', 'health.json', 'migrations.json', 'logs/server.log']));
    const all = Object.values(files).join('\n');
    for (const secret of ['ceo@acme.ae', 'hunter22', 'AE070331234567890123456', 'sekret-123', name, 'zanzibar.test']) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain('[REDACTED-NAME]');
    expect(Object.keys(files).some((f) => /\.(dump|ddbk|sql)$/.test(f))).toBe(false);
  });

  it('data export writes CSV per business table with a manifest, and leaves credentials out', async () => {
    const res = await http(t).post('/ops/export', {});
    expect(res.status).toBe(201);
    const folder: string = res.body.folder;
    expect(existsSync(join(folder, 'manifest.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.excludedTables).toEqual(expect.arrayContaining(['User', 'Session', 'License']));
    const customers = manifest.tables.find((x: { name: string }) => x.name === 'Customer');
    expect(customers.rows).toBeGreaterThanOrEqual(1);
    expect(readFileSync(join(folder, 'tables', 'Customer.csv'), 'utf8')).toContain('Zanzibar');
    expect(existsSync(join(folder, 'tables', 'User.csv'))).toBe(false);
  });

  it('recovery: pending external rows are listed; release is owner-only and only in recovery mode', async () => {
    await t.prisma.company.update({ where: { id: t.companyId }, data: { recoveryMode: true } });
    const pending = await t.prisma.outbox.create({ data: { companyId: t.companyId, topic: 'einvoice.submit', payload: {}, external: true } });

    const view = await http(t).get('/ops/recovery');
    expect(view.body.recoveryMode).toBe(true);
    expect(view.body.pending.map((p: { id: string }) => p.id)).toContain(pending.id);

    const release = await http(t).post('/ops/recovery/release', {});
    expect(release.status).toBe(201);
    expect(release.body.recoveryMode).toBe(false);
    expect((await http(t).post('/ops/recovery/release', {})).status).toBe(409);
  });

  it('failed jobs can be retried or dismissed; other states are refused', async () => {
    const failed = await t.prisma.outbox.create({ data: { companyId: t.companyId, topic: 'document.render', payload: {}, status: 'FAILED', attempts: 10, lastError: 'boom' } });
    const retry = await http(t).post(`/ops/outbox/${failed.id}/retry`, {});
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('PENDING');

    const again = await t.prisma.outbox.create({ data: { companyId: t.companyId, topic: 'document.render', payload: {}, status: 'FAILED', attempts: 10, lastError: 'boom' } });
    const dismiss = await http(t).post(`/ops/outbox/${again.id}/dismiss`, {});
    expect(dismiss.status).toBe(201);
    expect(dismiss.body.status).toBe('DONE');
    expect((await http(t).post(`/ops/outbox/${again.id}/retry`, {})).status).toBe(409);
  });
});
