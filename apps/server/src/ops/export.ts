import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { sha256Hex } from './crypto';
import { safeRelativePath } from './archive';
import type { Query } from './db-facts';

/**
 * Offboarding export. Business tables only: credentials (User, Session, Device, IdempotencyKey, Outbox, License,
 * BackupRecord) are deliberately left out. Company and Document rows are included so the archive is self-describing.
 */
export const EXPORT_TABLES = [
  'Company', 'Branch', 'Account', 'Period', 'TaxCode', 'Customer', 'Item', 'NumberSequence', 'Quote', 'QuoteLine',
  'Invoice', 'InvoiceLine', 'CreditNote', 'CreditNoteLine', 'Payment', 'Allocation', 'Journal', 'JournalLine',
  'IssueSnapshot', 'Document', 'AuditEvent',
] as const;

export interface ExportManifest {
  format: 'ddinvoice-export';
  formatVersion: 1;
  createdAt: string;
  serverVersion: string;
  companyId: string;
  excludedTables: string[];
  tables: { name: string; rows: number; file: string; sha256: string }[];
  documents: { path: string; sha256: string; bytes: number }[];
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = typeof (v as { toFixed?: unknown }).toFixed === 'function' ? String(v) : JSON.stringify(v);
  else s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportCompany(opts: {
  query: Query;
  companyId: string;
  dataDir: string;
  outDir: string;
  serverVersion: string;
  now: Date;
}): Promise<ExportManifest> {
  mkdirSync(join(opts.outDir, 'tables'), { recursive: true });
  const tables: ExportManifest['tables'] = [];
  for (const table of EXPORT_TABLES) {
    const cols = (
      await opts.query(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        table,
      )
    ).map((r) => String(r.c));
    const selectList = cols.map((c) => `"${c}"`).join(', ');
    const where = table === 'Company' ? 'id = $1' : '"companyId" = $1';
    const rows = await opts.query(`SELECT ${selectList} FROM "${table}" WHERE ${where} ORDER BY 1`, opts.companyId);
    const csv = toCsv(cols, rows);
    const file = `tables/${table}.csv`;
    writeFileSync(join(opts.outDir, file), csv, 'utf8');
    tables.push({ name: table, rows: rows.length, file, sha256: sha256Hex(csv) });
  }

  const documents: ExportManifest['documents'] = [];
  const docRoot = join(opts.dataDir, 'documents');
  if (existsSync(docRoot)) {
    for (const abs of walk(docRoot)) {
      const rel = safeRelativePath(relative(opts.dataDir, abs).split(sep).join('/'));
      const dest = join(opts.outDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const data = readFileSync(abs);
      writeFileSync(dest, data);
      documents.push({ path: rel, sha256: sha256Hex(data), bytes: data.length });
    }
  }

  const manifest: ExportManifest = {
    format: 'ddinvoice-export',
    formatVersion: 1,
    createdAt: opts.now.toISOString(),
    serverVersion: opts.serverVersion,
    companyId: opts.companyId,
    excludedTables: ['User', 'Session', 'Device', 'IdempotencyKey', 'Outbox', 'License', 'BackupRecord'],
    tables,
    documents,
  };
  writeFileSync(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
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
