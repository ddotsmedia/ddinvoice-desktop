import { describe, expect, it } from 'vitest';
import { ConfigPatchSchema, ConfigSchema } from './ipc';

describe('config schemas', () => {
  it('a partial patch carries only the keys it names (no defaults injected)', () => {
    expect(ConfigPatchSchema.parse({ locale: 'ar' })).toEqual({ locale: 'ar' });
    expect(ConfigPatchSchema.parse({})).toEqual({});
  });

  it('persisted config fills defaults for missing keys', () => {
    const c = ConfigSchema.parse({ locale: 'ar' });
    expect(c).toMatchObject({ locale: 'ar', setupDone: false, role: null, serverOrigin: null });
  });

  it('rejects unknown locales and roles', () => {
    expect(ConfigPatchSchema.safeParse({ locale: 'fr' }).success).toBe(false);
    expect(ConfigPatchSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});
