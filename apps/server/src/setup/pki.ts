import { X509Certificate } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { restrictAcl } from './acl';

export interface PkiFiles {
  caCert: string;
  caKey: string;
  cert: string;
  key: string;
}

export const pkiPaths = (dataDir: string): PkiFiles => ({
  caCert: join(dataDir, 'pki', 'ca.crt'),
  caKey: join(dataDir, 'pki', 'ca.key'),
  cert: join(dataDir, 'pki', 'server.crt'),
  key: join(dataDir, 'pki', 'server.key'),
});

/** All LAN IPv4 addresses plus loopback. */
export function lanIPv4(): string[] {
  const ips = new Set<string>(['127.0.0.1']);
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) ips.add(a.address);
  return [...ips];
}

const serial = () => '01' + randomBytes(15).toString('hex'); // leading 01 keeps the INTEGER positive

function addYears(from: Date, years: number): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function generateCa(now = new Date(), years = 10): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 3072 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = addYears(now, years);
  const attrs = [{ name: 'commonName', value: 'DDInvoice Local CA' }, { name: 'organizationName', value: 'DDInvoice' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

export function generateServerCert(
  ca: { certPem: string; keyPem: string },
  opts: { hostname: string; ips: string[]; now?: Date; years?: number },
): { certPem: string; keyPem: string } {
  const now = opts.now ?? new Date();
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = addYears(now, opts.years ?? 2);
  cert.setSubject([{ name: 'commonName', value: opts.hostname }, { name: 'organizationName', value: 'DDInvoice' }]);
  cert.setIssuer(caCert.subject.attributes);
  const dns = [...new Set([opts.hostname, 'localhost'])];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [...dns.map((value) => ({ type: 2, value })), ...opts.ips.map((ip) => ({ type: 7, ip }))],
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

export function fingerprint256(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

/** Creates the CA once (10y); (re)issues the server cert (2y). Keys are written ACL-restricted. */
export function ensurePki(dataDir: string, opts: { reissueOnly?: boolean; extraSids?: string[] } = {}): PkiFiles & { caFingerprint: string } {
  const p = pkiPaths(dataDir);
  mkdirSync(join(dataDir, 'pki'), { recursive: true });
  restrictAcl(join(dataDir, 'pki'), opts.extraSids);
  let ca: { certPem: string; keyPem: string };
  try {
    ca = { certPem: readFileSync(p.caCert, 'utf8'), keyPem: readFileSync(p.caKey, 'utf8') };
  } catch {
    if (opts.reissueOnly) throw new Error('CA not found; run install-server first');
    ca = generateCa();
    writeFileSync(p.caCert, ca.certPem);
    writeFileSync(p.caKey, ca.keyPem);
  }
  const server = generateServerCert(ca, { hostname: hostname(), ips: lanIPv4() });
  writeFileSync(p.cert, server.certPem);
  writeFileSync(p.key, server.keyPem);
  return { ...p, caFingerprint: fingerprint256(ca.certPem) };
}
