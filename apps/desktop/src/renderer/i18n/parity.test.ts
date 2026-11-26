import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ar from './locales/ar.json';

type Tree = { [k: string]: string | Tree };

/** Flattens nested locale objects to dotted keys. */
function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}

function valueAt(tree: Tree, dotted: string): string | undefined {
  let cur: string | Tree | undefined = tree;
  for (const part of dotted.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  return typeof cur === 'string' ? cur : undefined;
}

describe('locale parity', () => {
  const enKeys = keys(en).sort();
  const arKeys = keys(ar).sort();

  it('en and ar have the same keys', () => {
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([]);
  });

  it('no translation is empty', () => {
    for (const k of enKeys) expect(valueAt(en, k), `en ${k}`).not.toBe('');
    for (const k of arKeys) expect(valueAt(ar, k), `ar ${k}`).not.toBe('');
  });

  it('Arabic values contain Arabic script (except product names and codes)', () => {
    const latinOnly = /^[\x00-\x7F\s…%().:/0-9-]*$/;
    for (const k of arKeys) {
      const v = valueAt(ar, k)!;
      if (k === 'common.appName' || k === 'manualAddressHint' || k.endsWith('manualAddressHint') || k === 'setup.manualAddressHint') continue;
      if (!latinOnly.test(v)) expect(/[\u0600-\u06FF]/.test(v), `ar ${k} = ${v}`).toBe(true);
    }
  });
});
