import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Ctx {
  root: string; // app root: contains vendor/, dist/ (or the repo)
  dataDir: string;
  pgPort: number;
  port: number;
  service: boolean;
  version: string;
}

export function log(ctx: Pick<Ctx, 'dataDir'>, msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try {
    const f = join(ctx.dataDir, 'logs', 'setup.log');
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, line);
  } catch {
    /* logging must never fail setup */
  }
}

export function run(file: string, args: string[], opts: { env?: Record<string, string>; input?: string; cwd?: string; detachedChild?: boolean } = {}): string {
  return execFileSync(file, args, {
    env: { ...process.env, ...opts.env },
    input: opts.input,
    cwd: opts.cwd,
    encoding: 'utf8',
    // A daemonising child (pg_ctl start) would keep inherited pipes open forever.
    stdio: opts.detachedChild ? 'ignore' : ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** Detached long-running child (process mode); stdout/stderr go to a log file. Returns the pid. */
export function spawnDetached(file: string, args: string[], logFile: string, env: Record<string, string> = {}): number {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, 'a');
  const child = spawn(file, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...env }, windowsHide: true });
  child.unref();
  return child.pid ?? 0;
}

/** Windows system tool by full path (Git's bin dir shadows names like whoami/net on PATH). */
export const sys32 = (exe: string) => `${process.env.SystemRoot ?? 'C:/Windows'}/System32/${exe}`;
