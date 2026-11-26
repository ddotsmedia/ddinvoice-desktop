import { X509Certificate, type X509Certificate as Cert } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';

export const DISK_WARN_GB = 10;
export const CERT_WARN_DAYS = 30;
/** Worker heartbeat older than this = worker considered down. */
export const WORKER_STALE_MS = 30_000;

export function diskFreeGb(bavail: bigint | number, bsize: bigint | number): number {
  return Math.round((Number(bavail) * Number(bsize)) / 1e9 * 100) / 100;
}

export async function readDiskFreeGb(path: string): Promise<number> {
  const fs = await statfs(path);
  return diskFreeGb(fs.bavail, fs.bsize);
}

export function workerState(dataDir: string, now: Date): { state: 'UP' | 'DOWN'; lastBeatAt: string | null } {
  try {
    const at = statSync(join(dataDir, 'run', 'worker.heartbeat')).mtime;
    return { state: now.getTime() - at.getTime() <= WORKER_STALE_MS ? 'UP' : 'DOWN', lastBeatAt: at.toISOString() };
  } catch {
    return { state: 'DOWN', lastBeatAt: null };
  }
}

export function certificateInfo(certPath: string | undefined, now: Date): { validTo: string; daysLeft: number; warn: boolean } | null {
  if (!certPath) return null;
  let cert: Cert;
  try {
    cert = new X509Certificate(readFileSync(certPath));
  } catch {
    return null;
  }
  const validTo = new Date(cert.validTo);
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  return { validTo: validTo.toISOString(), daysLeft, warn: daysLeft < CERT_WARN_DAYS };
}
