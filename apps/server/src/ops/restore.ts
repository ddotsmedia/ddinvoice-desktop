import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@ddinvoice/db';
import { ARCHIVE_FORMAT, safeRelativePath, unpackArchive, type ArchiveManifest } from './archive';
import { blobDir, stampOf } from './backup';
import { decryptBlob, sha256Hex } from './crypto';
import { compareFacts, companyCounts, queryOf, trialBalance, type Query } from './db-facts';
import { dbName, pgRestore, pgRestoreList, withDbName } from './pg';

export interface RestoreOptions {
  /** Sealed .ddbk archive. */
  file: string;
  /** 32-byte backup key: this PC's key, or the recovery key typed in from another PC. */
  key: Buffer;
  pgBinDir: string;
  /** Maintenance connection (database `postgres`; superuser). */
  adminUrl: string;
  /** Owner connection to the live database (ddinvoice_owner). Restored objects are owned by this role. */
  ownerUrl: string;
  /** Role granted DML after the swap (ddinvoice_app). */
  appRole?: string;
  dataDir: string;
  /** Archive root (<dataDir>/backups): document blobs are read from here. */
  root: string;
  tmpDir: string;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RestoreResult {
  companyId: string;
  counts: Record<string, number>;
  documentsWritten: number;
  /** Name the previous live database was renamed to (kept for manual cleanup, never dropped). */
  previousDatabase?: string;
}

/**
 * decrypt → verify dump → restore into <live>_restore → verify counts and trial balance → write documents →
 * swap names → mark the company RECOVERY MODE (external outbox rows stay paused). Nothing live is touched
 * before verification passes.
 */
export async function restoreArchive(o: RestoreOptions): Promise<RestoreResult> {
  const log = o.log ?? (() => undefined);
  const now = o.now?.() ?? new Date();
  const { manifest, dump } = unpackArchive(decryptBlob(o.key, readFileSync(o.file)));
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error('Not a DDInvoice backup');
  if (sha256Hex(dump) !== manifest.dumpSha256) throw new Error('Backup dump hash mismatch');

  mkdirSync(o.tmpDir, { recursive: true });
  const dumpFile = join(o.tmpDir, `${randomUUID()}.dump`);
  writeFileSync(dumpFile, dump);
  const liveName = dbName(o.ownerUrl);
  const restoreName = `${liveName}_restore`;
  const admin = new PrismaClient({ datasources: { db: { url: o.adminUrl } } });
  const adminQ = queryOf(admin);
  try {
    await pgRestoreList(o.pgBinDir, dumpFile);
    log('restore: archive decrypted, dump verified');

    await adminQ(`DROP DATABASE IF EXISTS "${restoreName}" WITH (FORCE)`);
    const owner = decodeURIComponent(new URL(o.ownerUrl).username);
    await adminQ(`CREATE DATABASE "${restoreName}" OWNER "${owner}" ENCODING 'UTF8' TEMPLATE template0`);
    await pgRestore(o.pgBinDir, withDbName(o.ownerUrl, restoreName), dumpFile);
    log(`restore: loaded into ${restoreName}`);

    const restored = await factsOf(withDbName(o.ownerUrl, restoreName), manifest.companyId);
    const mismatch = compareFacts(manifest, restored);
    if (mismatch) {
      await adminQ(`DROP DATABASE IF EXISTS "${restoreName}" WITH (FORCE)`);
      throw new Error(`Restore verification failed: ${mismatch}`);
    }
    log('restore: row counts and trial balance match the backup');

    const documentsWritten = writeDocuments(o, manifest);
    const previousDatabase = await swap(adminQ, liveName, restoreName, stampOf(now));
    log(previousDatabase ? `restore: previous database kept as ${previousDatabase}` : 'restore: no previous database');

    await finishLive(o.ownerUrl, manifest, documentsWritten, now, o.appRole);
    log('restore: live database swapped; company is in RECOVERY MODE');
    return { companyId: manifest.companyId, counts: restored.counts, documentsWritten, previousDatabase };
  } finally {
    rmSync(dumpFile, { force: true });
    await admin.$disconnect();
  }
}

async function factsOf(url: string, companyId: string) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const q: Query = queryOf(client);
    return { counts: await companyCounts(q, companyId), trialBalance: await trialBalance(q, companyId) };
  } finally {
    await client.$disconnect();
  }
}

/** Terminates sessions on the live database, renames it aside (if it exists), then renames the restored copy into place. */
async function swap(adminQ: Query, liveName: string, restoreName: string, stamp: string): Promise<string | undefined> {
  await adminQ(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, liveName);
  let previous: string | undefined;
  const exists = await adminQ(`SELECT 1 AS one FROM pg_database WHERE datname = $1`, liveName);
  if (exists.length > 0) {
    previous = `${liveName}_pre_restore_${stamp}`;
    await adminQ(`ALTER DATABASE "${liveName}" RENAME TO "${previous}"`);
  }
  await adminQ(`ALTER DATABASE "${restoreName}" RENAME TO "${liveName}"`);
  return previous;
}

/** DML grants for the app role, RECOVERY MODE flag, and a SYSTEM audit event on the live database. */
async function finishLive(ownerUrl: string, manifest: ArchiveManifest, documentsWritten: number, now: Date, appRole?: string) {
  const live = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  try {
    if (appRole) {
      const role = `"${appRole.replace(/"/g, '""')}"`;
      await live.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await live.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await live.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    }
    await live.company.update({ where: { id: manifest.companyId }, data: { recoveryMode: true } });
    await live.auditEvent.create({
      data: {
        companyId: manifest.companyId,
        action: 'SYSTEM restore',
        entity: 'backup',
        entityId: manifest.dumpSha256.slice(0, 16),
        after: { backupCreatedAt: manifest.createdAt, counts: manifest.counts, documentsWritten },
        at: now,
      },
    });
  } finally {
    await live.$disconnect();
  }
}

/** Writes every referenced document from the blob store. Each blob is decrypted and its hash checked. */
function writeDocuments(o: RestoreOptions, manifest: ArchiveManifest): number {
  let written = 0;
  for (const doc of manifest.documents) {
    const blob = join(blobDir(o.root), `${doc.sha256}.bin`);
    if (!existsSync(blob)) throw new Error(`Document blob missing from the archive store: ${doc.path}`);
    const data = decryptBlob(o.key, readFileSync(blob));
    if (sha256Hex(data) !== doc.sha256) throw new Error(`Document hash mismatch: ${doc.path}`);
    const dest = join(o.dataDir, safeRelativePath(doc.path));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    written++;
  }
  return written;
}
