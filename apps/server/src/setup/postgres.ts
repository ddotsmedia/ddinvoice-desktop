import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { restrictAcl } from './acl';
import { run, type Ctx } from './exec';
import type { Secrets } from '../secrets';
import { generateBackupKey } from '../ops/crypto';

export const OWNER = 'ddinvoice_owner';
export const APP = 'ddinvoice_app';
export const DB = 'ddinvoice';

export const newSecret = () => randomBytes(32).toString('base64url');
export function newSecrets(): Secrets {
  return {
    postgresPassword: newSecret(),
    ownerPassword: newSecret(),
    appPassword: newSecret(),
    localToken: newSecret(),
    backupKey: generateBackupKey().toString('base64url'),
  };
}

export const pgBin = (ctx: Pick<Ctx, 'root'>, exe: string) => join(ctx.root, 'vendor', 'pgsql', 'bin', exe);
export const pgData = (ctx: Pick<Ctx, 'dataDir'>) => join(ctx.dataDir, 'pgdata');

export function dbUrl(ctx: Pick<Ctx, 'pgPort'>, user: string, password?: string): string {
  const u = new URL(`postgresql://127.0.0.1:${ctx.pgPort}/${DB}`);
  u.username = user;
  if (password) u.password = password;
  return u.toString();
}

/** conf: loopback listen, pinned port, 256MB buffers. hba: loopback scram only. */
export function postgresConf(port: number): string {
  return `\n# DDInvoice\nlisten_addresses = '127.0.0.1'\nport = ${port}\nshared_buffers = 256MB\npassword_encryption = 'scram-sha-256'\n`;
}
export const PG_HBA = '# DDInvoice: loopback scram-sha-256 only\nhost all all 127.0.0.1/32 scram-sha-256\n';

export function initCluster(ctx: Ctx, secrets: Secrets, extraSids: string[]): void {
  const data = pgData(ctx);
  if (existsSync(join(data, 'PG_VERSION'))) return;
  mkdirSync(join(ctx.dataDir, 'run'), { recursive: true });
  const pwfile = join(ctx.dataDir, 'run', 'pg.pw');
  writeFileSync(pwfile, secrets.postgresPassword);
  try {
    run(pgBin(ctx, 'initdb.exe'), ['-D', data, '--auth=scram-sha-256', '--encoding=UTF8', '-U', 'postgres', `--pwfile=${pwfile}`]);
  } finally {
    rmSync(pwfile, { force: true });
  }
  appendFileSync(join(data, 'postgresql.conf'), postgresConf(ctx.pgPort));
  writeFileSync(join(data, 'pg_hba.conf'), PG_HBA);
  restrictAcl(data, extraSids);
}

export function startPgProcess(ctx: Ctx): void {
  mkdirSync(join(ctx.dataDir, 'logs'), { recursive: true });
  run(pgBin(ctx, 'pg_ctl.exe'), ['start', '-w', '-t', '60', '-D', pgData(ctx), '-l', join(ctx.dataDir, 'logs', 'postgres.log')], {
    detachedChild: true,
  });
}
export function stopPgProcess(ctx: Ctx): void {
  if (existsSync(join(pgData(ctx), 'postmaster.pid'))) run(pgBin(ctx, 'pg_ctl.exe'), ['stop', '-m', 'fast', '-w', '-D', pgData(ctx)]);
}

export function psql(ctx: Ctx, sql: string, secrets: Secrets, db = 'postgres'): string {
  return run(
    pgBin(ctx, 'psql.exe'),
    ['-h', '127.0.0.1', '-p', String(ctx.pgPort), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', '-'],
    { env: { PGPASSWORD: secrets.postgresPassword }, input: sql },
  );
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Owner runs migrations; app gets DML only (default privileges cover future tables). */
export function createRolesAndDb(ctx: Ctx, secrets: Secrets): void {
  psql(
    ctx,
    `CREATE ROLE ${OWNER} LOGIN PASSWORD ${lit(secrets.ownerPassword)};
CREATE ROLE ${APP} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${lit(secrets.appPassword)};
CREATE DATABASE ${DB} OWNER ${OWNER} ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE ${DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${DB} TO ${APP};`,
    secrets,
  );
  psql(
    ctx,
    `REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ${OWNER};
GRANT USAGE ON SCHEMA public TO ${APP};
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP};
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP};`,
    secrets,
    DB,
  );
}

/** Re-grant after migrations (belt and braces next to the default privileges). */
export function regrant(ctx: Ctx, secrets: Secrets): void {
  psql(
    ctx,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP};`,
    secrets,
    DB,
  );
}

export function pgDump(ctx: Ctx, secrets: Secrets, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  run(pgBin(ctx, 'pg_dump.exe'), ['-Fc', '-h', '127.0.0.1', '-p', String(ctx.pgPort), '-U', OWNER, '-d', DB, '-f', file], {
    env: { PGPASSWORD: secrets.ownerPassword },
  });
}
export function pgRestore(ctx: Ctx, secrets: Secrets, file: string): void {
  run(
    pgBin(ctx, 'pg_restore.exe'),
    ['--clean', '--if-exists', '--no-owner', '-h', '127.0.0.1', '-p', String(ctx.pgPort), '-U', OWNER, '-d', DB, file],
    { env: { PGPASSWORD: secrets.ownerPassword } },
  );
}
