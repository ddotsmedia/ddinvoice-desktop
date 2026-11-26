import { describe, expect, it } from 'vitest';
import { backupIsStale, diskWarn, formatBytes } from './ops';
import { visibleNav } from './nav';

const NOW = new Date('2026-11-26T12:00:00Z');

describe('backup staleness (26 h)', () => {
  it('is stale when no good backup exists', () => {
    expect(backupIsStale(null, NOW)).toBe(true);
  });

  it('is fresh at 25 h and stale after 26 h', () => {
    expect(backupIsStale(new Date(NOW.getTime() - 25 * 3_600_000).toISOString(), NOW)).toBe(false);
    expect(backupIsStale(new Date(NOW.getTime() - 27 * 3_600_000).toISOString(), NOW)).toBe(true);
  });

  it('treats an unreadable timestamp as stale', () => {
    expect(backupIsStale('not-a-date', NOW)).toBe(true);
  });
});

describe('disk warning', () => {
  it('warns below 10 GB only', () => {
    expect(diskWarn(9.9)).toBe(true);
    expect(diskWarn(10)).toBe(false);
    expect(diskWarn(null)).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats units without money arithmetic', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('settings navigation for ops screens', () => {
  it('shows backup screens only to holders of backup.read', () => {
    const names = (perms: string[]) => visibleNav(new Set(perms)).flatMap((s) => s.items.map((i) => i.key));
    expect(names(['backup.read'])).toEqual(expect.arrayContaining(['health', 'backup', 'help']));
    expect(names(['backup.read'])).not.toContain('export');
    expect(names(['backup.export'])).toContain('export');
    expect(names([])).not.toContain('license');
  });
});
