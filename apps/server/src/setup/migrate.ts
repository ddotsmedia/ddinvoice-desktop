import { join } from 'node:path';

export interface MigrateDeps {
  dump(file: string): void;
  migrate(): void;
  restore(file: string): void;
  log(msg: string): void;
}

/**
 * pg_dump before `migrate deploy`; if the migration fails the dump is restored so the old version keeps working
 * (the API keeps running throughout). Returns ok=false (never throws) so callers can exit non-zero after logging.
 */
export function migrateWithBackup(version: string, backupDir: string, deps: MigrateDeps): { ok: boolean; backup: string } {
  const backup = join(backupDir, `pre-migrate-${version}.dump`);
  deps.dump(backup);
  deps.log(`backup written: ${backup}`);
  try {
    deps.migrate();
    deps.log('migrate deploy: ok');
    return { ok: true, backup };
  } catch (e) {
    deps.log(`migrate deploy FAILED: ${(e as Error).message.split('\n')[0]}; restoring ${backup}`);
    try {
      deps.restore(backup);
      deps.log('restore: ok; previous version remains in service');
    } catch (r) {
      deps.log(`restore FAILED: ${(r as Error).message.split('\n')[0]}; restore manually from ${backup}`);
    }
    return { ok: false, backup };
  }
}
