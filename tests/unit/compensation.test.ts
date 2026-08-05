import { describe, expect, it } from 'vitest';
import {
  bandPosition,
  compaRatio,
  costToBandMinimum,
  rangePenetration,
  type SalaryBand,
  summariseAgainstBand,
} from '@/domain/compensation';

/** $80,000 – $100,000 – $120,000, in cents. */
const BAND: SalaryBand = {
  minMinor: 8_000_000,
  midMinor: 10_000_000,
  maxMinor: 12_000_000,
};

describe('compaRatio', () => {
  it('is 1 for someone paid exactly at the midpoint', () => {
    expect(compaRatio(10_000_000, BAND)).toBe(1);
  });

  it('is below 1 under the midpoint and above 1 over it', () => {
    expect(compaRatio(8_000_000, BAND)).toBe(0.8);
    expect(compaRatio(13_000_000, BAND)).toBe(1.3);
  });

  it('is undefined rather than infinite for a band with no midpoint', () => {
    expect(compaRatio(10_000_000, { minMinor: 0, midMinor: 0, maxMinor: 0 })).toBeNull();
  });
});

describe('rangePenetration', () => {
  it('is 0 at the floor, 0.5 at the midpoint and 1 at the ceiling', () => {
    expect(rangePenetration(8_000_000, BAND)).toBe(0);
    expect(rangePenetration(10_000_000, BAND)).toBe(0.5);
    expect(rangePenetration(12_000_000, BAND)).toBe(1);
  });

  it('goes outside 0..1 rather than clamping, because those are the people to find', () => {
    expect(rangePenetration(7_000_000, BAND)).toBe(-0.25);
    expect(rangePenetration(13_000_000, BAND)).toBe(1.25);
  });

  it('is undefined for a band with no width', () => {
    const flat: SalaryBand = { minMinor: 9_000_000, midMinor: 9_000_000, maxMinor: 9_000_000 };
    expect(rangePenetration(9_000_000, flat)).toBeNull();
  });
});

describe('bandPosition', () => {
  it('classifies a salary against its band', () => {
    expect(bandPosition(7_999_999, BAND)).toBe('BELOW');
    expect(bandPosition(10_000_000, BAND)).toBe('WITHIN');
    expect(bandPosition(12_000_001, BAND)).toBe('ABOVE');
  });

  it('treats both bounds as inside the band', () => {
    expect(bandPosition(8_000_000, BAND)).toBe('WITHIN');
    expect(bandPosition(12_000_000, BAND)).toBe('WITHIN');
  });
});

describe('costToBandMinimum', () => {
  it('is what it would take to bring someone up to the floor', () => {
    expect(costToBandMinimum(7_500_000, BAND)).toBe(500_000);
  });

  it('is zero for anyone already at or above the floor', () => {
    expect(costToBandMinimum(8_000_000, BAND)).toBe(0);
    expect(costToBandMinimum(15_000_000, BAND)).toBe(0);
  });
});

describe('summariseAgainstBand', () => {
  it('reports every measure at once for the employee detail screen', () => {
    expect(summariseAgainstBand(7_000_000, BAND)).toEqual({
      compaRatio: 0.7,
      rangePenetration: -0.25,
      position: 'BELOW',
      costToMinimumMinor: 1_000_000,
    });
  });
});
