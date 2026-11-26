import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigSchema, type AppConfig, type ConfigPatch, ConfigPatchSchema } from '../shared/ipc';

/** Non-secret settings in userData/config.json. Written atomically; invalid files fall back to defaults. */
export class ConfigStore {
  private readonly file: string;
  private cache: AppConfig | null = null;

  constructor(file = join(app.getPath('userData'), 'config.json')) {
    this.file = file;
  }

  get(): AppConfig {
    if (this.cache) return this.cache;
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      raw = {};
    }
    const parsed = ConfigSchema.safeParse(raw);
    this.cache = parsed.success ? parsed.data : ConfigSchema.parse({});
    return this.cache;
  }

  set(patch: ConfigPatch): AppConfig {
    const valid = ConfigPatchSchema.parse(patch);
    const next = ConfigSchema.parse({ ...this.get(), ...valid });
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, this.file);
    this.cache = next;
    return next;
  }
}
