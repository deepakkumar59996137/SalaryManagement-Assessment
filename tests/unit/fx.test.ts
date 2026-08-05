import { describe, expect, it } from 'vitest';
import { convertMinor, type FxRateTable, MissingFxRateError, toUsdMinor } from '@/domain/fx';

/** A fixed table with round numbers, so expected values are obvious by inspection. */
const RATES: FxRateTable = {
  USD: 1,
  EUR: 1.25,
  GBP: 2,
  JPY: 0.01,
  INR: 0.0125,
};

describe('convertMinor', () => {
  it('converts between two-decimal currencies', () => {
    // £50,000 at 2 USD per GBP is $100,000.
    expect(convertMinor(5_000_000, 'GBP', 'USD', RATES)).toBe(10_000_000);
  });

  it('converts through USD when neither side is USD', () => {
    // €100 -> $125 -> £62.50
    expect(convertMinor(10_000, 'EUR', 'GBP', RATES)).toBe(6_250);
  });

  it('handles a currency with a different exponent on each side', () => {
    // ¥5,000,000 (exponent 0) at 0.01 is $50,000.00 (exponent 2).
    expect(convertMinor(5_000_000, 'JPY', 'USD', RATES)).toBe(5_000_000);
    expect(convertMinor(5_000_000, 'USD', 'JPY', RATES)).toBe(5_000_000);
  });

  it('returns the input untouched when the currency does not change', () => {
    // Not merely an optimisation — a no-op conversion must not round.
    expect(convertMinor(1, 'JPY', 'JPY', RATES)).toBe(1);
    expect(convertMinor(4_500_017, 'USD', 'USD', {})).toBe(4_500_017);
  });

  it('rounds the result to a whole minor unit', () => {
    // ₹1 -> $0.0125, which is not representable in cents.
    expect(convertMinor(100, 'INR', 'USD', RATES)).toBe(1);
  });

  it('is very nearly symmetric, losing at most a rounding unit on the round trip', () => {
    const original = 4_500_000;
    const roundTrip = convertMinor(
      convertMinor(original, 'USD', 'EUR', RATES),
      'EUR',
      'USD',
      RATES,
    );
    expect(Math.abs(roundTrip - original)).toBeLessThanOrEqual(1);
  });

  it('fails loudly on a missing rate rather than silently treating it as 1:1', () => {
    expect(() => convertMinor(1000, 'BRL', 'USD', RATES)).toThrow(MissingFxRateError);
  });

  it('rejects a nonsensical rate', () => {
    expect(() => convertMinor(1000, 'EUR', 'USD', { EUR: 0, USD: 1 })).toThrow(MissingFxRateError);
  });
});

describe('toUsdMinor', () => {
  it('normalises to USD for cross-country comparison', () => {
    expect(toUsdMinor(5_000_000, 'GBP', RATES)).toBe(10_000_000);
    expect(toUsdMinor(5_000_000, 'USD', RATES)).toBe(5_000_000);
  });
});
