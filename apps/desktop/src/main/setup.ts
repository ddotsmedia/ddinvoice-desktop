import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { InstallServerResultSchema, type InstallServerInput, type InstallServerResult } from '../shared/ipc';

const run = promisify(execFile);

/** Locations of the bundled server runtime. Overridable for development via env. */
function paths(): { node: string; script: string } {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '..', '..');
  return {
    node: process.env.DDI_NODE ?? join(root, 'vendor', 'node', 'node.exe'),
    script: process.env.DDI_SETUP_SCRIPT ?? join(root, 'dist', 'setup.cjs'),
  };
}

/** True when the installer registered the services but the company is not named yet. */
function isDeferred(): boolean {
  try {
    const f = join(process.env.PROGRAMDATA ?? 'C:\ProgramData', 'DDInvoice', 'server.json');
    return (JSON.parse(readFileSync(f, 'utf8')) as { deferred?: boolean }).deferred === true;
  } catch {
    return false;
  }
}

const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Installs the server. The input (including the admin password) goes to a private temp file, never argv or logs.
 * The CLI runs elevated via Start-Process -Verb RunAs; the file is removed in every case.
 */
export async function installServer(input: InstallServerInput): Promise<InstallServerResult> {
  if (process.platform !== 'win32') throw new Error('Server install is supported on Windows only');
  const { node, script } = paths();
  if (!existsSync(node) || !existsSync(script)) throw new Error('Server runtime is missing from this build');

  const dir = await mkdtemp(join(app.getPath('temp'), 'ddi-setup-'));
  const file = join(dir, 'input.json');
  try {
    await writeFile(file, JSON.stringify(input), { encoding: 'utf8', mode: 0o600 });
    const elevated =
      `$p = Start-Process -FilePath ${psQuote(node)} -ArgumentList @(${psQuote(script)}, '${isDeferred() ? 'configure-server' : 'install-server'}', '--input', ${psQuote(file)}) ` +
      `-Verb RunAs -Wait -WindowStyle Hidden -PassThru; exit $p.ExitCode`;
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevated], { windowsHide: true });
    } catch {
      throw new Error('Server installation was cancelled or failed; see the setup log in ProgramData\DDInvoice\logs');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Pairing code for the first device, from the freshly installed server (not elevated).
  const { stdout } = await run(node, [script, 'pairing-code'], { windowsHide: true });
  const body = JSON.parse(stdout.trim()) as { code?: unknown; caFingerprint?: unknown };
  return InstallServerResultSchema.parse({ pairingCode: body.code, caFingerprint: body.caFingerprint });
}
