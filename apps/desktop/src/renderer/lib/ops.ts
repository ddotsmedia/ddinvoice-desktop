import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Api } from './api';
import { useApi } from './queries';
import { useSession } from './session';

/** Shapes returned by the server's /ops endpoints (apps/server/src/ops). */

export interface HealthReport {
  status: 'ok' | 'degraded';
  services: { api: { state: string }; postgres: { state: string }; worker: { state: string; lastBeatAt: string | null } };
  database: { sizeBytes: number | null };
  disk: { freeGb: number | null; warn: boolean; warnBelowGb: number };
  backup: { lastGoodAt: string | null; lastGoodKind: string | null; stale: boolean; staleAfterHours: number };
  queue: Record<string, number>;
  failedJobs: FailedJob[];
  certificate: { validTo: string; daysLeft: number; warn: boolean } | null;
  versions: { server: string; node: string; platform: string };
  migrations: { applied: number; last: string | null };
  connectedDevices: { deviceName: string; deviceKind: string; lastSeenAt: string | null; ip: string | null }[];
  license: { mode: 'FULL' | 'READ_ONLY'; reason: string | null; seats: number; modules: string[]; expiresAt: string | null; trial: boolean };
  time: string;
}

export interface FailedJob {
  id: string;
  topic: string;
  attempts: number;
  lastError: string | null;
  external: boolean;
  updatedAt: string;
}

export interface BackupRow {
  id: string;
  kind: string;
  target: string;
  status: string;
  at: string;
  [k: string]: unknown;
}

export interface RecoveryState {
  recoveryMode: boolean;
  pending: { id: string; topic: string; status: string; attempts: number; createdAt: string; lastError: string | null }[];
}

export interface LicenseState {
  mode: 'FULL' | 'READ_ONLY';
  reason: string | null;
  seats: number;
  modules: string[];
  expiresAt: string | null;
  trial: boolean;
}

export interface ExportResult {
  folder: string;
  tables: { name: string; rows: number }[];
  documents: number;
}

/** Last good backup older than this shows the workstation banner (spec: > 26 h). */
export const BACKUP_STALE_MS = 26 * 3_600_000;

/** True when there is no good backup or the last one is older than 26 h. */
export function backupIsStale(lastGoodAt: string | null, now: Date): boolean {
  if (!lastGoodAt) return true;
  const at = Date.parse(lastGoodAt);
  return Number.isNaN(at) || now.getTime() - at > BACKUP_STALE_MS;
}

/** Disk free warning threshold (spec: warn below 10 GB). */
export function diskWarn(freeGb: number | null, thresholdGb = 10): boolean {
  return freeGb !== null && freeGb < thresholdGb;
}

/** Human size for DB size and documents. Exact integers only; no money here. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function useOpsHealth(enabled = true) {
  const { api } = useSession();
  return useQuery({
    queryKey: ['ops', 'health'],
    enabled: enabled && !!api,
    queryFn: () => requireApi(api).get<HealthReport>('/ops/health'),
    refetchInterval: 60_000,
  });
}

export function useBackups() {
  const api = useApi();
  return useQuery({ queryKey: ['ops', 'backups'], queryFn: () => api.get<BackupRow[]>('/ops/backups') });
}

export function useRecovery(enabled = true) {
  const { api } = useSession();
  return useQuery({
    queryKey: ['ops', 'recovery'],
    enabled: enabled && !!api,
    queryFn: () => requireApi(api).get<RecoveryState>('/ops/recovery'),
  });
}

export function useLicense(enabled = true) {
  const { api } = useSession();
  return useQuery({
    queryKey: ['ops', 'license'],
    enabled: enabled && !!api,
    queryFn: () => requireApi(api).get<LicenseState>('/ops/license'),
  });
}

/** Queries run only once a session with an API client exists (banners render before pairing finishes in tests). */
function requireApi(api: Api | null | undefined): Api {
  if (!api) throw new Error('Not paired with a server');
  return api;
}

/** Mutations invalidate every ops query so banners and lists agree after a change. */
export function useOpsMutation<TVars, TOut>(run: (api: ReturnType<typeof useApi>, vars: TVars) => Promise<TOut>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => run(api, vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ops'] }),
  });
}

/** Banners in the shell: recovery mode, stale backup, read-only license. Hidden without the permission. */
export function useOpsBanners(now: Date = new Date()) {
  const { permissions } = useSession();
  const canBackup = permissions.has('backup.read');
  const canLicense = permissions.has('license.read');
  const health = useOpsHealth(canBackup);
  const recovery = useRecovery(canBackup);
  const license = useLicense(canLicense);
  return {
    recoveryMode: canBackup && recovery.data?.recoveryMode === true,
    backupStale: canBackup && health.data !== undefined && backupIsStale(health.data.backup.lastGoodAt, now),
    readOnly: canLicense && license.data?.mode === 'READ_ONLY',
  };
}
