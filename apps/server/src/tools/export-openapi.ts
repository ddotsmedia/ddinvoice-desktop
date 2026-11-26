import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.factory';
import { buildOpenApiDocument } from '../openapi';
import { parseConfig } from '../config';

/** Writes openapi.json for client generation (no listening socket, no DB calls). */
async function main(): Promise<void> {
  const config = parseConfig({
    port: 47820,
    dbUrl: 'postgresql://unused@127.0.0.1:5432/unused',
    dataDir: mkdtempSync(join(tmpdir(), 'ddinv-openapi-')),
    companyId: '00000000-0000-4000-8000-000000000000',
  });
  const app = await createApp(config, { logger: false });
  await app.init();
  const doc = buildOpenApiDocument(app);
  await app.close();
  writeFileSync(join(process.cwd(), 'openapi.json'), JSON.stringify(doc, null, 2));
}

void main();
