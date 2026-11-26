import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ddinv-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('ddinvoice_test');
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/ddinvoice_test`;
  process.env.DATABASE_URL = url;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
