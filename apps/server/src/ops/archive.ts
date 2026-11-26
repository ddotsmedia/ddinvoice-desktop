/**
 * Backup archive (plaintext before encryption): u32le manifest length | manifest JSON (UTF-8) | pg_dump -Fc bytes.
 * The whole archive is then sealed with encryptBlob(). Document PDFs are not inside the archive: they live in the
 * content-addressed blob store and the manifest only references them by sha256 (so each backup copies only new files).
 */
export const ARCHIVE_FORMAT = 'ddinvoice-backup';
export const ARCHIVE_FORMAT_VERSION = 1;

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: typeof ARCHIVE_FORMAT_VERSION;
  createdAt: string;
  serverVersion: string;
  companyId: string;
  dumpSha256: string;
  dumpBytes: number;
  /** Row counts per table for this company (company row counted by id). */
  counts: Record<string, number>;
  /** Trial balance per account code: sums of journal debit and credit, decimal strings. */
  trialBalance: { code: string; debit: string; credit: string }[];
  documents: { path: string; sha256: string; bytes: number }[];
}

export function packArchive(manifest: ArchiveManifest, dump: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json, dump]);
}

export function unpackArchive(buf: Buffer): { manifest: ArchiveManifest; dump: Buffer } {
  if (buf.length < 4) throw new Error('Backup archive is truncated');
  const len = buf.readUInt32LE(0);
  if (buf.length < 4 + len) throw new Error('Backup archive is truncated');
  const manifest = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as ArchiveManifest;
  if (manifest.format !== ARCHIVE_FORMAT || manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    throw new Error('Unsupported backup format');
  }
  return { manifest, dump: buf.subarray(4 + len) };
}

/** Relative document paths must stay inside the data directory (no absolute paths, no "..", no drive letters). */
export function safeRelativePath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  if (!norm || norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.split('/').some((s) => s === '..' || s === '')) {
    throw new Error(`Unsafe path in backup: ${p}`);
  }
  return norm;
}
