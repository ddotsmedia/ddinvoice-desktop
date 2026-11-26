import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readSecrets, type Secrets } from './secrets';

const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(47820),
  dbUrl: z.string().min(1),
  dataDir: z.string().min(1),
  certPath: z.string().min(1).optional(),
  keyPath: z.string().min(1).optional(),
  companyId: z.uuid(),
  pgPort: z.number().int().min(1).max(65535).default(47821),
  /** DPAPI-encrypted secrets.bin; the DB password and local token are injected at load, never stored in server.json. */
  secretsPath: z.string().min(1).optional(),
  localToken: z.string().min(1).optional(),
  caPath: z.string().min(1).optional(),
  /** Vendored chrome-headless-shell.exe used by the document renderer (installed under the server bundle). */
  chromePath: z.string().min(1).optional(),
  companyName: z.string().min(1).optional(),
  /** Devices must be paired (X-Device-Id header). Only tests/dev may disable. */
  requirePairing: z.boolean().default(true),
});
export type ServerConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): ServerConfig {
  return ConfigSchema.parse(raw);
}

/** Puts the app-role password into dbUrl and exposes the local token. */
export function applySecrets(config: ServerConfig, secrets: Pick<Secrets, 'appPassword' | 'localToken'>): ServerConfig {
  const url = new URL(config.dbUrl);
  url.password = secrets.appPassword;
  return { ...config, dbUrl: url.toString(), localToken: secrets.localToken };
}

/**
 * Production: %PROGRAMDATA%\DDInvoice\server.json (or DD_CONFIG_PATH).
 * Development only: falls back to .env.local (process.loadEnvFile) and DD_* / DATABASE_URL variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, decrypt?: (b64: string) => string): ServerConfig {
  const file = env.DD_CONFIG_PATH ?? join(env.PROGRAMDATA ?? 'C:\\ProgramData', 'DDInvoice', 'server.json');
  if (existsSync(file)) {
    const config = parseConfig(JSON.parse(readFileSync(file, 'utf8')));
    return config.secretsPath ? applySecrets(config, readSecrets(config.secretsPath, decrypt)) : config;
  }
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
    caPath: env.DD_CA_PATH,
    chromePath: env.DD_CHROME_PATH,
    requirePairing: env.DD_REQUIRE_PAIRING !== '0',
  });
}
