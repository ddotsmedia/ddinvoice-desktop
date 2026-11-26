import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { downloadVerified } from './lib/download';

export const PG_VERSION = '16.9-1';
export const PG_URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
export const PG_SHA256 = '304eb7dab70717015c4fd09986122e470d53a57a3a2b443d31e2c1d83d88db88';

/** Vendors PostgreSQL 16 Windows x64 binaries into <root>/vendor/pgsql (gitignored). */
export async function fetchPostgres(root = resolve(__dirname, '..', '..')): Promise<string> {
  const target = join(root, 'vendor', 'pgsql');
  if (existsSync(join(target, 'bin', 'postgres.exe'))) return target;
  const zip = join(root, 'vendor', '_dl', `postgresql-${PG_VERSION}.zip`);
  await downloadVerified(PG_URL, zip, PG_SHA256);
  const tmp = join(root, 'vendor', '_pg_extract');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp, 'pgsql/bin', 'pgsql/lib', 'pgsql/share'], { stdio: 'inherit' });
  rmSync(target, { recursive: true, force: true });
  renameSync(join(tmp, 'pgsql'), target);
  rmSync(tmp, { recursive: true, force: true });
  return target;
}

if (require.main === module) fetchPostgres().then((p) => console.log(`PostgreSQL ready: ${p}`));
