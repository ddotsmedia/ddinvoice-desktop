import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_FORMAT, ARCHIVE_FORMAT_VERSION, packArchive, safeRelativePath, unpackArchive, type ArchiveManifest } from '../src/ops/archive';
import { decodeRecoveryKey, decryptBlob, encodeRecoveryKey, encryptBlob, generateBackupKey } from '../src/ops/crypto';
import { buildSupportBundle } from '../src/ops/support-bundle';
import { buildZip } from '../src/ops/zip';
import { redact } from '../src/ops/redact';
import { csvCell, toCsv } from '../src/ops/export';
import { diskFreeGb } from '../src/ops/health';
import { evaluateLicense, LICENSE_MODULES, LicenseError, OFFLINE_GRACE_MS, parseLicense, signLicense, type LicensePayload } from '../src/license/license';
import { LICENSE_PUBLIC_KEY_PEM } from '../src/license/license-public-key';
import { readZip } from './zip-reader';

describe('backup crypto', () => {
  it('round-trips and rejects a wrong key or a modified blob', () => {
    const key = generateBackupKey();
    const blob = encryptBlob(key, Buffer.from('hello ledger'));
    expect(decryptBlob(key, blob).toString()).toBe('hello ledger');
    expect(() => decryptBlob(generateBackupKey(), blob)).toThrow(/wrong recovery key|modified/);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptBlob(key, tampered)).toThrow(/modified/);
  });

  it('recovery key is printable and decodes to the same 32 bytes', () => {
    const key = generateBackupKey();
    const text = encodeRecoveryKey(key);
    expect(text).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){12}$/);
    expect(decodeRecoveryKey(text.toLowerCase().replace(/-/g, ' '))).toEqual(key);
    expect(() => decodeRecoveryKey('ABCD-EF')).toThrow(/wrong length/);
  });
});

describe('archive format', () => {
  it('packs manifest and dump, and refuses unknown formats', () => {
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      createdAt: new Date(0).toISOString(),
      serverVersion: '0.9.0',
      companyId: '00000000-0000-4000-8000-000000000000',
      dumpSha256: 'x',
      dumpBytes: 3,
      counts: { Invoice: 2 },
      trialBalance: [],
      documents: [],
    };
    const dump = Buffer.from([1, 2, 3]);
    const round = unpackArchive(packArchive(manifest, dump));
    expect(round.manifest.counts).toEqual({ Invoice: 2 });
    expect(round.dump).toEqual(dump);
    expect(() => unpackArchive(packArchive({ ...manifest, format: 'other' as never }, dump))).toThrow(/Unsupported/);
  });

  it('document paths cannot escape the data directory', () => {
    expect(safeRelativePath('documents/2026/INV/a.pdf')).toBe('documents/2026/INV/a.pdf');
    expect(() => safeRelativePath('../secrets.bin')).toThrow(/Unsafe/);
    expect(() => safeRelativePath('C:/Windows/x')).toThrow(/Unsafe/);
    expect(() => safeRelativePath('/etc/passwd')).toThrow(/Unsafe/);
  });
});

describe('zip writer', () => {
  it('writes entries a standard reader can extract', () => {
    const zip = buildZip([
      { name: 'README.txt', data: Buffer.from('hi there') },
      { name: 'logs/server.log', data: Buffer.from('line 1\nline 2\n'.repeat(50)) },
    ]);
    const files = readZip(zip);
    expect(files['README.txt']).toBe('hi there');
    expect(files['logs/server.log']).toBe('line 1\nline 2\n'.repeat(50));
  });
});

describe('support bundle redaction', () => {
  it('removes tokens, passwords, e-mails, IBANs and customer names', () => {
    const line =
      'POST /auth/login password=Sup3rSecret! Authorization: Bearer abc.def.ghi ' +
      'token eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln refresh_token: abcdef123456 ' +
      'mail ceo@acme-trading.ae iban AE070331234567890123456 customer Zanzibar Trading LLC paid';
    const out = redact(line, ['Zanzibar Trading LLC']);
    for (const secret of ['Sup3rSecret', 'abc.def.ghi', 'eyJhbGciOi', 'abcdef123456', 'ceo@acme', 'AE070331234567890123456', 'Zanzibar']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('paid');
    expect(out).toContain('[REDACTED-EMAIL]');
    expect(out).toContain('[REDACTED-IBAN]');
  });

  it('bundle contains versions, health, migrations and redacted logs, never a database dump', () => {
    const zip = buildSupportBundle({
      versions: { server: '0.9.0' },
      health: { status: 'ok' },
      migrations: [{ name: '20261126000200_ops_recovery_mode', finishedAt: null }],
      logs: [{ name: 'server.log', text: 'owner a@b.ae token=xyz987 customer Zanzibar Trading LLC' }],
      names: ['Zanzibar Trading LLC'],
      now: new Date('2026-11-26T10:00:00Z'),
    });
    const files = readZip(zip);
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'health.json', 'logs/server.log', 'migrations.json', 'versions.json']);
    const everything = Object.values(files).join('\n');
    expect(everything).not.toMatch(/xyz987|a@b\.ae|Zanzibar/);
    expect(everything).toContain('[REDACTED-NAME]');
  });
});

describe('CSV export helpers', () => {
  it('quotes cells with commas, quotes and newlines; null is empty', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['id', 'note'], [{ id: '1', note: 'x\ny' }])).toBe('id,note\r\n1,"x\ny"\r\n');
  });
});

describe('health helpers', () => {
  it('computes disk free in GB and the 10 GB threshold input', () => {
    expect(diskFreeGb(BigInt(25e9), 1)).toBe(25);
  });
});

describe('license', () => {
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const payload: LicensePayload = {
    companyId: '00000000-0000-4000-8000-000000000001',
    companyName: 'Demo Trading LLC',
    trn: '100000000000003',
    seats: 5,
    modules: ['sales', 'banking'],
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-11-01T00:00:00.000Z',
  };

  it('accepts a license signed with the vendor key', () => {
    const text = signLicense(payload, privatePem);
    // Embedded key is the production key; test uses its own pair for the valid path.
    expect(parseLicense(text, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())).toEqual(payload);
  });

  it('rejects a tampered payload (seats raised) and a license signed by another key', () => {
    const text = signLicense(payload, privatePem);
    const [prefix, body, sig] = text.split('.');
    const forged = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as LicensePayload;
    forged.seats = 500;
    const tamperedText = [prefix, Buffer.from(JSON.stringify(forged)).toString('base64url'), sig].join('.');
    const pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => parseLicense(tamperedText, pub)).toThrow(LicenseError);
    expect(() => parseLicense(text)).toThrow(/signature/); // embedded key does not match the test pair
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => parseLicense(signLicense(payload, other), pub)).toThrow(/signature/);
  });

  it('the embedded public key parses as Ed25519', () => {
    expect(LICENSE_PUBLIC_KEY_PEM).toContain('BEGIN PUBLIC KEY');
    expect(() => parseLicense('DDL1.e30.e30', LICENSE_PUBLIC_KEY_PEM)).toThrow(/signature/);
  });

  it('expired license is read-only; within term is full', () => {
    const before = new Date('2027-10-01T00:00:00.000Z');
    const after = new Date('2027-11-02T00:00:00.000Z');
    expect(evaluateLicense(payload, before).mode).toBe('FULL');
    expect(evaluateLicense(payload, after)).toMatchObject({ mode: 'READ_ONLY', reason: 'EXPIRED' });
  });

  it('offline grace of 30 days applies once an online validation exists', () => {
    const last = new Date('2026-11-01T00:00:00.000Z');
    const within = new Date(last.getTime() + OFFLINE_GRACE_MS - 1000);
    const beyond = new Date(last.getTime() + OFFLINE_GRACE_MS + 1000);
    expect(evaluateLicense({ ...payload, expiresAt: undefined }, within, { lastValidatedAt: last }).mode).toBe('FULL');
    expect(evaluateLicense({ ...payload, expiresAt: undefined }, beyond, { lastValidatedAt: last })).toMatchObject({ reason: 'OFFLINE_GRACE' });
  });

  it('no license or an invalid one is read-only with zero seats', () => {
    expect(evaluateLicense(undefined, new Date())).toMatchObject({ mode: 'READ_ONLY', reason: 'NO_LICENSE', seats: 0 });
    expect(evaluateLicense(undefined, new Date(), { invalid: true })).toMatchObject({ reason: 'INVALID' });
  });

  it('module list is the spec list', () => {
    expect(LICENSE_MODULES).toEqual(['sales', 'purchases', 'banking', 'reports', 'payroll', 'einvoice', 'sync']);
  });
});

describe('restore helpers', () => {
  it('a random 32-byte key always round-trips through the recovery key text', () => {
    const k = randomBytes(32);
    expect(decodeRecoveryKey(encodeRecoveryKey(k))).toEqual(k);
  });
});
