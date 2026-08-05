# ADR-0001 — Money as integers in minor units

**Status:** Accepted

## Context

The system stores salaries in ~10 currencies, sums them into payroll totals, converts them to USD, and derives ratios (compa-ratio, pay gap percentages) from them. Every one of those operations is a chance to lose money to floating-point representation.

`0.1 + 0.2 !== 0.3` in IEEE 754. Summing 10,000 salaries stored as `number` in major units accumulates error, and the error is not merely cosmetic: a payroll total that disagrees with the sum of its parts destroys trust in every other number on the screen.

JavaScript adds a second trap — SQLite stores integers as 64-bit, but JS `number` is exact only to 2^53. A salary of ¥12,000,000 is 1.2 × 10⁹ minor units; a 10,000-employee payroll total in JPY minor units is ~10¹³. Comfortably inside 2^53, but not by so much that it can be ignored forever.

## Decision

Store all monetary amounts as **integers in the currency's minor unit** (cents, pence, sen), in SQLite `INTEGER` columns named with a `_minor` suffix.

All arithmetic goes through `domain/money.ts`. No monetary value is ever a float, at rest or in transit. Rounding happens only at explicit, named boundaries — FX conversion and ratio display — using a single `roundHalfUp` helper, never implicitly.

Zero-decimal currencies (JPY, KRW) are handled by a per-currency `exponent`, so "minor unit" means "the smallest unit that currency has" rather than "always ÷100".

## Consequences

**Good.** Sums are exact regardless of row count. Equality comparisons are meaningful. Serialising to JSON is lossless. The rounding policy is one function, so it is tested once and applied everywhere.

**Cost.** Every read for display needs a format step, and every write from a form needs a parse step. Both live in `domain/money.ts` (`toMinor`, `formatMoney`) so the cost is a single import, not scattered conversions.

**Guardrail.** Column naming is the enforcement mechanism: a value called `base_salary_minor` that reaches a template unformatted is visibly wrong (`4500000` rather than `$45,000.00`), so the mistake fails loudly rather than silently.

**Where it does not apply.** FX rates are genuine real numbers and stay `REAL`. Ratios (compa-ratio, gap percentages) are derived values, computed as floats at the point of display and never stored, so they never accumulate.
