/**
 * Seeded pseudo-randomness.
 *
 * The seed script uses this exclusively — `Math.random` appears nowhere — so
 * running the seed twice produces a byte-identical database. That matters for
 * three reasons: the deployed demo always looks the same, benchmark numbers are
 * comparable between runs, and a bug found in seeded data can be reproduced.
 */

/**
 * mulberry32: a 32-bit generator that is small, fast and has good enough
 * distribution for generating test data. Not for anything cryptographic.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Weighted<T> {
  readonly value: T;
  readonly weight: number;
}

export class SeededRandom {
  private readonly next01: () => number;
  /** Box-Muller produces two normal deviates at a time; the spare is kept here. */
  private spareNormal: number | null = null;

  constructor(seed: number) {
    this.next01 = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next01() * (max - min + 1));
  }

  bool(probabilityTrue: number): boolean {
    return this.next01() < probabilityTrue;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next01() * items.length)];
    if (item === undefined) throw new Error('Cannot pick from an empty array');
    return item;
  }

  /** Pick proportionally to weight. Weights need not sum to 1. */
  weighted<T>(items: readonly Weighted<T>[]): T {
    let total = 0;
    for (const item of items) total += item.weight;

    let threshold = this.next01() * total;
    for (const item of items) {
      threshold -= item.weight;
      if (threshold <= 0) return item.value;
    }

    // Only reachable through floating-point drift on the final comparison.
    const last = items[items.length - 1];
    if (!last) throw new Error('Cannot pick from an empty weighted list');
    return last.value;
  }

  /** Standard normal deviate, via Box-Muller. */
  private standardNormal(): number {
    if (this.spareNormal !== null) {
      const spare = this.spareNormal;
      this.spareNormal = null;
      return spare;
    }

    // Reject exact zero, which would make log() infinite.
    let u = 0;
    while (u === 0) u = this.next01();
    const v = this.next01();

    const magnitude = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  }

  normal(mean: number, standardDeviation: number): number {
    return mean + this.standardNormal() * standardDeviation;
  }

  /**
   * Log-normal multiplier centred on 1.
   *
   * Salaries within a band are not symmetric — a long right tail of
   * well-paid outliers is the shape real compensation data has, so drawing
   * from a log-normal produces a distribution that looks like the real thing
   * rather than a bell curve.
   */
  logNormalFactor(sigma: number): number {
    return Math.exp(this.standardNormal() * sigma);
  }

  /**
   * A value in [0, 1) that clusters near 0 as `power` rises above 1.
   *
   * Used for "years ago" when generating hire dates: a company that grew to
   * 10,000 people hired most of them recently, so tenure should bunch up near
   * the present rather than spread evenly over a decade.
   */
  skewedTowardsZero(power: number): number {
    return this.next01() ** power;
  }
}
