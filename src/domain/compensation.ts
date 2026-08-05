/**
 * Compensation maths — how a salary sits against its band.
 *
 * A salary band is the pay range for a (job level, country) pair. These three
 * derived measures are what turn a raw number into something an HR Manager can
 * act on: is this person paid appropriately for their role and market?
 *
 * Pure functions. Salaries are annual base, in minor units of the local currency.
 */

export interface SalaryBand {
  readonly minMinor: number;
  readonly midMinor: number;
  readonly maxMinor: number;
}

export type BandPosition = 'BELOW' | 'WITHIN' | 'ABOVE';

/**
 * Compa-ratio: salary as a proportion of the band midpoint.
 *
 * 1.0 means paid exactly at market reference. Below 0.8 or above 1.2 is
 * conventionally worth a look. Null for a degenerate band with a zero midpoint,
 * where the ratio is undefined rather than infinite.
 */
export function compaRatio(salaryMinor: number, band: SalaryBand): number | null {
  if (band.midMinor <= 0) return null;
  return salaryMinor / band.midMinor;
}

/**
 * Range penetration: position within the band as a fraction.
 *
 * 0 is exactly at the minimum, 1 exactly at the maximum. Values outside [0, 1]
 * are meaningful and deliberately not clamped — they are precisely the people
 * the HR Manager needs to find.
 *
 * Null when the band has no width, where "position within it" says nothing.
 */
export function rangePenetration(salaryMinor: number, band: SalaryBand): number | null {
  const width = band.maxMinor - band.minMinor;
  if (width <= 0) return null;
  return (salaryMinor - band.minMinor) / width;
}

/** Whether a salary falls below, inside, or above its band. Bounds are inclusive. */
export function bandPosition(salaryMinor: number, band: SalaryBand): BandPosition {
  if (salaryMinor < band.minMinor) return 'BELOW';
  if (salaryMinor > band.maxMinor) return 'ABOVE';
  return 'WITHIN';
}

/**
 * What a salary would have to become to reach the band minimum.
 * Zero when already at or above it — the cost of fixing someone who is fine.
 */
export function costToBandMinimum(salaryMinor: number, band: SalaryBand): number {
  return Math.max(0, band.minMinor - salaryMinor);
}

export interface CompaSummary {
  readonly compaRatio: number | null;
  readonly rangePenetration: number | null;
  readonly position: BandPosition;
  readonly costToMinimumMinor: number;
}

/** All band measures at once — what the employee detail screen needs. */
export function summariseAgainstBand(salaryMinor: number, band: SalaryBand): CompaSummary {
  return {
    compaRatio: compaRatio(salaryMinor, band),
    rangePenetration: rangePenetration(salaryMinor, band),
    position: bandPosition(salaryMinor, band),
    costToMinimumMinor: costToBandMinimum(salaryMinor, band),
  };
}
