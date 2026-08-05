/**
 * Currency conversion against a dated rate snapshot.
 *
 * Rates are passed in rather than fetched. That keeps this module pure, makes
 * every conversion reproducible, and means tests supply a fixed table instead
 * of mocking an HTTP client.
 *
 * See docs/decisions/0005-fx-snapshot-not-live-api.md
 */

import {
  type CurrencyCode,
  minorUnitsPerMajor,
  roundHalfUp,
} from './money';

/** How many USD one major unit of the currency buys. USD is 1 by definition. */
export type FxRateTable = Readonly<Partial<Record<CurrencyCode, number>>>;

export class MissingFxRateError extends Error {
  constructor(readonly currency: CurrencyCode) {
    super(`No FX rate for ${currency} in the rate table`);
    this.name = 'MissingFxRateError';
  }
}

function rateFor(code: CurrencyCode, rates: FxRateTable): number {
  const rate = rates[code];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw new MissingFxRateError(code);
  }
  return rate;
}

/**
 * Convert a minor-unit amount between currencies.
 *
 * Goes through major units because the two currencies may have different
 * exponents — converting ¥5,000,000 (exponent 0) to USD (exponent 2) is not a
 * simple multiplication of the minor-unit values.
 *
 * Converting a currency to itself returns the input untouched, so a no-op
 * conversion can never introduce a rounding error.
 */
export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRateTable,
): number {
  if (from === to) return amountMinor;

  const fromMajor = amountMinor / minorUnitsPerMajor(from);
  const usdMajor = fromMajor * rateFor(from, rates);
  const toMajor = usdMajor / rateFor(to, rates);

  return roundHalfUp(toMajor * minorUnitsPerMajor(to));
}

/** Convenience for the common case: normalise to USD for comparison. */
export function toUsdMinor(
  amountMinor: number,
  from: CurrencyCode,
  rates: FxRateTable,
): number {
  return convertMinor(amountMinor, from, 'USD', rates);
}

/**
 * The rate snapshot the application ships with.
 *
 * Approximate mid-market rates, deliberately frozen. Refreshing them means
 * updating the fx_rates table and running scripts/recompute-usd.ts.
 */
export const FX_SNAPSHOT_AS_OF = '2026-01-01';

export const DEFAULT_FX_RATES: FxRateTable = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  INR: 0.012,
  JPY: 0.0067,
  SGD: 0.74,
  AUD: 0.66,
  CAD: 0.73,
  BRL: 0.18,
  PLN: 0.25,
};
