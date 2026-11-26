import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Downloads url to dest (skips when dest already matches sha256); throws on checksum mismatch. */
export async function downloadVerified(url: string, dest: string, sha256: string): Promise<void> {
  if (existsSync(dest) && (await sha256File(dest)) === sha256) return;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const actual = await sha256File(tmp);
  if (actual !== sha256) {
    rmSync(tmp, { force: true });
    throw new Error(`sha256 mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  renameSync(tmp, dest);
}
