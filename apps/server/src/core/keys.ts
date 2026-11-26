import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, type CryptoKey } from 'jose';

export interface JwtKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/** Ed25519 pair for access JWTs, stored in dataDir/keys (created on first start). */
export async function loadOrCreateKeys(dataDir: string): Promise<JwtKeys> {
  const dir = join(dataDir, 'keys');
  const privPath = join(dir, 'jwt-ed25519.pem');
  const pubPath = join(dir, 'jwt-ed25519.pub.pem');
  if (!existsSync(privPath) || !existsSync(pubPath)) {
    mkdirSync(dir, { recursive: true });
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    writeFileSync(privPath, await exportPKCS8(privateKey), { mode: 0o600 });
    writeFileSync(pubPath, await exportSPKI(publicKey));
  }
  const privateKey = await importPKCS8(readFileSync(privPath, 'utf8'), 'EdDSA');
  const publicKey = await importSPKI(readFileSync(pubPath, 'utf8'), 'EdDSA');
  return { privateKey, publicKey };
}
