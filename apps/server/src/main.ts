import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadConfig } from './config';
import { setupOpenApi } from './openapi';
import { advertise } from './discovery';

async function main(): Promise<void> {
  const config = loadConfig();
  const production = process.env.NODE_ENV === 'production';
  const tls = config.certPath && config.keyPath
    ? { cert: readFileSync(config.certPath), key: readFileSync(config.keyPath) }
    : undefined;
  if (production && !tls) throw new Error('certPath and keyPath are required in production (HTTPS only)');

  const app = await createApp(config, { httpsOptions: tls });
  if (process.env.NODE_ENV === 'development') setupOpenApi(app);
  await app.listen(config.port, '0.0.0.0');
  try {
    const stop = advertise(config);
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (e) {
    Logger.warn(`mDNS advertise failed: ${(e as Error).message}`, 'Discovery');
  }
  Logger.log(`DDInvoice Local API on ${tls ? 'https' : 'http'}://0.0.0.0:${config.port}`, 'Bootstrap');
}

void main();
