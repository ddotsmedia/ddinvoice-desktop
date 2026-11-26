import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decryptBlob, encryptBlob, sha256Hex } from './crypto';
import { ARCHIVE_FORMAT, ARCHIVE_FORMAT_VERSION, packArchive, safeRelativePath, unpackArchive, type ArchiveManifest } from './archive';
import { pgDump, pgRestoreList } from './pg';
import { companyCounts, trialBalance, type Query } from './db-facts';

export type BackupKind = 'HOURLY' | 'DAILY' | 'MONTHLY' | 'MANUAL';
export const KEEP: Record<BackupKind, number> = { HOURLY: 48, DAILY: 30, MONTHLY: 12, MANUAL: 20 };
export const HOUR_MS = 3_600_000;
/** A backup older than this makes every workstation show the warning banner. */
export const STALE_MS = 26 * HOUR_MS;

export interface BackupPaths {
  dataDir: string;
  /** Root of the encrypted archives: <root>/hourly, /daily, /monthly, /manual. */
  root: string;
  tmpDir: string;
}

export interface BackupDeps extends BackupPaths {
  pgBinDir: string;
  dbUrl: string;
  companyId: string;
  key: Buffer;
  serverVersion: string;
  query: Query;
  now?: () => Date;
}

export interface BackupResult {
  file: string;
  sha256: string;
  sizeBytes: number;
  manifest: ArchiveManifest;
}

export const kindDir = (root: string, kind: BackupKind) => join(root, kind.toLowerCase());
export const blobDir = (root: string) => join(root, 'blobs');

export function stampOf(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Dump, snapshot documents (new blobs only), seal, then verify the file we just wrote. */
export async function createBackup(deps: BackupDeps, kind: BackupKind): Promise<BackupResult> {
  const now = deps.now?.() ?? new Date();
  const dir = kindDir(deps.root, kind);
  mkdirSync(dir, { recursive: true });
  mkdirSync(blobDir(deps.root), { recursive: true });
  mkdirSync(deps.tmpDir, { recursive: true });
  const dumpFile = join(deps.tmpDir, `${randomUUID()}.dump`);
  try {
    await pgDump(deps.pgBinDir, deps.dbUrl, dumpFile);
    const dump = readFileSync(dumpFile);
    const counts = await companyCounts(deps.query, deps.companyId);
    const tb = await trialBalance(deps.query, deps.companyId);
    const documents = snapshotDocuments(deps);
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      createdAt: now.toISOString(),
      serverVersion: deps.serverVersion,
      companyId: deps.companyId,
      dumpSha256: sha256Hex(dump),
      dumpBytes: dump.length,
      counts,
      trialBalance: tb,
      documents,
    };
    const file = join(dir, `ddinvoice-${kind.toLowerCase()}-${stampOf(now)}.ddbk`);
    const sealed = encryptBlob(deps.key, packArchive(manifest, dump));
    writeFileSync(file, sealed);
    writeFileSync(`${file}.refs.json`, JSON.stringify(documents.map((d) => d.sha256)));
    await verifyArchive(file, deps);
    return { file, sha256: sha256Hex(sealed), sizeBytes: sealed.length, manifest };
  } finally {
    rmSync(dumpFile, { force: true });
  }
}

/** Decrypts, checks the dump hash and runs pg_restore --list on the dump. Throws on any mismatch. */
export async function verifyArchive(file: string, deps: Pick<BackupDeps, 'key' | 'pgBinDir' | 'tmpDir'>): Promise<ArchiveManifest> {
  const { manifest, dump } = unpackArchive(decryptBlob(deps.key, readFileSync(file)));
  if (sha256Hex(dump) !== manifest.dumpSha256) throw new Error('Backup dump hash mismatch');
  mkdirSync(deps.tmpDir, { recursive: true });
  const tmp = join(deps.tmpDir, `${randomUUID()}.dump`);
  writeFileSync(tmp, dump);
  try {
    await pgRestoreList(deps.pgBinDir, tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
  return manifest;
}

/** Content-addressed document store: a PDF is encrypted and written once; later backups only reference its hash. */
export function snapshotDocuments(deps: Pick<BackupPaths, 'dataDir' | 'root'> & { key: Buffer }): ArchiveManifest['documents'] {
  const docRoot = join(deps.dataDir, 'documents');
  if (!existsSync(docRoot)) return [];
  const out: ArchiveManifest['documents'] = [];
  for (const abs of walk(docRoot)) {
    const data = readFileSync(abs);
    const sha = sha256Hex(data);
    const blob = join(blobDir(deps.root), `${sha}.bin`);
    if (!existsSync(blob)) writeFileSync(blob, encryptBlob(deps.key, data));
    out.push({ path: safeRelativePath(relative(deps.dataDir, abs).split(sep).join('/')), sha256: sha, bytes: data.length });
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.isFile()) files.push(p);
  }
  return files.sort();
}

/** Copies an archive into another retention folder (daily / monthly) and, for daily, to the Settings target. */
export function promote(file: string, root: string, kind: BackupKind): string {
  const dir = kindDir(root, kind);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, file.split(/[\\/]/).pop()!.replace(/^ddinvoice-[a-z]+-/, `ddinvoice-${kind.toLowerCase()}-`));
  copyFileSync(file, dest);
  copyFileSync(`${file}.refs.json`, `${dest}.refs.json`);
  return dest;
}

export function copyToTarget(file: string, targetDir: string): string {
  mkdirSync(targetDir, { recursive: true });
  const dest = join(targetDir, file.split(/[\\/]/).pop()!);
  copyFileSync(file, dest);
  return dest;
}

/** Keeps the newest KEEP[kind] archives in the folder (names sort by timestamp). */
export function pruneKind(root: string, kind: BackupKind): string[] {
  const dir = kindDir(root, kind);
  if (!existsSync(dir)) return [];
  const archives = readdirSync(dir).filter((f) => f.endsWith('.ddbk')).sort().reverse();
  const removed: string[] = [];
  for (const f of archives.slice(KEEP[kind])) {
    rmSync(join(dir, f), { force: true });
    rmSync(join(dir, `${f}.refs.json`), { force: true });
    removed.push(f);
  }
  return removed;
}

/** Deletes blobs that no remaining archive references (reads the refs sidecars, never decrypts). */
export function gcBlobs(root: string): number {
  const referenced = new Set<string>();
  for (const kind of Object.keys(KEEP) as BackupKind[]) {
    const dir = kindDir(root, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.refs.json')) continue;
      for (const sha of JSON.parse(readFileSync(join(dir, f), 'utf8')) as string[]) referenced.add(sha);
    }
  }
  const bdir = blobDir(root);
  if (!existsSync(bdir)) return 0;
  let removed = 0;
  for (const f of readdirSync(bdir)) {
    if (!f.endsWith('.bin')) continue;
    if (!referenced.has(f.slice(0, -4))) {
      rmSync(join(bdir, f), { force: true });
      removed++;
    }
  }
  return removed;
}

export function sizeOf(file: string): number {
  return statSync(file).size;
}
