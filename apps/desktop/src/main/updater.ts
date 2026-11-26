import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { canInstall, channelFor, isDowngrade, type UpdateBlockers } from '../shared/update-policy';

export const UpdateStateSchema = z.object({
  status: z.enum(['idle', 'checking', 'downloading', 'ready', 'error']),
  version: z.string().nullable(),
  blocked: z.boolean(),
});
export type UpdateState = z.infer<typeof UpdateStateSchema>;

export const BlockersSchema = z.object({ unsyncedDrafts: z.number().int().min(0), openPayrollRun: z.boolean() });

let state: UpdateState = { status: 'idle', version: null, blocked: false };
let blockers: UpdateBlockers = { unsyncedDrafts: 0, openPayrollRun: false };

export const getUpdateState = (): UpdateState => ({ ...state, blocked: !canInstall(blockers) });

export function setBlockers(b: UpdateBlockers): void {
  blockers = b;
  // The quit-time install is only armed while nothing is unsynced and no payroll run is open.
  autoUpdater.autoInstallOnAppQuit = canInstall(b);
}

/** Installs now on user action. Refuses while blocked. */
export function installNow(): boolean {
  if (state.status !== 'ready' || !canInstall(blockers)) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

/** Pilot PCs opt in with {"channel":"pilot"} in %PROGRAMDATA%\DDInvoice\role.json. */
function roleFileChannel(): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(process.env['PROGRAMDATA'] ?? 'C:\ProgramData', 'DDInvoice', 'role.json'), 'utf8')) as { channel?: string }).channel;
  } catch {
    return undefined;
  }
}

/** GitHub provider (ddotsmedia/ddinvoice-desktop); Windows publisher signature is verified via publisherName baked in at build time. */
export function startUpdater(): void {
  if (!app.isPackaged) return;
  const current = app.getVersion();
  const channel = channelFor(current, process.env['DDI_UPDATE_CHANNEL'] ?? roleFileChannel());
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === 'pilot';
  autoUpdater.allowDowngrade = false; // an older exe cannot roll back the database
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => (state = { ...state, status: 'checking' }));
  autoUpdater.on('update-available', (i) => {
    if (isDowngrade(current, i.version)) return;
    state = { ...state, status: 'downloading', version: i.version };
  });
  autoUpdater.on('update-not-available', () => (state = { ...state, status: 'idle' }));
  autoUpdater.on('update-downloaded', (i) => {
    if (isDowngrade(current, i.version)) return;
    state = { ...state, status: 'ready', version: i.version };
    autoUpdater.autoInstallOnAppQuit = canInstall(blockers);
  });
  autoUpdater.on('error', () => (state = { ...state, status: 'error' }));
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 4 * 60 * 60 * 1000).unref();
}
