import { expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';

/** Minimal ZIP reader for tests: central directory → local header → inflate. */
export function readZip(buf: Buffer): Record<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let n = 0; n < count; n++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out[name] = inflateRawSync(buf.subarray(dataStart, dataStart + compSize)).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
