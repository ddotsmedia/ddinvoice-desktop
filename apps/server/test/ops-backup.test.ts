import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ddinvoice/db';
import { parseConfig } from '../src/config';
import { PrismaService } from '../src/core/prisma.service';
import { OutboxWorker, type OutboxHandler } from '../src/outbox/outbox.worker';
import { createBackup, gcBlobs, pruneKind, type BackupDeps, type BackupKind } from '../src/ops/backup';
import { runBackupCycle, type CycleDeps } from '../src/ops/backup-cycle';
import { decryptBlob, encodeRecoveryKey, decodeRecoveryKey, generateBackupKey } from '../src/ops/crypto';
import { companyCounts, queryOf, trialBalance } from '../src/ops/db-facts';
import { restoreArchive } from '../src/ops/restore';
import { createTenant, type Tenant } from './helpers';

const PG_BIN = process.env.DD_PG_BIN_DIR ?? resolve(__dirname, '../../../vendor/pgsql/bin');
const HAS_PG = existsSync(join(PG_BIN, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'));

/** Round trip needs pg_dump/pg_restore (vendored on Windows). Skipped where the binaries are absent. */
describe.skipIf(!HAS_PG)('backup -> restore round trip', () => {
  let t: Tenant;
  let root: string;
  let dataDir: string;
  let restoreDataDir: string;
  let adminUrl: string;
  let url: string;
  const key = generateBackupKey();
  const liveName = `ddinv_rt_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  beforeAll(async () => {
    t = await createTenant();
    url = process.env.DATABASE_URL!;
    const maint = new URL(url);
    maint.pathname = '/postgres';
    adminUrl = maint.toString();
    dataDir = t.config.dataDir;
    restoreDataDir = mkdtempSync(join(tmpdir(), 'ddinv-rt-'));
    root = join(dataDir, 'backups');

    // A balanced manual journal so the trial balance is not trivially zero.
    await t.prisma.journal.create({
      data: {
        companyId: t.companyId,
        number: `RT-${randomUUID().slice(0, 6)}`,
        date: new Date('2026-11-01T00:00:00Z'),
        source: 'MANUAL',
        memo: 'round trip',
        lines: {
          create: [
            { companyId: t.companyId, accountId: t.accounts.bank, debit: '1234.5600', credit: '0' },
            { companyId: t.companyId, accountId: t.accounts.revenue, debit: '0', credit: '1234.5600' },
          ],
        },
      },
    });
    // One archived document (a PDF stand-in) under the documents folder.
    const docDir = join(dataDir, 'documents', '2026', 'INVOICE');
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, 'INV-1-en.pdf'), Buffer.from('%PDF-1.4 round trip document'));

    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${liveName}" TEMPLATE template0 ENCODING 'UTF8'`);
    await admin.$disconnect();
  });

  afterAll(async () => {
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(`SELECT datname FROM pg_database WHERE datname LIKE $1`, `${liveName}%`);
    for (const r of rows) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);
    await admin.$disconnect();
    rmSync(restoreDataDir, { recursive: true, force: true });
    await t.close();
  });

  const deps = (): BackupDeps => ({
    pgBinDir: PG_BIN,
    dbUrl: url,
    companyId: t.companyId,
    key,
    serverVersion: '0.9.0',
    query: queryOf(t.prisma),
    dataDir,
    root,
    tmpDir: join(dataDir, 'run', 'tmp'),
  });

  it('keeps row counts and the trial balance equal, carries documents, and lands in recovery mode', async () => {
    const q = queryOf(t.prisma);
    const beforeCounts = await companyCounts(q, t.companyId);
    const beforeTb = await trialBalance(q, t.companyId);
    expect(beforeTb.length).toBeGreaterThan(0);

    const backup = await createBackup(deps(), 'MANUAL');
    expect(backup.manifest.documents.length).toBe(1);

    const liveUrl = new URL(url);
    liveUrl.pathname = `/${liveName}`;
    const restoredDataDir = join(restoreDataDir, 'data');
    const result = await restoreArchive({
      file: backup.file,
      key,
      pgBinDir: PG_BIN,
      adminUrl,
      ownerUrl: liveUrl.toString(),
      dataDir: restoredDataDir,
      root,
      tmpDir: join(dataDir, 'run', 'tmp'),
    });
    expect(result.companyId).toBe(t.companyId);
    expect(result.documentsWritten).toBe(1);
    expect(result.previousDatabase).toMatch(/_pre_restore_/); // the empty live database was renamed aside, not dropped

    const check = new PrismaClient({ datasources: { db: { url: liveUrl.toString() } } });
    try {
      const cq = queryOf(check);
      // The restore itself writes one SYSTEM audit event after verification; everything else must match exactly.
      const afterCounts = await companyCounts(cq, t.companyId);
      const { AuditEvent: auditBefore, ChangeLog: logBefore, ...restBefore } = beforeCounts;
      const { AuditEvent: auditAfter, ChangeLog: logAfter, ...restAfter } = afterCounts;
      expect(restAfter).toEqual(restBefore);
      expect(auditAfter).toBe((auditBefore ?? 0) + 1);
      expect(logAfter ?? 0).toBeGreaterThanOrEqual(logBefore ?? 0); // triggers log the restore's own Company and AuditEvent writes
      expect(await trialBalance(cq, t.companyId)).toEqual(beforeTb);
      const company = await check.company.findUniqueOrThrow({ where: { id: t.companyId } });
      expect(company.recoveryMode).toBe(true);
    } finally {
      await check.$disconnect();
    }
    expect(readFileSync(join(restoredDataDir, 'documents', '2026', 'INVOICE', 'INV-1-en.pdf'), 'utf8')).toBe('%PDF-1.4 round trip document');
  });

  it('restore leaves external outbox rows paused until release; internal rows still run', async () => {
    const cfg = parseConfig({ dbUrl: new URL(`/${liveName}`, url).toString(), dataDir: restoreDataDir, companyId: t.companyId, requirePairing: false });
    const prisma = new PrismaService(cfg);
    const handled: string[] = [];
    const handlers = new Map<string, OutboxHandler>([
      ['einvoice.submit', async (job) => void handled.push(`ext:${job.id}`)],
      ['sync.push', async (job) => void handled.push(`int:${job.id}`)],
    ]);
    const db = prisma.scoped(t.companyId);
    const ext = await db.outbox.create({ data: { companyId: t.companyId, topic: 'einvoice.submit', payload: {}, external: true } });
    const internal = await db.outbox.create({ data: { companyId: t.companyId, topic: 'sync.push', payload: {}, external: false } });
    const worker = new OutboxWorker(prisma, cfg, handlers);
    try {
      await worker.tick(new Date(Date.now() + 1000));
      expect(handled).toEqual([`int:${internal.id}`]);
      expect((await db.outbox.findUniqueOrThrow({ where: { id: ext.id } })).status).toBe('PENDING');

      await prisma.client.company.update({ where: { id: t.companyId }, data: { recoveryMode: false } });
      await worker.tick(new Date(Date.now() + 1000));
      expect(handled).toContain(`ext:${ext.id}`);
    } finally {
      await prisma.onModuleDestroy();
    }
  });

  it('a wrong recovery key is refused and nothing is swapped', async () => {
    const backup = await createBackup(deps(), 'MANUAL');
    const liveUrl = new URL(url);
    liveUrl.pathname = `/${liveName}`;
    await expect(
      restoreArchive({ file: backup.file, key: generateBackupKey(), pgBinDir: PG_BIN, adminUrl, ownerUrl: liveUrl.toString(), dataDir: restoreDataDir, root, tmpDir: join(dataDir, 'run', 'tmp') }),
    ).rejects.toThrow(/wrong recovery key/);
  });

  it('recovery key typed from another PC restores the same archive', async () => {
    const backup = await createBackup(deps(), 'MANUAL');
    const typed = decodeRecoveryKey(encodeRecoveryKey(key));
    expect(() => decryptBlob(typed, readFileSync(backup.file))).not.toThrow();
  });

  it("scheduler: hourly when due, daily and monthly promoted once per period, nothing extra inside the hour", async () => {
    const r = join(dataDir, "cycle");
    const clock = { now: new Date("2026-11-26T10:05:00Z") };
    const records: { kind: BackupKind; at: Date; status: "OK" | "FAILED" }[] = [];
    const passDeps = (): CycleDeps => ({
      ...deps(),
      root: r,
      now: () => clock.now,
      lastOk: async (kind) => {
        const hits = records.filter((x) => x.kind === kind && x.status === "OK").map((x) => x.at.getTime());
        return hits.length ? new Date(Math.max(...hits)) : null;
      },
      record: async (x) => void records.push({ kind: x.kind, at: x.at, status: x.status }),
    });
    expect(await runBackupCycle(passDeps())).toEqual(["HOURLY", "DAILY", "MONTHLY"]);
    clock.now = new Date("2026-11-26T10:15:00Z");
    expect(await runBackupCycle(passDeps())).toEqual([]);
    clock.now = new Date("2026-11-26T11:20:00Z");
    expect(await runBackupCycle(passDeps())).toEqual(["HOURLY"]);
    expect(records.filter((x) => x.kind === "DAILY")).toHaveLength(1);
    expect(pruneKind(r, "HOURLY")).toEqual([]);
    expect(gcBlobs(r)).toBe(0);
  }, 120_000);
});

