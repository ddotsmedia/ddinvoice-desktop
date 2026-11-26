import { createBackup, copyToTarget, gcBlobs, HOUR_MS, promote, pruneKind, type BackupDeps, type BackupKind } from './backup';

export interface BackupRecordInput {
  kind: BackupKind;
  target: 'LOCAL' | 'FOLDER';
  path: string;
  sha256: string;
  sizeBytes: number;
  status: 'OK' | 'FAILED';
  at: Date;
}

export interface CycleDeps extends BackupDeps {
  /** Settings > Backup > extra target (folder, USB or network path). Daily archives are copied there. */
  copyDir?: string;
  /** Latest OK LOCAL record of this kind, if any. */
  lastOk(kind: BackupKind): Promise<Date | null>;
  record(r: BackupRecordInput): Promise<void>;
}

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const localMonth = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

/**
 * One scheduler pass (called every minute by the worker). Hourly archive when the last one is over an hour old;
 * the first hourly archive of a local day is also kept as the daily one, and of a month as the monthly one.
 * Returns the kinds written in this pass. A failed dump is recorded as FAILED and rethrown.
 */
export async function runBackupCycle(deps: CycleDeps): Promise<BackupKind[]> {
  const now = deps.now?.() ?? new Date();
  const last = await deps.lastOk('HOURLY');
  if (last && now.getTime() - last.getTime() < HOUR_MS) return [];

  let hourly;
  try {
    hourly = await createBackup(deps, 'HOURLY');
  } catch (e) {
    await deps.record({ kind: 'HOURLY', target: 'LOCAL', path: '', sha256: '', sizeBytes: 0, status: 'FAILED', at: now });
    throw e;
  }
  await deps.record({ kind: 'HOURLY', target: 'LOCAL', path: hourly.file, sha256: hourly.sha256, sizeBytes: hourly.sizeBytes, status: 'OK', at: now });
  const ran: BackupKind[] = ['HOURLY'];

  const lastDaily = await deps.lastOk('DAILY');
  if (!lastDaily || localDay(lastDaily) !== localDay(now)) {
    const dest = promote(hourly.file, deps.root, 'DAILY');
    await deps.record({ kind: 'DAILY', target: 'LOCAL', path: dest, sha256: hourly.sha256, sizeBytes: hourly.sizeBytes, status: 'OK', at: now });
    if (deps.copyDir) {
      const copy = copyToTarget(dest, deps.copyDir);
      await deps.record({ kind: 'DAILY', target: 'FOLDER', path: copy, sha256: hourly.sha256, sizeBytes: hourly.sizeBytes, status: 'OK', at: now });
    }
    ran.push('DAILY');
  }

  const lastMonthly = await deps.lastOk('MONTHLY');
  if (!lastMonthly || localMonth(lastMonthly) !== localMonth(now)) {
    const dest = promote(hourly.file, deps.root, 'MONTHLY');
    await deps.record({ kind: 'MONTHLY', target: 'LOCAL', path: dest, sha256: hourly.sha256, sizeBytes: hourly.sizeBytes, status: 'OK', at: now });
    ran.push('MONTHLY');
  }

  for (const kind of ['HOURLY', 'DAILY', 'MONTHLY'] as const) pruneKind(deps.root, kind);
  gcBlobs(deps.root);
  return ran;
}
