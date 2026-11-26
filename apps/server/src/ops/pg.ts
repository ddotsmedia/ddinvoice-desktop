import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** Passwords travel in PGPASSWORD, never in argv (argv is visible to other processes on the PC). */
export function connParts(url: string): { args: string[]; env: Record<string, string> } {
  const u = new URL(url);
  const env: Record<string, string> = {};
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const args = ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)];
  return { args, env };
}

export function dbName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Same server and credentials, different database. */
export function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function exec(bin: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin.split(/[\\/]/).pop()} failed: ${(stderr || err.message).trim().split('\n').slice(0, 3).join(' | ')}`));
      else resolve(stdout);
    });
  });
}

const tool = (dir: string, name: string) => join(dir, process.platform === 'win32' ? `${name}.exe` : name);

/** Custom-format dump of one database (owner-independent: --no-owner on restore). */
export async function pgDump(pgBinDir: string, url: string, file: string): Promise<void> {
  const c = connParts(url);
  await exec(tool(pgBinDir, 'pg_dump'), ['-Fc', '--no-owner', ...c.args, '-d', dbName(url), '-f', file], c.env);
}

/** Lists the archive's table of contents; resolves with the number of entries (throws if the file is not a valid dump). */
export async function pgRestoreList(pgBinDir: string, file: string): Promise<number> {
  const out = await exec(tool(pgBinDir, 'pg_restore'), ['--list', file]);
  const entries = out.split('\n').filter((l) => l.trim() && !l.startsWith(';')).length;
  if (entries === 0) throw new Error('pg_restore --list returned no entries');
  return entries;
}

export async function pgRestore(pgBinDir: string, url: string, file: string): Promise<void> {
  const c = connParts(url);
  await exec(tool(pgBinDir, 'pg_restore'), ['--no-owner', '--exit-on-error', ...c.args, '-d', dbName(url), file], c.env);
}
