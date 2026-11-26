import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(47820),
  dbUrl: z.string().min(1),
  dataDir: z.string().min(1),
  certPath: z.string().min(1).optional(),
  keyPath: z.string().min(1).optional(),
  companyId: z.uuid(),
});
export type ServerConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): ServerConfig {
  return ConfigSchema.parse(raw);
}

/**
 * Production: %PROGRAMDATA%\DDInvoice\server.json (or DD_CONFIG_PATH).
 * Development only: falls back to .env.local (process.loadEnvFile) and DD_* / DATABASE_URL variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const file = env.DD_CONFIG_PATH ?? join(env.PROGRAMDATA ?? 'C:\\ProgramData', 'DDInvoice', 'server.json');
  if (existsSync(file)) return parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  if (env.NODE_ENV === 'production') throw new Error(`Server config not found: ${file}`);
  const devEnv = join(process.cwd(), '.env.local');
  if (existsSync(devEnv)) process.loadEnvFile(devEnv);
  return parseConfig({
    port: env.PORT ? Number(env.PORT) : undefined,
    dbUrl: env.DATABASE_URL,
    dataDir: env.DD_DATA_DIR,
    certPath: env.DD_CERT_PATH,
    keyPath: env.DD_KEY_PATH,
    companyId: env.DD_COMPANY_ID,
  });
}
