import { describe, expect, it } from 'vitest';
import { clockSkewMs, CLOCK_SKEW_LIMIT_MS, versionGateFor } from './api';

describe('versionGateFor', () => {
  const server = { version: '0.8.0', minClient: '0.8.0' };

  it('is ok when client and server match', () => {
    expect(versionGateFor('0.8.0', server)).toBe('ok');
  });

  it('blocks a client older than minClient', () => {
    expect(versionGateFor('0.7.9', server)).toBe('updateRequired');
  });

  it('asks for a server update when the client is newer than the server', () => {
    expect(versionGateFor('0.9.0', { version: '0.8.0', minClient: '0.7.0' })).toBe('serverNeedsUpdate');
  });

  it('compares numerically, not as text', () => {
    expect(versionGateFor('0.10.0', { version: '0.9.0', minClient: '0.9.0' })).toBe('serverNeedsUpdate');
    expect(versionGateFor('0.9.0', { version: '0.10.0', minClient: '0.10.0' })).toBe('updateRequired');
  });
});

describe('clockSkewMs', () => {
  it('measures local minus server at the request midpoint', () => {
    const serverTime = new Date('2026-11-26T12:00:00.000Z').toISOString();
    const start = Date.parse(serverTime) + 6 * 60_000 - 100;
    const end = start + 200;
    expect(clockSkewMs(serverTime, start, end)).toBe(6 * 60_000);
    expect(Math.abs(clockSkewMs(serverTime, start, end)) > CLOCK_SKEW_LIMIT_MS).toBe(true);
  });

  it('is small for a correct clock', () => {
    const serverTime = '2026-11-26T12:00:00.000Z';
    const t = Date.parse(serverTime);
    expect(Math.abs(clockSkewMs(serverTime, t - 50, t + 50))).toBeLessThan(CLOCK_SKEW_LIMIT_MS);
  });
});
