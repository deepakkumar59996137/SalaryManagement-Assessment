import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatPercent,
  multiplyMinor,
  percentChange,
  roundHalfUp,
  sumMinor,
  toMajor,
  toMinor,
} from '@/domain/money';

/** Intl inserts non-breaking spaces in some currency formats; compare on content. */
const normalise = (value: string) => value.replace(/ /g, ' ');

describe('roundHalfUp', () => {
  it('rounds halves away from zero in both directions', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it('treats a raise and an equal-sized cut symmetrically, unlike Math.round', () => {
    expect(roundHalfUp(-0.5)).toBe(-roundHalfUp(0.5));
    // Math.round(-0.5) is -0, which would round a cut and a raise differently.
    expect(Math.round(-0.5)).not.toBe(-Math.round(0.5));
  });
});

describe('toMinor / toMajor', () => {
  it('converts two-decimal currencies', () => {
    expect(toMinor(45_000, 'USD')).toBe(4_500_000);
    expect(toMinor(45_000.5, 'USD')).toBe(4_500_050);
    expect(toMajor(4_500_050, 'USD')).toBe(45_000.5);
  });

  it('treats yen as already being in its smallest unit', () => {
    expect(toMinor(5_000_000, 'JPY')).toBe(5_000_000);
    expect(toMajor(5_000_000, 'JPY')).toBe(5_000_000);
  });

  it('round-trips a value that has no exact binary representation', () => {
    expect(toMajor(toMinor(0.1 + 0.2, 'USD'), 'USD')).toBe(0.3);
  });

  it('rejects a non-finite amount rather than storing NaN', () => {
    expect(() => toMinor(Number.NaN, 'USD')).toThrow(/finite/);
    expect(() => toMinor(Number.POSITIVE_INFINITY, 'USD')).toThrow(/finite/);
  });
});

describe('sumMinor', () => {
  it('sums 10,000 salaries exactly, where the float equivalent drifts', () => {
    // This is the entire reason money is stored as integers.
    const salaryMinor = toMinor(45_000.1, 'USD');
    const payroll = Array.from({ length: 10_000 }, () => salaryMinor);

    expect(sumMinor(payroll)).toBe(45_000_100_000);

    const floatPayroll = Array.from({ length: 10_000 }, () => 45_000.1);
    const floatTotal = floatPayroll.reduce((total, value) => total + value, 0);
    expect(floatTotal).not.toBe(450_001_000);
  });

  it('is zero for an empty payroll', () => {
    expect(sumMinor([])).toBe(0);
  });
});

describe('multiplyMinor', () => {
  it('applies a percentage raise and lands on a whole minor unit', () => {
    expect(multiplyMinor(4_500_000, 1.07)).toBe(4_815_000);
  });

  it('rounds rather than truncating a fractional cent', () => {
    expect(multiplyMinor(101, 1.005)).toBe(102);
  });

  it('rejects a non-finite factor', () => {
    expect(() => multiplyMinor(1000, Number.NaN)).toThrow(/finite/);
  });
});

describe('percentChange', () => {
  it('expresses a raise as a fraction', () => {
    expect(percentChange(4_500_000, 4_815_000)).toBeCloseTo(0.07, 10);
  });

  it('is negative for a pay cut', () => {
    expect(percentChange(100_000, 90_000)).toBeCloseTo(-0.1, 10);
  });

  it('has no answer when the starting salary is zero', () => {
    expect(percentChange(0, 100_000)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats to the currency’s own number of decimals', () => {
    expect(normalise(formatMoney(4_500_050, 'USD'))).toBe('$45,000.50');
    expect(normalise(formatMoney(5_000_000, 'JPY'))).toBe('¥5,000,000');
  });

  it('drops decimals on request, since salaries rarely matter to the cent', () => {
    expect(normalise(formatMoney(4_500_050, 'USD', { compactDecimals: true }))).toBe('$45,001');
  });

  it('abbreviates large figures for dashboard tiles', () => {
    expect(normalise(formatMoney(45_000_000_000, 'USD', { abbreviate: true }))).toBe('$450M');
    expect(normalise(formatMoney(4_500_000, 'USD', { abbreviate: true }))).toBe('$45K');
  });

  it('is stable regardless of the machine’s locale', () => {
    expect(formatMoney(4_500_000, 'USD')).toBe(formatMoney(4_500_000, 'USD', { locale: 'en-US' }));
  });
});

describe('formatPercent', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatPercent(0.0723)).toBe('7.2%');
    expect(formatPercent(-0.05, 0)).toBe('-5%');
  });
});
