/**
 * Monetary arithmetic.
 *
 * Every amount in this system is an integer in the currency's minor unit
 * (cents, pence, sen). Floating point cannot represent decimal currency
 * exactly, and summing 10,000 salaries as floats accumulates error that makes
 * a payroll total disagree with the sum of its parts.
 *
 * See docs/decisions/0001-money-as-integer-minor-units.md
 *
 * Nothing here performs I/O. Everything is a pure function.
 */

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'INR'
  | 'JPY'
  | 'SGD'
  | 'AUD'
  | 'CAD'
  | 'BRL'
  | 'PLN';

export interface Currency {
  readonly code: CurrencyCode;
  readonly name: string;
  /** Decimal places. JPY has none — one yen is already the smallest unit. */
  readonly exponent: number;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, Currency>> = {
  USD: { code: 'USD', name: 'US Dollar', exponent: 2 },
  EUR: { code: 'EUR', name: 'Euro', exponent: 2 },
  GBP: { code: 'GBP', name: 'Pound Sterling', exponent: 2 },
  INR: { code: 'INR', name: 'Indian Rupee', exponent: 2 },
  JPY: { code: 'JPY', name: 'Japanese Yen', exponent: 0 },
  SGD: { code: 'SGD', name: 'Singapore Dollar', exponent: 2 },
  AUD: { code: 'AUD', name: 'Australian Dollar', exponent: 2 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', exponent: 2 },
  BRL: { code: 'BRL', name: 'Brazilian Real', exponent: 2 },
  PLN: { code: 'PLN', name: 'Polish Zloty', exponent: 2 },
} as const;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyOf(code: CurrencyCode): Currency {
  const currency = CURRENCIES[code];
  if (!currency) throw new Error(`Unknown currency: ${code}`);
  return currency;
}

/** 10^exponent — how many minor units make one major unit. */
export function minorUnitsPerMajor(code: CurrencyCode): number {
  return 10 ** currencyOf(code).exponent;
}

/**
 * Round half away from zero.
 *
 * Deliberately not `Math.round`, which rounds -0.5 to -0 (towards positive
 * infinity) and so treats a raise and an equal-sized cut asymmetrically.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convert a major-unit amount (45000.5) to minor units (4500050). */
export function toMinor(major: number, code: CurrencyCode): number {
  if (!Number.isFinite(major)) throw new Error(`Amount is not a finite number: ${major}`);
  return roundHalfUp(major * minorUnitsPerMajor(code));
}

/**
 * Convert minor units back to major units for display.
 *
 * The result is a float and must not be used for further arithmetic — that is
 * the whole point of storing minor units. Format it and move on.
 */
export function toMajor(minor: number, code: CurrencyCode): number {
  return minor / minorUnitsPerMajor(code);
}

/**
 * Multiply a minor-unit amount by a real factor, rounding to a whole minor unit.
 *
 * Used for FX conversion and percentage raises — the two places where an exact
 * integer necessarily becomes an inexact one, so both round explicitly here
 * rather than wherever the multiplication happened to be written.
 */
export function multiplyMinor(minor: number, factor: number): number {
  if (!Number.isFinite(factor)) throw new Error(`Factor is not a finite number: ${factor}`);
  return roundHalfUp(minor * factor);
}

/** Sum minor-unit amounts. Exact for any input this system can hold. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) total += amount;
  return total;
}

/**
 * Percentage change from `from` to `to`, as a fraction (0.07 = a 7% raise).
 * Returns null when `from` is zero, where the change has no defined percentage.
 */
export function percentChange(fromMinor: number, toMinor_: number): number | null {
  if (fromMinor === 0) return null;
  return (toMinor_ - fromMinor) / Math.abs(fromMinor);
}

export interface FormatMoneyOptions {
  /** Drop the decimal part. Salaries are rarely interesting to the cent. */
  readonly compactDecimals?: boolean;
  /** Abbreviate large figures — 1.2M, 450K. For dashboard tiles. */
  readonly abbreviate?: boolean;
  readonly locale?: string;
}

/**
 * Format a minor-unit amount for display.
 *
 * Locale is pinned to en-US by default rather than taken from the runtime, so
 * that server-rendered and client-rendered output agree and tests are stable.
 */
export function formatMoney(
  minor: number,
  code: CurrencyCode,
  options: FormatMoneyOptions = {},
): string {
  const { compactDecimals = false, abbreviate = false, locale = 'en-US' } = options;
  const currency = currencyOf(code);
  const major = toMajor(minor, code);

  if (abbreviate) {
    const abs = Math.abs(major);
    const [divisor, suffix] =
      abs >= 1_000_000_000 ? [1_000_000_000, 'B']
      : abs >= 1_000_000 ? [1_000_000, 'M']
      : abs >= 1_000 ? [1_000, 'K']
      : [1, ''];

    const scaled = major / divisor;
    const body = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: suffix === '' ? 0 : scaled < 10 ? 1 : 0,
    }).format(scaled);

    return `${body}${suffix}`;
  }

  const fractionDigits = compactDecimals ? 0 : currency.exponent;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}

/** Format a fraction as a percentage string: 0.0723 -> "7.2%". */
export function formatPercent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}
