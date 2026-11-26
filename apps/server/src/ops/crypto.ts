import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Backup blob layout: "DDBK" | version (1) | iv (12) | tag (16) | ciphertext. AES-256-GCM, whole buffer. */
const MAGIC = Buffer.from('DDBK', 'ascii');
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES + TAG_BYTES;
export const KEY_BYTES = 32;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBackupKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function encryptBlob(key: Buffer, plain: Buffer): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Throws a generic error when the key is wrong or the blob was modified (GCM tag mismatch). */
export function decryptBlob(key: Buffer, blob: Buffer): Buffer {
  assertKey(key);
  if (blob.length < HEADER_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC) || blob[MAGIC.length] !== VERSION) {
    throw new Error('Not a DDInvoice backup file');
  }
  const iv = blob.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES);
  const tag = blob.subarray(MAGIC.length + 1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error('Backup could not be decrypted: wrong recovery key or the file was modified');
  }
}

/** Printable recovery key: RFC 4648 base32 of the 32 key bytes, in groups of 4 (52 characters). */
export function encodeRecoveryKey(key: Buffer): string {
  assertKey(key);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeRecoveryKey(text: string): Buffer {
  const clean = text.replace(/[\s-]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Recovery key contains invalid characters');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const key = Buffer.from(bytes.slice(0, KEY_BYTES));
  if (key.length !== KEY_BYTES) throw new Error('Recovery key has the wrong length');
  return key;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error('Backup key must be 32 bytes');
}
