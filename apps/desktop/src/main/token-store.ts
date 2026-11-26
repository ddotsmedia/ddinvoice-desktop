import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TokensSchema, type Tokens } from '../shared/ipc';

/** Session tokens encrypted with safeStorage (DPAPI on Windows). Refuses to write plaintext. */
export class TokenStore {
  constructor(private readonly file = join(app.getPath('userData'), 'session.bin')) {}

  load(): Tokens | null {
    let buf: Buffer;
    try {
      buf = readFileSync(this.file);
    } catch {
      return null;
    }
    try {
      const parsed = TokensSchema.safeParse(JSON.parse(this.decrypt(buf)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  store(tokens: Tokens): void {
    const valid = TokensSchema.parse(tokens);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, this.encrypt(JSON.stringify(valid)));
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private encrypt(text: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable; refusing to store tokens');
    return safeStorage.encryptString(text);
  }

  private decrypt(buf: Buffer): string {
    return safeStorage.decryptString(buf);
  }
}
