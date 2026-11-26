import { Inject, Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import { ApiException } from '../common/api-exception';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { SERVER_VERSION } from '../version';
import { createBackup, KEEP, pruneKind, gcBlobs, type BackupDeps, type BackupKind } from './backup';
import { runBackupCycle, type BackupRecordInput } from './backup-cycle';
import { queryOf } from './db-facts';

export const CYCLE_MS = 60_000;

/** Owns backup folders, BackupRecord writes and the scheduler. Used by the worker (schedule) and the API (manual run). */
@Injectable()
export class BackupService {
  private readonly log = new Logger('BackupService');
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.backupKey && this.config.pgBinDir);
  }

  /** Paths and keys for backup work; throws with a clear message when the install predates backups. */
  deps(): BackupDeps {
    if (!this.config.backupKey) throw new ApiException(409, 'BACKUP_KEY_MISSING', 'No backup key on this PC; run "ddinvoice-setup backup-key"');
    if (!this.config.pgBinDir) throw new ApiException(409, 'PG_BIN_MISSING', 'pgBinDir is not set in server.json');
    return {
      pgBinDir: this.config.pgBinDir,
      dbUrl: this.config.dbUrl,
      companyId: this.config.companyId,
      key: this.config.backupKey,
      serverVersion: SERVER_VERSION,
      query: queryOf(this.prisma.client),
      dataDir: this.config.dataDir,
      root: join(this.config.dataDir, 'backups'),
      tmpDir: join(this.config.dataDir, 'run', 'tmp'),
    };
  }

  /** Worker: check once a minute; the cycle itself decides whether an hourly archive is due. */
  start(): void {
    if (!this.enabled) {
      this.log.warn('backups disabled: backup key or pgBinDir missing');
      return;
    }
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.cycle()
        .catch((e: unknown) => this.log.error(`backup cycle failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          this.busy = false;
        });
    }, CYCLE_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cycle(): Promise<string[]> {
    const d = this.deps();
    return runBackupCycle({
      ...d,
      copyDir: this.config.backupCopyDir,
      lastOk: (kind) => this.lastOk(kind),
      record: (r) => this.record(r),
    });
  }

  /** Settings > Backup > Back up now. Written as MANUAL; kept in its own folder (20 newest). */
  async runManual(): Promise<{ file: string; sizeBytes: number; sha256: string }> {
    const d = this.deps();
    const at = new Date();
    try {
      const r = await createBackup(d, 'MANUAL');
      await this.record({ kind: 'MANUAL', target: 'LOCAL', path: r.file, sha256: r.sha256, sizeBytes: r.sizeBytes, status: 'OK', at });
      pruneKind(d.root, 'MANUAL');
      gcBlobs(d.root);
      return { file: r.file, sizeBytes: r.sizeBytes, sha256: r.sha256 };
    } catch (e) {
      await this.record({ kind: 'MANUAL', target: 'LOCAL', path: '', sha256: '', sizeBytes: 0, status: 'FAILED', at });
      throw e;
    }
  }

  async lastOk(kind: BackupKind): Promise<Date | null> {
    const row = await this.prisma.scoped(this.config.companyId).backupRecord.findFirst({
      where: { kind, status: 'OK', target: 'LOCAL' },
      orderBy: { at: 'desc' },
    });
    return row?.at ?? null;
  }

  async record(r: BackupRecordInput): Promise<void> {
    await this.prisma.scoped(this.config.companyId).backupRecord.create({
      data: { companyId: this.config.companyId, path: r.path, sha256: r.sha256, sizeBytes: BigInt(r.sizeBytes), kind: r.kind, target: r.target, status: r.status, at: r.at },
    });
  }

  async list(limit = 50) {
    const rows = await this.prisma.scoped(this.config.companyId).backupRecord.findMany({ orderBy: { at: 'desc' }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      target: r.target,
      status: r.status,
      at: r.at.toISOString(),
      sizeBytes: Number(r.sizeBytes),
      sha256: r.sha256,
      path: r.path,
    }));
  }

  /** Retention limits, for the Settings screen. */
  static readonly retention = KEEP;
}
