import { describe, expect, it } from 'vitest';
import { canInstall, channelFor, isDowngrade } from './update-policy';

describe('update policy', () => {
  it('refuses downgrades, allows same and newer', () => {
    expect(isDowngrade('0.9.1', '0.9.0')).toBe(true);
    expect(isDowngrade('1.0.0', '0.99.9')).toBe(true);
    expect(isDowngrade('0.9.1', '0.9.1')).toBe(false);
    expect(isDowngrade('0.9.1', '0.10.0')).toBe(false);
    expect(isDowngrade('0.9.1', '0.9.2-pilot.3')).toBe(false);
  });
  it('blocks install with unsynced drafts or an open payroll run', () => {
    expect(canInstall({ unsyncedDrafts: 0, openPayrollRun: false })).toBe(true);
    expect(canInstall({ unsyncedDrafts: 1, openPayrollRun: false })).toBe(false);
    expect(canInstall({ unsyncedDrafts: 0, openPayrollRun: true })).toBe(false);
  });
  it('selects the channel', () => {
    expect(channelFor('0.9.1')).toBe('latest');
    expect(channelFor('0.9.1-pilot.4')).toBe('pilot');
    expect(channelFor('0.9.1', 'pilot')).toBe('pilot');
    expect(channelFor('0.9.1-pilot.4', 'bogus')).toBe('pilot');
  });
});
