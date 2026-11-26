import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, sys32, type Ctx } from './exec';
import { pgBin, pgData } from './postgres';

export const SVC_PG = 'DDInvoicePostgres';
export const SVC_API = 'DDInvoiceApi';
export const SVC_WORKER = 'DDInvoiceWorker';
export const FIREWALL_RULE = 'DDInvoice API';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export interface SvcDef {
  id: string;
  description: string;
  executable: string;
  arguments: string;
  env?: Record<string, string>;
  depend?: string;
  stop?: { executable: string; arguments: string };
  /** Postgres refuses to run elevated: it runs as LocalService, the app services as LocalSystem (they read secrets.bin). */
  localService?: boolean;
  logPath: string;
}

/** WinSW 3 config: delayed auto start, restart on failure 3x within 60 s, logs rolled at 10 MB x 10. */
export function winswXml(d: SvcDef): string {
  const env = Object.entries(d.env ?? {}).map(([k, v]) => `  <env name="${esc(k)}" value="${esc(v)}"/>`);
  const restart = Array.from({ length: 3 }, () => '  <onfailure action="restart" delay="5 sec"/>');
  return [
    '<service>',
    `  <id>${d.id}</id>`,
    `  <name>${d.id}</name>`,
    `  <description>${esc(d.description)}</description>`,
    `  <executable>${esc(d.executable)}</executable>`,
    `  <arguments>${esc(d.arguments)}</arguments>`,
    ...env,
    '  <startmode>Automatic</startmode>',
    '  <delayedAutoStart>true</delayedAutoStart>',
    ...(d.depend ? [`  <depend>${d.depend}</depend>`] : []),
    ...restart,
    '  <onfailure action="none"/>',
    '  <resetfailure>60 sec</resetfailure>',
    ...(d.stop ? [`  <stopexecutable>${esc(d.stop.executable)}</stopexecutable>`, `  <stoparguments>${esc(d.stop.arguments)}</stoparguments>`] : []),
    ...(d.localService ? ['  <serviceaccount>', '    <username>NT AUTHORITY\\LocalService</username>', '  </serviceaccount>'] : []),
    `  <logpath>${esc(d.logPath)}</logpath>`,
    '  <log mode="roll-by-size">',
    '    <sizeThreshold>10240</sizeThreshold>',
    '    <keepFiles>10</keepFiles>',
    '  </log>',
    '</service>',
    '',
  ].join('\n');
}

export const nodeExe = (ctx: Pick<Ctx, 'root'>) => join(ctx.root, 'vendor', 'node', 'node.exe');

export function serviceDefs(ctx: Ctx, configPath: string): SvcDef[] {
  const logPath = join(ctx.dataDir, 'logs');
  const env = { NODE_ENV: 'production', DD_CONFIG_PATH: configPath };
  return [
    {
      id: SVC_PG,
      description: 'DDInvoice PostgreSQL 16 (loopback only)',
      executable: pgBin(ctx, 'postgres.exe'),
      arguments: `-D "${pgData(ctx)}"`,
      stop: { executable: pgBin(ctx, 'pg_ctl.exe'), arguments: `stop -m fast -D "${pgData(ctx)}"` },
      localService: true,
      logPath,
    },
    {
      id: SVC_API,
      description: 'DDInvoice local API',
      executable: nodeExe(ctx),
      arguments: `"${join(ctx.root, 'dist', 'server.cjs')}"`,
      env,
      depend: SVC_PG,
      logPath,
    },
    {
      id: SVC_WORKER,
      description: 'DDInvoice outbox worker',
      executable: nodeExe(ctx),
      arguments: `"${join(ctx.root, 'dist', 'worker.cjs')}"`,
      env,
      depend: SVC_PG,
      logPath,
    },
  ];
}

const wrapper = (ctx: Ctx, id: string) => join(ctx.dataDir, 'services', `${id}.exe`);

export function installServices(ctx: Ctx, configPath: string): void {
  mkdirSync(join(ctx.dataDir, 'services'), { recursive: true });
  for (const d of serviceDefs(ctx, configPath)) {
    const exe = wrapper(ctx, d.id);
    copyFileSync(join(ctx.root, 'vendor', 'winsw', 'WinSW-x64.exe'), exe);
    writeFileSync(join(ctx.dataDir, 'services', `${d.id}.xml`), winswXml(d));
    run(exe, ['install']);
  }
}
export function startService(ctx: Ctx, id: string): void {
  run(wrapper(ctx, id), ['start']);
}
export function stopService(ctx: Ctx, id: string): void {
  run(wrapper(ctx, id), ['stop']);
}
export function restartService(ctx: Ctx, id: string): void {
  run(wrapper(ctx, id), ['restart']);
}
export function uninstallServices(ctx: Ctx): void {
  for (const id of [SVC_WORKER, SVC_API, SVC_PG]) {
    const exe = wrapper(ctx, id);
    try { run(exe, ['stop', '--force']); } catch { /* not running */ }
    try { run(exe, ['uninstall']); } catch { /* not installed */ }
  }
}

export function addFirewall(port: number): void {
  run(sys32('netsh.exe'), ['advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`, 'profile=private,domain']);
}
export function removeFirewall(): void {
  try { run(sys32('netsh.exe'), ['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE}`]); } catch { /* absent */ }
}
