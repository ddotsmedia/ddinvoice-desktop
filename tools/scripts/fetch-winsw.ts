import { resolve, join } from 'node:path';
import { downloadVerified } from './lib/download';

export const WINSW_VERSION = '3.0.0-alpha.11';
export const WINSW_URL = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}/WinSW-x64.exe`;
export const WINSW_SHA256 = 'a2daa6a33a9c2b791ae31d9092e7935c339d1e03e89bfb747618ce2f4e819e20';

/** Vendors the pinned WinSW 3 service wrapper into <root>/vendor/winsw. */
export async function fetchWinsw(root = resolve(__dirname, '..', '..')): Promise<string> {
  const dest = join(root, 'vendor', 'winsw', 'WinSW-x64.exe');
  await downloadVerified(WINSW_URL, dest, WINSW_SHA256);
  return dest;
}

if (require.main === module) fetchWinsw().then((p) => console.log(`WinSW ready: ${p}`));
