/** Pure update rules (no Electron): shared by main and tests. */
export interface UpdateBlockers {
  unsyncedDrafts: number;
  openPayrollRun: boolean;
}

export type UpdateChannel = 'latest' | 'pilot';

const core = (v: string): number[] => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);

/** True when `next` is older than `current` (core semver only; pilot suffix is ignored). */
export function isDowngrade(current: string, next: string): boolean {
  const a = core(current);
  const b = core(next);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) < (a[i] ?? 0);
  }
  return false;
}

/** An update may be installed only with nothing unsynced and no payroll run open. */
export function canInstall(b: UpdateBlockers): boolean {
  return b.unsyncedDrafts === 0 && !b.openPayrollRun;
}

/** Pilot builds (x.y.z-pilot.N) follow the pilot channel; everything else follows latest. DDI_UPDATE_CHANNEL overrides. */
export function channelFor(version: string, override?: string): UpdateChannel {
  if (override === 'pilot' || override === 'latest') return override;
  return version.includes('-pilot') ? 'pilot' : 'latest';
}
