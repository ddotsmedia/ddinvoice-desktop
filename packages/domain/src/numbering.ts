import { DomainError } from './errors';

const TOKEN = /\{(YYYY|YY|MM|DD|SEQ(?::(\d+))?)\}/g;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Format only; allocation is the server's job. */
export function format(pattern: string, seq: number, date: Date): string {
  if (!Number.isInteger(seq) || seq < 0) throw new DomainError('INVALID_SEQ', 'seq must be a non-negative integer');
  return pattern.replace(TOKEN, (_m, t: string, w?: string) => {
    if (t === 'YYYY') return String(date.getUTCFullYear());
    if (t === 'YY') return pad(date.getUTCFullYear() % 100, 2);
    if (t === 'MM') return pad(date.getUTCMonth() + 1, 2);
    if (t === 'DD') return pad(date.getUTCDate(), 2);
    return pad(seq, w ? Number(w) : 1);
  });
}

export interface ParsedNumber {
  seq: number;
  year?: number;
  month?: number;
  day?: number;
}

export function parse(pattern: string, value: string): ParsedNumber | null {
  const kinds: string[] = [];
  let re = '';
  let last = 0;
  for (const m of pattern.matchAll(TOKEN)) {
    re += esc(pattern.slice(last, m.index));
    const t = m[1]!;
    if (t === 'YYYY') {
      re += '(\\d{4})';
      kinds.push('Y4');
    } else if (t === 'YY') {
      re += '(\\d{2})';
      kinds.push('Y2');
    } else if (t === 'MM') {
      re += '(\\d{2})';
      kinds.push('M');
    } else if (t === 'DD') {
      re += '(\\d{2})';
      kinds.push('D');
    } else {
      re += m[2] ? `(\\d{${m[2]},})` : '(\\d+)';
      kinds.push('S');
    }
    last = m.index + m[0].length;
  }
  re += esc(pattern.slice(last));
  const r = new RegExp(`^${re}$`).exec(value);
  if (!r) return null;
  const out: ParsedNumber = { seq: 0 };
  kinds.forEach((k, i) => {
    const v = Number(r[i + 1]);
    if (k === 'S') out.seq = v;
    else if (k === 'Y4') out.year = v;
    else if (k === 'Y2') out.year = 2000 + v;
    else if (k === 'M') out.month = v;
    else out.day = v;
  });
  return out;
}
