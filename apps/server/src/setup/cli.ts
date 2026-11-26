import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient, seedDemo } from '@ddinvoice/db';
import { dpapiProtect, readSecrets, type Secrets } from '../secrets';
import { SERVER_VERSION } from '../version';
import { restrictAcl } from './acl';
import { log, run, spawnDetached, sys32, type Ctx } from './exec';
import { migrateWithBackup } from './migrate';
import { ensurePki, fingerprint256, pkiPaths } from './pki';
import {
  APP, OWNER, createRolesAndDb, dbUrl, initCluster, newSecrets, pgBin, pgData, pgDump, pgRestore, regrant, startPgProcess, stopPgProcess,
} from './postgres';
import { SVC_API, SVC_PG, SVC_WORKER, addFirewall, installServices, nodeExe, removeFirewall, restartService, startService, uninstallServices } from './services';

interface Opts {
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArgs(argv: string[]): { command: string; opts: Opts } {
  const [command = 'help', ...rest] = argv;
  const opts: Opts = { flags: new Set(), values: new Map() };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts.values.set(key, next);
      i++;
    } else opts.flags.add(key);
  }
  return { command, opts };
}

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'vendor', 'pgsql')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Cannot locate the application root (vendor/pgsql); pass --app-root');
}

function makeCtx(opts: Opts, service: boolean): Ctx {
  return {
    root: resolve(opts.values.get('app-root') ?? findRoot()),
    dataDir: resolve(opts.values.get('data-dir') ?? join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'DDInvoice')),
    pgPort: Number(opts.values.get('pg-port') ?? 47821),
    port: Number(opts.values.get('port') ?? 47820),
    service,
    version: SERVER_VERSION,
  };
}

const paths = (ctx: Ctx) => ({
  config: join(ctx.dataDir, 'server.json'),
  secrets: join(ctx.dataDir, 'secrets.bin'),
  backups: join(ctx.dataDir, 'backups'),
  run: join(ctx.dataDir, 'run'),
  logs: join(ctx.dataDir, 'logs'),
});

function currentSid(): string {
  const out = execFileSync(sys32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  return out.trim().split(',')[1]!.replace(/"/g, '');
}

function isElevated(): boolean {
  try {
    execFileSync(sys32('net.exe'), ['session'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadSecrets(ctx: Ctx): Secrets {
  return readSecrets(paths(ctx).secrets);
}

function readConfig(ctx: Ctx): { companyId: string; port: number; pgPort: number; service?: boolean; companyName?: string } {
  return JSON.parse(readFileSync(paths(ctx).config, 'utf8')) as never;
}

function pidFile(ctx: Ctx, name: string): string {
  return join(paths(ctx).run, `${name}.pid`);
}

function startApp(ctx: Ctx): void {
  const node = existsSync(nodeExe(ctx)) ? nodeExe(ctx) : process.execPath;
  const env = { NODE_ENV: 'production', DD_CONFIG_PATH: paths(ctx).config };
  mkdirSync(paths(ctx).run, { recursive: true });
  for (const name of ['server', 'worker']) {
    const pid = spawnDetached(node, [join(ctx.root, 'dist', `${name}.cjs`)], join(paths(ctx).logs, `${name}.log`), env);
    writeFileSync(pidFile(ctx, name), String(pid));
  }
}

function stopApp(ctx: Ctx): void {
  for (const name of ['worker', 'server']) {
    const f = pidFile(ctx, name);
    if (!existsSync(f)) continue;
    try {
      execFileSync(sys32('taskkill.exe'), ['/PID', readFileSync(f, 'utf8').trim(), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* already gone */ }
    rmSync(f, { force: true });
  }
}

function httpsGet(ctx: Ctx, path: string, port = ctx.port): Promise<{ status: number; body: string }> {
  const ca = readFileSync(pkiPaths(ctx.dataDir).caCert);
  return new Promise((resolveP, reject) => {
    const req = request({ host: '127.0.0.1', port, path, ca, servername: 'localhost', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString()));
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitHealthy(ctx: Ctx, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await httpsGet(ctx, '/health')).status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error('API did not become healthy in time (see logs/server.log)');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function migrateDeploy(ctx: Ctx, secrets: Secrets): void {
  const prisma = require.resolve('prisma/build/index.js', { paths: [join(ctx.root, 'packages', 'db')] });
  run(process.execPath, [prisma, 'migrate', 'deploy', '--schema', join(ctx.root, 'packages', 'db', 'prisma', 'schema.prisma')], {
    env: { DATABASE_URL: dbUrl(ctx, OWNER, secrets.ownerPassword) },
  });
}

function migrateSafely(ctx: Ctx, secrets: Secrets): boolean {
  const r = migrateWithBackup(ctx.version, paths(ctx).backups, {
    dump: (f) => pgDump(ctx, secrets, f),
    migrate: () => migrateDeploy(ctx, secrets),
    restore: (f) => pgRestore(ctx, secrets, f),
    log: (m) => log(ctx, m),
  });
  if (r.ok) regrant(ctx, secrets);
  return r.ok;
}

async function installServer(opts: Opts): Promise<void> {
  const noService = opts.flags.has('no-service');
  const ctx = makeCtx(opts, !noService);
  const companyName = opts.values.get('company-name');
  const adminEmail = opts.values.get('admin-email');
  if (!companyName || !adminEmail) throw new Error('--company-name and --admin-email are required');
  if (ctx.service && !isElevated()) throw new Error('install-server must run elevated (Administrator); use --no-service for process mode');
  if (existsSync(paths(ctx).config)) throw new Error(`Already installed at ${ctx.dataDir}; run uninstall-server first`);
  for (const f of [pgBin(ctx, 'initdb.exe'), nodeExe(ctx)]) if (!existsSync(f)) throw new Error(`Missing ${f}; run pnpm vendor`);
  if (ctx.service && !existsSync(join(ctx.root, 'vendor', 'winsw', 'WinSW-x64.exe'))) throw new Error('Missing WinSW; run pnpm vendor');

  const p = paths(ctx);
  mkdirSync(ctx.dataDir, { recursive: true });
  for (const d of [p.logs, p.backups, p.run]) mkdirSync(d, { recursive: true });
  // Service mode: SYSTEM + Administrators only (Postgres data additionally LocalService). Process mode: plus the installing user.
  const user = ctx.service ? [] : [currentSid()];
  restrictAcl(p.backups, user);
  restrictAcl(p.run, user);
  restrictAcl(p.logs, user);

  log(ctx, '1/8 secrets');
  const secrets = newSecrets();
  writeFileSync(p.secrets, dpapiProtect(JSON.stringify(secrets)));
  restrictAcl(p.secrets, user);

  log(ctx, '2/8 postgres init');
  initCluster(ctx, secrets, ctx.service ? ['S-1-5-19'] : user);
  startPgProcess(ctx);
  createRolesAndDb(ctx, secrets);

  log(ctx, '3/8 tls');
  const pki = ensurePki(ctx.dataDir, { extraSids: user });

  log(ctx, '4/8 migrate (with pre-migrate backup)');
  if (!migrateSafely(ctx, secrets)) throw new Error('migration failed; see logs/setup.log');

  log(ctx, '5/8 seed company, chart of accounts, admin');
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl(ctx, OWNER, secrets.ownerPassword) } } });
  let companyId: string;
  let adminPassword: string;
  try {
    const r = await seedDemo(prisma, undefined, { legalNameEn: companyName, adminEmail });
    ({ companyId, adminPassword } = r);
  } finally {
    await prisma.$disconnect();
  }

  log(ctx, '6/8 write server.json');
  writeFileSync(
    p.config,
    JSON.stringify(
      {
        port: ctx.port,
        pgPort: ctx.pgPort,
        dbUrl: dbUrl(ctx, APP),
        dataDir: ctx.dataDir,
        certPath: pki.cert,
        keyPath: pki.key,
        caPath: pki.caCert,
        secretsPath: p.secrets,
        companyId,
        companyName,
        requirePairing: true,
        service: ctx.service,
      },
      null,
      2,
    ),
  );
  restrictAcl(p.config, user);

  if (ctx.service) {
    log(ctx, '7/8 firewall + services');
    addFirewall(ctx.port);
    stopPgProcess(ctx);
    installServices(ctx, p.config);
    for (const id of [SVC_PG, SVC_API, SVC_WORKER]) startService(ctx, id);
  } else {
    log(ctx, '7/8 process mode (no services, no firewall)');
    startApp(ctx);
  }

  log(ctx, '8/8 wait for health');
  await waitHealthy(ctx);
  log(ctx, `INSTALLED company=${companyName} companyId=${companyId} port=${ctx.port}`);
  log(ctx, `CA SHA-256 fingerprint: ${pki.caFingerprint}`);
  process.stdout.write(`Admin email: ${adminEmail}\nAdmin password (shown once): ${adminPassword}\n`);
}

async function uninstallServer(opts: Opts): Promise<void> {
  const ctx = makeCtx(opts, false);
  const cfg = existsSync(paths(ctx).config) ? readConfig(ctx) : undefined;
  ctx.pgPort = cfg?.pgPort ?? ctx.pgPort;
  if (cfg?.service) {
    uninstallServices(ctx);
    removeFirewall();
  }
  stopApp(ctx);
  stopPgProcess(ctx);
  if (opts.flags.has('delete-data')) {
    if (!/ddinv/i.test(basename(ctx.dataDir))) throw new Error(`Refusing to delete ${ctx.dataDir}: folder name must contain "ddinv"`);
    rmSync(ctx.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    log({ dataDir: join(process.env.TEMP ?? '.', 'ddinvoice-uninstall') }, `data deleted: ${ctx.dataDir}`);
  } else log(ctx, 'uninstalled; data kept');
}

async function status(opts: Opts): Promise<void> {
  const ctx = makeCtx(opts, false);
  if (!existsSync(paths(ctx).config)) return void process.stdout.write('not installed\n');
  const cfg = readConfig(ctx);
  ctx.port = cfg.port;
  let api = 'down';
  try {
    api = `${(await httpsGet(ctx, '/health')).body}`;
  } catch { /* down */ }
  let pg = 'down';
  try {
    pg = run(pgBin(ctx, 'pg_ctl.exe'), ['status', '-D', pgData(ctx)]).split('\n')[0] ?? 'up';
  } catch { /* down */ }
  const fp = fingerprint256(readFileSync(pkiPaths(ctx.dataDir).caCert, 'utf8'));
  process.stdout.write(`version ${SERVER_VERSION}\ncompany ${cfg.companyName ?? ''} (${cfg.companyId})\npostgres: ${pg}\napi: ${api}\nCA SHA-256: ${fp}\n`);
}

async function migrate(opts: Opts): Promise<void> {
  const ctx = makeCtx(opts, false);
  ctx.pgPort = readConfig(ctx).pgPort;
  if (!migrateSafely(ctx, loadSecrets(ctx))) process.exitCode = 1;
}

async function rotateCert(opts: Opts): Promise<void> {
  const ctx = makeCtx(opts, false);
  const cfg = readConfig(ctx);
  const pki = ensurePki(ctx.dataDir, { reissueOnly: true, extraSids: cfg.service ? [] : [currentSid()] });
  if (cfg.service) restartService(ctx, SVC_API);
  else {
    stopApp(ctx);
    startApp(ctx);
  }
  log(ctx, `server certificate rotated; CA fingerprint unchanged: ${pki.caFingerprint}`);
}

/** Issues a pairing code through the loopback-only endpoint (server screen uses the same call). */
async function pairingCode(opts: Opts): Promise<void> {
  const ctx = makeCtx(opts, false);
  ctx.port = readConfig(ctx).port;
  const token = loadSecrets(ctx).localToken;
  const ca = readFileSync(pkiPaths(ctx.dataDir).caCert);
  const out = await new Promise<string>((resolveP, reject) => {
    const req = request(
      { host: '127.0.0.1', port: ctx.port, path: '/pairing/local-code', method: 'POST', ca, servername: 'localhost', headers: { 'x-local-token': token, 'content-length': 0 } },
      (res) => {
        let b = '';
        res.on('data', (d: Buffer) => (b += d.toString()));
        res.on('end', () => (res.statusCode === 201 || res.statusCode === 200 ? resolveP(b) : reject(new Error(`HTTP ${res.statusCode}: ${b}`))));
      },
    );
    req.on('error', reject);
    req.end();
  });
  process.stdout.write(`${out}\n`);
}

const HELP = `ddinvoice-setup <command> [options]
  install-server --company-name <n> --admin-email <e> [--no-service] [--data-dir <p>] [--port 47820] [--pg-port 47821]
  uninstall-server [--delete-data] [--data-dir <p>]
  status | migrate | rotate-cert | pairing-code   [--data-dir <p>]`;

export async function main(argv: string[]): Promise<void> {
  const { command, opts } = parseArgs(argv);
  switch (command) {
    case 'install-server': return installServer(opts);
    case 'uninstall-server': return uninstallServer(opts);
    case 'status': return status(opts);
    case 'migrate': return migrate(opts);
    case 'rotate-cert': return rotateCert(opts);
    case 'pairing-code': return pairingCode(opts);
    default: process.stdout.write(`${HELP}\n`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e: Error) => {
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(1);
  });
}
