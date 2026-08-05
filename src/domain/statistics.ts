/**
 * Descriptive statistics for salary distributions.
 *
 * Two consumers need percentiles and must agree exactly: the analytics SQL,
 * which selects bracketing rows with a window function over 10,000 rows, and
 * these array functions, used on small sets and in tests. So the *index
 * arithmetic* lives here once, in `percentileSelection`, and both call it.
 * Agreement is structural rather than something to remember to maintain.
 */

/**
 * Which elements of a sorted series a percentile falls between.
 *
 * Uses linear interpolation between closest ranks — the same method as Excel's
 * PERCENTILE.INC. That is a deliberate product choice, not just a default: the
 * HR Manager is migrating from spreadsheets and will check these numbers
 * against their old sheet. Matching Excel means the answer looks right.
 *
 * Indices returned are 0-based. SQL callers add 1 for ROW_NUMBER().
 */
export interface PercentileSelection {
  readonly lowerIndex: number;
  readonly upperIndex: number;
  /** How far between the two elements the percentile lies, 0..1. */
  readonly fraction: number;
}

export function percentileSelection(count: number, p: number): PercentileSelection | null {
  if (count <= 0) return null;
  if (p < 0 || p > 1) throw new RangeError(`Percentile must be within 0..1, got ${p}`);
  if (count === 1) return { lowerIndex: 0, upperIndex: 0, fraction: 0 };

  const rank = p * (count - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  return { lowerIndex, upperIndex, fraction: rank - lowerIndex };
}

/** Linear interpolation between the two bracketing values. */
export function interpolate(lower: number, upper: number, fraction: number): number {
  return lower + (upper - lower) * fraction;
}

/** Percentile of an array that is already sorted ascending. */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  const selection = percentileSelection(sortedAscending.length, p);
  if (!selection) return null;

  const lower = sortedAscending[selection.lowerIndex];
  const upper = sortedAscending[selection.upperIndex];
  if (lower === undefined || upper === undefined) return null;

  return interpolate(lower, upper, selection.fraction);
}

/** Median of an already-sorted array. */
export function median(sortedAscending: readonly number[]): number | null {
  return percentile(sortedAscending, 0.5);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export interface DistributionSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
}

/** The five-number-plus summary shown on the analytics screen. */
export function summarise(values: readonly number[]): DistributionSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const average = mean(sorted);
  const p25 = percentile(sorted, 0.25);
  const p50 = percentile(sorted, 0.5);
  const p75 = percentile(sorted, 0.75);
  const p90 = percentile(sorted, 0.9);

  if (
    first === undefined || last === undefined || average === null ||
    p25 === null || p50 === null || p75 === null || p90 === null
  ) {
    return null;
  }

  return { count: sorted.length, min: first, max: last, mean: average, p25, p50, p75, p90 };
}

/**
 * Round a raw interval up to a human-friendly one: 1, 2, 2.5 or 5 times a
 * power of ten. Histogram edges at 47,382 are technically correct and useless
 * to read; edges at 50,000 are what a person expects to see on an axis.
 */
export function niceInterval(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;

  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface HistogramBucket {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
}

/**
 * Bucket edges spanning [min, max] at a readable interval.
 *
 * Returned separately from the counting so the analytics layer can compute
 * edges here and then let SQL do the counting over 10,000 rows — the same
 * split as percentiles.
 */
export function histogramEdges(min: number, max: number, targetBuckets = 12): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];

  // A single distinct value has no range to divide; give it one bucket around itself.
  if (max === min) return [min, min + 1];

  const interval = niceInterval((max - min) / targetBuckets);
  const start = Math.floor(min / interval) * interval;
  const end = Math.ceil(max / interval) * interval;

  const edges: number[] = [];
  // Accumulate by multiplication rather than repeated addition so float drift
  // cannot make the last edge miss `end`.
  const steps = Math.round((end - start) / interval);
  for (let i = 0; i <= steps; i++) edges.push(start + i * interval);

  return edges;
}

/** Count values into buckets. Upper bound is inclusive only for the last bucket. */
export function histogram(values: readonly number[], targetBuckets = 12): HistogramBucket[] {
  if (values.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const edges = histogramEdges(min, max, targetBuckets);
  if (edges.length < 2) return [];

  const counts = new Array<number>(edges.length - 1).fill(0);
  for (const value of values) {
    const index = bucketIndexFor(value, edges);
    if (index !== null) counts[index] = (counts[index] ?? 0) + 1;
  }

  return counts.map((count, i) => ({
    lowerBound: edges[i] as number,
    upperBound: edges[i + 1] as number,
    count,
  }));
}

/** Which bucket a value belongs to, or null if it falls outside the edges. */
export function bucketIndexFor(value: number, edges: readonly number[]): number | null {
  const bucketCount = edges.length - 1;
  if (bucketCount < 1) return null;

  const first = edges[0];
  const last = edges[bucketCount];
  if (first === undefined || last === undefined) return null;
  if (value < first || value > last) return null;

  // The top edge is inclusive, so the maximum value lands in the last bucket
  // rather than in a bucket of its own beyond the end.
  if (value === last) return bucketCount - 1;

  const width = (last - first) / bucketCount;
  return Math.min(bucketCount - 1, Math.floor((value - first) / width));
}
