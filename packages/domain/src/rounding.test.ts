import { describe, expect, it } from 'vitest';
import { roundAed } from './rounding';

describe('roundAed', () => {
  it('rounds half-up to 2dp', () => {
    expect(roundAed('1.005').toString()).toBe('1.01');
    expect(roundAed('2.344').toString()).toBe('2.34');
  });
});
