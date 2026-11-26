import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { sys32 } from './exec';

/**
 * SYSTEM + Administrators only (plus optional extra SIDs). Directories propagate to children via (OI)(CI);
 * those flags on a plain file make icacls drop the grant and leave an empty ACL, so files get plain F.
 */
export function restrictAcl(path: string, extraSids: string[] = []): void {
  if (process.platform !== 'win32') return;
  const flags = statSync(path).isDirectory() ? '(OI)(CI)F' : 'F';
  const args = [path, '/inheritance:r'];
  for (const sid of ['S-1-5-18', 'S-1-5-32-544', ...extraSids]) args.push('/grant:r', `*${sid}:${flags}`);
  execFileSync(sys32('icacls.exe'), args, { stdio: 'ignore' });
}
