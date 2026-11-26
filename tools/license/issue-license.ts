/**
 * VENDOR USE ONLY. Signs a license file for one company.
 *
 *   LICENSE_SIGNING_KEY="$(cat ~/.ddinvoice-vendor/license-signing-ed25519.pem)" \
 *     pnpm exec tsx tools/license/issue-license.ts --company-id <uuid> --company-name "<name>" --trn <15 digits> \
 *     --seats 5 --modules sales,banking,reports --expires 2027-12-31 --out license.ddlic
 *
 * The private key is read from the environment only. It is never written to the repo, the installer, or a log.
 * Omit --expires for a perpetual license (the offline grace rules still apply once online checks exist).
 */
import { writeFileSync } from 'node:fs';
import { LICENSE_MODULES, signLicense, type LicenseModule, type LicensePayload } from '../../apps/server/src/license/license';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  process.stderr.write(`issue-license: ${msg}\n`);
  process.exit(1);
}

const key = process.env.LICENSE_SIGNING_KEY;
if (!key) fail('LICENSE_SIGNING_KEY is not set (PEM of the Ed25519 private key)');

const companyId = arg('company-id') ?? fail('--company-id is required');
const companyName = arg('company-name') ?? fail('--company-name is required');
const trn = arg('trn') ?? fail('--trn is required');
const seats = Number(arg('seats') ?? fail('--seats is required'));
const modules = (arg('modules') ?? LICENSE_MODULES.join(',')).split(',').map((m) => m.trim()).filter(Boolean) as LicenseModule[];
const expires = arg('expires');
const out = arg('out');

const payload: LicensePayload = {
  companyId,
  companyName,
  trn,
  seats,
  modules,
  issuedAt: new Date().toISOString(),
  ...(expires ? { expiresAt: new Date(`${expires}T23:59:59.000Z`).toISOString() } : {}),
};

let text: string;
try {
  text = signLicense(payload, key);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (out) {
  writeFileSync(out, `${text}\n`, 'utf8');
  process.stdout.write(`wrote ${out} (${modules.length} modules, ${seats} seats)\n`);
} else {
  process.stdout.write(`${text}\n`);
}
