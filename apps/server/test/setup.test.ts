import { X509Certificate } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { applySecrets, loadConfig, parseConfig } from '../src/config';
import { MAX_PAIRING_FAILURES, PAIRING_TTL_MS, PairingCodes } from '../src/pairing/pairing-codes';
import { generateCa, generateServerCert } from '../src/setup/pki';
import { migrateWithBackup } from '../src/setup/migrate';
import { winswXml } from '../src/setup/services';
import { dbUrl, postgresConf, PG_HBA } from '../src/setup/postgres';
import { createApp } from '../src/app.factory';
import { createTenant, DEVICE_ID, PASSWORD, type Tenant } from './helpers';

const companyId = randomUUID();

describe('config', () => {
  it('defaults: port 47820, pgPort 47821, pairing required', () => {
    const c = parseConfig({ dbUrl: 'postgresql://x@127.0.0.1:47821/ddinvoice', dataDir: 'C:/d', companyId });
    expect([c.port, c.pgPort, c.requirePairing]).toEqual([47820, 47821, true]);
  });
  it('rejects a non-UUID companyId', () => {
    expect(() => parseConfig({ dbUrl: 'x', dataDir: 'd', companyId: 'nope' })).toThrow();
  });
  it('injects the DPAPI app password and local token at load; server.json never holds the password', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ddinv-cfg-'));
    const file = join(dir, 'server.json');
    const secretsPath = join(dir, 'secrets.bin');
    writeFileSync(secretsPath, 'ENCRYPTED');
    writeFileSync(file, JSON.stringify({ dbUrl: 'postgresql://ddinvoice_app@127.0.0.1:47821/ddinvoice', dataDir: dir, companyId, secretsPath }));
    expect(readFileSync(file, 'utf8')).not.toContain('pw-app');
    const c = loadConfig({ DD_CONFIG_PATH: file } as never, (b64) => {
      expect(b64).toBe('ENCRYPTED');
      return JSON.stringify({ postgresPassword: 'a', ownerPassword: 'b', appPassword: 'pw-app', localToken: 'tok' });
    });
    expect(new URL(c.dbUrl).password).toBe('pw-app');
    expect(c.localToken).toBe('tok');
  });
  it('applySecrets url-encodes the password', () => {
    const c = parseConfig({ dbUrl: 'postgresql://u@h:1/d', dataDir: 'd', companyId });
    expect(new URL(applySecrets(c, { appPassword: 'a/b:c', localToken: 't' }).dbUrl).password).toBe('a%2Fb%3Ac');
  });
});


describe('postgres hardening config', () => {
  it('listens on loopback 47821 only with scram-only hba', () => {
    expect(postgresConf(47821)).toContain("listen_addresses = '127.0.0.1'");
    expect(postgresConf(47821)).toContain('port = 47821');
    expect(postgresConf(47821)).toContain('shared_buffers = 256MB');
    expect(PG_HBA.split('\n').filter((l) => l && !l.startsWith('#'))).toEqual(['host all all 127.0.0.1/32 scram-sha-256']);
  });
  it('app URL carries no password', () => {
    expect(dbUrl({ pgPort: 47821 }, 'ddinvoice_app')).toBe('postgresql://ddinvoice_app@127.0.0.1:47821/ddinvoice');
  });
});

describe('certificates', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const ca = generateCa(now);
  const srv = generateServerCert(ca, { hostname: 'DD-SERVER', ips: ['127.0.0.1', '192.168.1.20'], now });

  it('CA is valid for 10 years, server cert for 2 years', () => {
    const c = new X509Certificate(ca.certPem);
    const s = new X509Certificate(srv.certPem);
    expect(c.ca).toBe(true);
    expect(new Date(c.validTo).getUTCFullYear()).toBe(2036);
    expect(new Date(s.validTo).getUTCFullYear()).toBe(2028);
  });
  it('server cert chains to the CA and has SAN hostname, localhost and the LAN IPs', () => {
    const c = new X509Certificate(ca.certPem);
    const s = new X509Certificate(srv.certPem);
    expect(s.verify(c.publicKey)).toBe(true);
    expect(s.checkIssued(c)).toBe(true);
    expect(s.subjectAltName).toContain('DNS:DD-SERVER');
    expect(s.subjectAltName).toContain('DNS:localhost');
    expect(s.subjectAltName).toContain('IP Address:192.168.1.20');
    expect(s.checkIP('192.168.1.20')).toBeTruthy();
    expect(s.ca).toBe(false);
  });
}, 60_000);

describe('pairing code', () => {
  it('is 6 digits and valid for 10 minutes, then expires', () => {
    let t = 1_000_000;
    const codes = new PairingCodes(() => t);
    const { code } = codes.issue();
    expect(code).toMatch(/^\d{6}$/);
    t += PAIRING_TTL_MS - 1;
    expect(codes.consume(code)).toBe(true);
    const second = codes.issue();
    t += PAIRING_TTL_MS;
    expect(codes.consume(second.code)).toBe(false);
  });
  it('is single use and locks after repeated wrong guesses', () => {
    const codes = new PairingCodes(() => 0);
    const { code } = codes.issue();
    expect(codes.consume(code)).toBe(true);
    expect(codes.consume(code)).toBe(false);
    const again = codes.issue().code;
    const wrong = again === '000000' ? '000001' : '000000';
    for (let i = 0; i < MAX_PAIRING_FAILURES; i++) expect(codes.consume(wrong)).toBe(false);
    expect(codes.consume(again)).toBe(false);
  });
});

describe('services', () => {
  it('WinSW xml: delayed auto start, 3 restarts, 60 s reset, 10 MB x 10 logs, dependency', () => {
    const xml = winswXml({ id: 'DDInvoiceApi', description: 'x', executable: 'C:/n.exe', arguments: 'a', depend: 'DDInvoicePostgres', logPath: 'C:/logs' });
    expect(xml).toContain('<delayedAutoStart>true</delayedAutoStart>');
    expect(xml.match(/action="restart"/g)).toHaveLength(3);
    expect(xml).toContain('<resetfailure>60 sec</resetfailure>');
    expect(xml).toContain('<sizeThreshold>10240</sizeThreshold>');
    expect(xml).toContain('<keepFiles>10</keepFiles>');
    expect(xml).toContain('<depend>DDInvoicePostgres</depend>');
  });
});

describe('upgrade safety', () => {
  it('backs up before migrating and does not restore on success', () => {
    const calls: string[] = [];
    const r = migrateWithBackup('0.5.0', 'C:/b', {
      dump: (f) => calls.push(`dump ${f}`),
      migrate: () => calls.push('migrate'),
      restore: () => calls.push('restore'),
      log: () => undefined,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatch(/pre-migrate-0\.5\.0\.dump$/);
    expect(calls.slice(1)).toEqual(['migrate']);
  });
  it('restores the dump when the migration fails', () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const r = migrateWithBackup('0.5.0', 'C:/b', {
      dump: () => calls.push('dump'),
      migrate: () => {
        throw new Error('boom');
      },
      restore: () => calls.push('restore'),
      log: (m) => logs.push(m),
    });
    expect(r.ok).toBe(false);
    expect(calls).toEqual(['dump', 'restore']);
    expect(logs.join('\n')).toContain('FAILED');
  });
});

const d = describe.skipIf(!!process.env.DD_SKIP_DB_TESTS);
d('unpaired devices', () => {
  let t: Tenant;
  let strict: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    t = await createTenant();
    strict = await createApp({ ...t.config, requirePairing: true }, { logger: false });
    await strict.init();
  });
  afterAll(async () => {
    await strict.close();
    await t.close();
  });

  it('/health stays open', async () => {
    await request(strict.getHttpServer()).get('/health').expect(200);
  });
  it('rejects any other route without a paired device, even with a valid token', async () => {
    const res = await request(strict.getHttpServer()).get('/customers').set('authorization', `Bearer ${t.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? res.body.code).toBe('DEVICE_NOT_PAIRED');
    await request(strict.getHttpServer()).post('/auth/login').send({ email: 'x@y.z', password: PASSWORD, deviceId: DEVICE_ID }).expect(403);
  });
  it('POST /pairing with a wrong code is rejected', async () => {
    await request(strict.getHttpServer()).post('/pairing').send({ code: '123456', deviceName: 'pc', fingerprint: 'fp-12345678' }).expect(403);
  });
  it('a device paired via an issued code is accepted', async () => {
    const code = await request(strict.getHttpServer())
      .post('/pairing/code')
      .set('authorization', `Bearer ${t.token}`)
      .set('idempotency-key', randomUUID())
      .set('x-device-id', DEVICE_ID); // DEVICE_ID was registered by the tenant login
    expect(code.status).toBe(201);
    const fp = 'fp-' + randomUUID();
    await request(strict.getHttpServer()).post('/pairing').send({ code: code.body.code, deviceName: 'pc', fingerprint: fp }).expect(201);
    await request(strict.getHttpServer()).get('/customers').set('authorization', `Bearer ${t.token}`).set('x-device-id', fp).expect(200);
  });
});
