import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { downloadVerified } from './lib/download';

/** Pinned Chrome for Testing build (Stable 158.0.8127.88). Same build as the other pins below: change all together. */
export const CHROME_VERSION = '158.0.8127.88';
export const CHROME_URL = `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/win64/chrome-headless-shell-win64.zip`;
export const CHROME_SHA256 = 'e935ea2d4633495b5e9ab7bc66bcd982806329c0ee9ecbafc1ac9596a3b34cdb';

/** Vendors chrome-headless-shell (win64) into <root>/vendor/chrome and returns the executable path. */
export async function fetchChrome(root = resolve(__dirname, '..', '..')): Promise<string> {
  const vendor = join(root, 'vendor', 'chrome');
  const zip = join(vendor, 'chrome-headless-shell-win64.zip');
  const exe = join(vendor, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  if (existsSync(exe)) return exe;
  await downloadVerified(CHROME_URL, zip, CHROME_SHA256);
  // Windows bsdtar (System32) reads zip; a GNU tar on PATH would read the drive letter as a host.
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', zip, '-C', vendor], { stdio: 'inherit' });
  if (!existsSync(exe)) throw new Error(`chrome-headless-shell not found after extract: ${exe}`);
  return exe;
}

if (require.main === module) fetchChrome().then((p) => console.log(`Chrome ready: ${p}`));
