import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma.service';
import { OutboxWorker, backoffMs, MAX_ATTEMPTS } from '../src/outbox/outbox.worker';
import { STUB_HANDLERS } from '../src/outbox/handlers';
import { SERVER_VERSION } from '../src/version';
import { createTenant, skipDb, type Tenant } from './helpers';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

describe('version constants', () => {
  it('match apps/server/package.json', () => {
    expect(SERVER_VERSION).toBe(pkg.version);
  });
  it('backoff doubles and is capped at one hour', () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(30)).toBe(3_600_000);
    expect(MAX_ATTEMPTS).toBe(10);
  });
});

const d = describe.skipIf(skipDb);

d('health, system and outbox worker', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await createTenant();
  });
  afterAll(async () => t?.close());

  it('GET /health reports db status without authentication', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(res.body.version).toBe(pkg.version);
    expect(typeof res.body.diskFreeGb).toBe('number');
  });

  it('GET /system/version reports api and minimum client', async () => {
    const res = await request(t.app.getHttpServer()).get('/system/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ api: 'v1', version: pkg.version, minClient: pkg.version });
  });

  it('worker drains a handled topic to DONE', async () => {
    const prisma = t.app.get(PrismaService);
    const row = await prisma.client.outbox.create({
      data: { companyId: t.companyId, topic: 'einvoice.submit', payload: { docId: 'x' } },
    });
    const worker = new OutboxWorker(prisma, t.config, new Map(STUB_HANDLERS));
    await worker.tick(new Date(), 50);
    const after = await prisma.scoped(t.companyId).outbox.findFirstOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('DONE');
  });

  it('worker reschedules a failing job with backoff and fails it after max attempts', async () => {
    const prisma = t.app.get(PrismaService);
    const row = await prisma.client.outbox.create({
      data: { companyId: t.companyId, topic: 'unknown.topic', payload: {} },
    });
    const now = new Date();
    const worker = new OutboxWorker(prisma, t.config, new Map(STUB_HANDLERS));
    await worker.tick(now, 50);
    const retry = await prisma.scoped(t.companyId).outbox.findFirstOrThrow({ where: { id: row.id } });
    expect(retry.status).toBe('PENDING');
    expect(retry.attempts).toBe(1);
    expect(retry.nextAttemptAt.getTime()).toBe(now.getTime() + backoffMs(1));
    expect(retry.lastError).toContain('No handler');

    await prisma.client.outbox.update({ where: { id: row.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) } });
    await worker.tick(new Date(), 50);
    const failed = await prisma.scoped(t.companyId).outbox.findFirstOrThrow({ where: { id: row.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(MAX_ATTEMPTS);
  });
});
