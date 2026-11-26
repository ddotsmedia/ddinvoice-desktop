import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip, type ZipEntry } from './zip';
import { redact } from './redact';

export const LOG_TAIL_LINES = 2000;

export interface SupportBundleInput {
  versions: Record<string, unknown>;
  health: unknown;
  migrations: { name: string; finishedAt: string | null }[];
  /** Log files by name, already read (not redacted yet). */
  logs: { name: string; text: string }[];
  /** Customer, company and user display names: redacted wherever they appear in the logs. */
  names: string[];
  now: Date;
}

const README = `DDInvoice support bundle

Contents: versions, health snapshot, migration status, and the last ${LOG_TAIL_LINES} lines of each log.
Redacted: passwords, tokens, e-mail addresses, IBANs, and customer / company names.
Not included: the database, documents, backups, keys and secrets.
`;

/** Pure builder: everything text-like is redacted before it is zipped. */
export function buildSupportBundle(input: SupportBundleInput): Buffer {
  const names = [...new Set(input.names.map((n) => n.trim()).filter(Boolean))];
  const clean = (s: string) => redact(s, names);
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: Buffer.from(README, 'utf8') },
    { name: 'versions.json', data: Buffer.from(clean(JSON.stringify(input.versions, null, 2)), 'utf8') },
    { name: 'health.json', data: Buffer.from(clean(JSON.stringify(input.health, null, 2)), 'utf8') },
    { name: 'migrations.json', data: Buffer.from(clean(JSON.stringify(input.migrations, null, 2)), 'utf8') },
    ...input.logs.map((l) => ({ name: `logs/${l.name.replace(/[^A-Za-z0-9._-]/g, '_')}`, data: Buffer.from(clean(tail(l.text, LOG_TAIL_LINES)), 'utf8') })),
  ];
  return buildZip(entries, input.now);
}

export function tail(text: string, lines: number): string {
  const all = text.split(/\r?\n/);
  return all.length <= lines ? text : all.slice(all.length - lines).join('\n');
}

/** Reads *.log files from the data directory's logs folder (never anything else). */
export function readLogs(dataDir: string): { name: string; text: string }[] {
  const dir = join(dataDir, 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}
