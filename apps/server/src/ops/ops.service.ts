import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { LicenseService } from '../license/license.service';
import { SERVER_VERSION } from '../version';
import { BackupService } from './backup.service';
import { certificateInfo, DISK_WARN_GB, readDiskFreeGb, workerState } from './health';
import { databaseSizeBytes, queryOf } from './db-facts';
import { exportCompany } from './export';
import { buildSupportBundle, readLogs } from './support-bundle';
import { STALE_MS } from './backup';

@Injectable()
export class OpsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(BackupService) private readonly backups: BackupService,
    @Inject(LicenseService) private readonly licenses: LicenseService,
  ) {}

  private get db() {
    return this.prisma.scoped(this.config.companyId);
  }

  async health(now = new Date()) {
    const query = queryOf(this.prisma.client);
    let postgres: 'UP' | 'DOWN' = 'UP';
    let dbBytes: number | null = null;
    try {
      dbBytes = await databaseSizeBytes(query);
    } catch {
      postgres = 'DOWN';
    }
    const diskFree = await readDiskFreeGb(this.config.dataDir);
    const lastBackup = await this.db.backupRecord.findFirst({ where: { status: 'OK', target: 'LOCAL' }, orderBy: { at: 'desc' } });
    const queue = await this.queue();
    const failed = await this.db.outbox.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, topic: true, attempts: true, lastError: true, external: true, updatedAt: true },
    });
    const sessions = await this.db.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      include: { device: { select: { name: true, kind: true, lastSeenAt: true } } },
    });
    const license = await this.licenses.current(now);
    const migrations = await query(`SELECT COUNT(*)::int AS n, MAX(migration_name) AS last FROM _prisma_migrations WHERE finished_at IS NOT NULL`).catch(() => []);
    const worker = workerState(this.config.dataDir, now);
    const lastAt = lastBackup?.at ?? null;
    return {
      status: postgres === 'UP' ? 'ok' : 'degraded',
      services: {
        api: { state: 'UP' as const },
        postgres: { state: postgres },
        worker: { state: worker.state, lastBeatAt: worker.lastBeatAt },
      },
      database: { sizeBytes: dbBytes },
      disk: { freeGb: diskFree, warn: diskFree < DISK_WARN_GB, warnBelowGb: DISK_WARN_GB },
      backup: {
        lastGoodAt: lastAt?.toISOString() ?? null,
        lastGoodKind: lastBackup?.kind ?? null,
        stale: !lastAt || now.getTime() - lastAt.getTime() > STALE_MS,
        staleAfterHours: STALE_MS / 3_600_000,
      },
      queue,
      failedJobs: failed.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() })),
      certificate: certificateInfo(this.config.certPath, now),
      versions: { server: SERVER_VERSION, node: process.version, platform: process.platform },
      migrations: { applied: Number(migrations[0]?.n ?? 0), last: migrations[0]?.last ?? null },
      connectedDevices: sessions.map((s) => ({
        deviceName: s.device.name,
        deviceKind: s.device.kind,
        lastSeenAt: s.device.lastSeenAt?.toISOString() ?? null,
        ip: s.ip,
      })),
      license: { mode: license.mode, reason: license.reason ?? null, seats: license.seats, modules: license.modules, expiresAt: license.expiresAt ?? null, trial: license.trial },
      time: now.toISOString(),
    };
  }

  private async queue(): Promise<Record<string, number>> {
    const rows = await queryOf(this.prisma.client)(`SELECT status, COUNT(*)::int AS n FROM "Outbox" WHERE "companyId" = $1 GROUP BY status`, this.config.companyId);
    const out: Record<string, number> = { PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0 };
    for (const r of rows) out[String(r.status)] = Number(r.n);
    return out;
  }

  /** Retry a FAILED job: back to PENDING with attempts reset. Only FAILED rows qualify. */
  async retryJob(id: string, now = new Date()) {
    const row = await this.db.outbox.findUnique({ where: { id } });
    if (!row) throw ApiException.notFound('Job');
    if (row.status !== 'FAILED') throw ApiException.conflict('ILLEGAL_TRANSITION', 'Only failed jobs can be retried');
    await this.db.outbox.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: now, leaseUntil: null, lastError: null } });
    return { id, status: 'PENDING' as const };
  }

  /** Dismiss a FAILED job: it stays in the table as DONE with a visible note, so nothing is silently lost. */
  async dismissJob(id: string) {
    const row = await this.db.outbox.findUnique({ where: { id } });
    if (!row) throw ApiException.notFound('Job');
    if (row.status !== 'FAILED') throw ApiException.conflict('ILLEGAL_TRANSITION', 'Only failed jobs can be dismissed');
    await this.db.outbox.update({ where: { id }, data: { status: 'DONE', leaseUntil: null, lastError: `DISMISSED: ${row.lastError ?? ''}`.slice(0, 2000) } });
    return { id, status: 'DONE' as const };
  }

  /** Pending list the owner reviews after a restore: external rows that are still waiting. */
  async recovery() {
    const company = await this.prisma.client.company.findUnique({ where: { id: this.config.companyId }, select: { recoveryMode: true } });
    const pending = await this.db.outbox.findMany({
      where: { external: true, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, topic: true, status: true, attempts: true, createdAt: true, lastError: true },
    });
    return {
      recoveryMode: company?.recoveryMode ?? false,
      pending: pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    };
  }

  /** Owner has reviewed the list: external rows become eligible for the worker. */
  async release() {
    const company = await this.prisma.client.company.findUnique({ where: { id: this.config.companyId }, select: { recoveryMode: true } });
    if (!company?.recoveryMode) throw ApiException.conflict('NOT_IN_RECOVERY', 'This company is not in recovery mode');
    await this.prisma.client.company.update({ where: { id: this.config.companyId }, data: { recoveryMode: false } });
    return { recoveryMode: false };
  }

  /** Zip for the Settings > Help screen. Never contains the database. */
  async supportBundle(now = new Date()): Promise<Buffer> {
    const health = await this.health(now);
    const migrationRows = await queryOf(this.prisma.client)(`SELECT migration_name AS name, finished_at AS "finishedAt" FROM _prisma_migrations ORDER BY finished_at NULLS LAST`).catch(() => []);
    const customers = await this.db.customer.findMany({ select: { nameEn: true, nameAr: true } });
    const company = await this.prisma.client.company.findUnique({ where: { id: this.config.companyId }, select: { legalNameEn: true, legalNameAr: true } });
    const names = [
      ...customers.flatMap((c) => [c.nameEn, c.nameAr]),
      company?.legalNameEn ?? '',
      company?.legalNameAr ?? '',
      this.config.companyName ?? '',
    ];
    return buildSupportBundle({
      versions: { server: SERVER_VERSION, node: process.version, platform: process.platform, arch: process.arch },
      health,
      migrations: migrationRows.map((m) => ({
        name: String(m.name),
        finishedAt: m.finishedAt instanceof Date ? m.finishedAt.toISOString() : null,
      })),
      logs: readLogs(this.config.dataDir),
      names,
      now,
    });
  }

  /** Offboarding export folder under <dataDir>/exports/<stamp>. */
  async exportData(now = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const outDir = join(this.config.dataDir, 'exports', stamp);
    mkdirSync(outDir, { recursive: true });
    const manifest = await exportCompany({
      query: queryOf(this.prisma.client),
      companyId: this.config.companyId,
      dataDir: this.config.dataDir,
      outDir,
      serverVersion: SERVER_VERSION,
      now,
    });
    return {
      folder: outDir,
      tables: manifest.tables.map((t) => ({ name: t.name, rows: t.rows })),
      documents: manifest.documents.length,
    };
  }

  async licenseState() {
    return this.licenses.current();
  }

  async installLicense(text: string) {
    return this.licenses.install(text);
  }

  backupsList(limit?: number) {
    return this.backups.list(limit);
  }

  runBackup() {
    return this.backups.runManual();
  }
}
