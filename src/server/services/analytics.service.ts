import { addYears, type Clock, startOfQuarter, systemClock } from '@/domain/dates';
import {
  likeForLikeFromSummaries,
  type LikeForLikeResult,
  type PayGap,
  payGapFrom,
} from '@/domain/pay-equity';
import { histogramEdges, type HistogramBucket } from '@/domain/statistics';
import type { RawDatabase } from '../db/client';
import {
  type AnalyticsFilters,
  type BandSummary,
  type BreakdownRow,
  getBandOutliers,
  getBandSummary,
  getBreakdown,
  getCohortStats,
  getGenderStats,
  getHistogram,
  getOverview,
  getPayrollTrend,
  getPercentiles,
  getRepresentationByLevel,
  type OutlierRow,
  type RepresentationRow,
  type TrendPoint,
} from '../repositories/analytics.repository';

/**
 * The answers to "how does this organisation pay people".
 *
 * Composition only — every figure is aggregated by the database, and every
 * derived measure comes from a pure function in src/domain. Nothing is
 * calculated twice in two places.
 */

export const PERCENTILES = [0.25, 0.5, 0.75, 0.9] as const;

export interface HeadlineFigures {
  readonly headcount: number;
  readonly totalAnnualUsdMinor: number;
  readonly meanUsdMinor: number | null;
  readonly medianUsdMinor: number | null;
  readonly countryCount: number;
  readonly bands: BandSummary;
  /** Unadjusted median gap — the headline number, with all its caveats. */
  readonly medianGenderGap: number | null;
}

export function getHeadlineFigures(
  db: RawDatabase,
  filters: AnalyticsFilters = {},
): HeadlineFigures {
  const overview = getOverview(db, filters);
  const percentiles = getPercentiles(db, [0.5], filters);
  const gap = getUnadjustedGap(db, filters);

  return {
    headcount: overview.headcount,
    totalAnnualUsdMinor: overview.totalAnnualUsdMinor,
    meanUsdMinor: overview.meanUsdMinor,
    medianUsdMinor: percentiles.get(0.5) ?? null,
    countryCount: overview.countryCount,
    bands: getBandSummary(db, filters),
    medianGenderGap: gap.medianGap,
  };
}

export interface Distribution {
  readonly count: number;
  readonly minUsdMinor: number | null;
  readonly maxUsdMinor: number | null;
  readonly meanUsdMinor: number | null;
  readonly p25UsdMinor: number | null;
  readonly p50UsdMinor: number | null;
  readonly p75UsdMinor: number | null;
  readonly p90UsdMinor: number | null;
  readonly buckets: readonly HistogramBucket[];
}

/**
 * The shape of the salary distribution.
 *
 * Bucket edges are chosen in JavaScript — a readable interval needs the min and
 * max, and rounding to a human-friendly step is presentation logic — but the
 * counting happens in SQL over all ten thousand rows.
 */
export function getDistribution(db: RawDatabase, filters: AnalyticsFilters = {}): Distribution {
  const overview = getOverview(db, filters);
  const percentiles = getPercentiles(db, PERCENTILES, filters);

  const empty = overview.headcount === 0 || overview.minUsdMinor === null || overview.maxUsdMinor === null;
  // Ask for more buckets than are wanted: niceInterval rounds the step up to a
  // readable number, which usually lands the real count somewhat lower.
  const edges = empty ? [] : histogramEdges(overview.minUsdMinor!, overview.maxUsdMinor!, 20);
  const counts = edges.length > 1 ? getHistogram(db, edges, filters) : [];

  return {
    count: overview.headcount,
    minUsdMinor: overview.minUsdMinor,
    maxUsdMinor: overview.maxUsdMinor,
    meanUsdMinor: overview.meanUsdMinor,
    p25UsdMinor: percentiles.get(0.25) ?? null,
    p50UsdMinor: percentiles.get(0.5) ?? null,
    p75UsdMinor: percentiles.get(0.75) ?? null,
    p90UsdMinor: percentiles.get(0.9) ?? null,
    buckets: counts.map((count, index) => ({
      lowerBound: edges[index]!,
      upperBound: edges[index + 1]!,
      count,
    })),
  };
}

export interface Breakdowns {
  readonly country: readonly BreakdownRow[];
  readonly department: readonly BreakdownRow[];
  readonly level: readonly BreakdownRow[];
}

export function getBreakdowns(db: RawDatabase, filters: AnalyticsFilters = {}): Breakdowns {
  return {
    country: getBreakdown(db, 'country', filters),
    department: getBreakdown(db, 'department', filters),
    level: getBreakdown(db, 'level', filters),
  };
}

// ---------------------------------------------------------------------------
// Pay equity
// ---------------------------------------------------------------------------

function getUnadjustedGap(db: RawDatabase, filters: AnalyticsFilters): PayGap {
  const stats = getGenderStats(db, filters);
  const find = (gender: string) => stats.find((row) => row.gender === gender);

  const male = find('MALE');
  const female = find('FEMALE');

  return payGapFrom({
    maleMedian: male?.medianUsdMinor ?? null,
    femaleMedian: female?.medianUsdMinor ?? null,
    maleMean: male?.meanUsdMinor ?? null,
    femaleMean: female?.meanUsdMinor ?? null,
    maleCount: male?.headcount ?? 0,
    femaleCount: female?.headcount ?? 0,
  });
}

export interface PayEquityReport {
  readonly unadjusted: PayGap;
  readonly likeForLike: LikeForLikeResult;
  readonly representation: readonly RepresentationRow[];
  /** Employees excluded from the binary comparison but present in headcount. */
  readonly notComparedHeadcount: number;
}

/**
 * Both gap figures, side by side.
 *
 * Reporting only the unadjusted number would point at the wrong remedy. A wide
 * unadjusted gap beside a narrow like-for-like gap is a representation problem
 * — who gets hired and promoted into which levels — and no amount of adjusting
 * individual salaries fixes it. The representation table underneath is the
 * evidence for that reading.
 */
export function getPayEquity(db: RawDatabase, filters: AnalyticsFilters = {}): PayEquityReport {
  const unadjusted = getUnadjustedGap(db, filters);

  const likeForLike = likeForLikeFromSummaries(
    getCohortStats(db, filters).map((row) => ({
      key: row.key,
      maleMedian: row.maleMedian,
      femaleMedian: row.femaleMedian,
      maleMean: row.maleMean,
      femaleMean: row.femaleMean,
      maleCount: row.maleCount,
      femaleCount: row.femaleCount,
    })),
  );

  const representation = getRepresentationByLevel(db, filters);
  const notComparedHeadcount = representation.reduce((total, row) => total + row.otherCount, 0);

  return { unadjusted, likeForLike, representation, notComparedHeadcount };
}

// ---------------------------------------------------------------------------
// Bands and trend
// ---------------------------------------------------------------------------

export interface OutlierReport {
  readonly below: readonly OutlierRow[];
  readonly above: readonly OutlierRow[];
  readonly summary: BandSummary;
}

export function getOutliers(
  db: RawDatabase,
  filters: AnalyticsFilters = {},
  limit = 10,
): OutlierReport {
  return {
    below: getBandOutliers(db, 'BELOW', limit, filters),
    above: getBandOutliers(db, 'ABOVE', limit, filters),
    summary: getBandSummary(db, filters),
  };
}

/**
 * Quarterly points over the last four years, aligned to calendar quarters.
 *
 * Anchoring to Jan/Apr/Jul/Oct rather than counting back from today means the
 * axis matches the periods the HR Manager reports on, and the same page opened
 * on two different days shows the same points.
 */
export function getTrend(
  db: RawDatabase,
  filters: AnalyticsFilters = {},
  clock: Clock = systemClock,
): readonly TrendPoint[] {
  const today = clock.today();
  return getPayrollTrend(db, startOfQuarter(addYears(today, -4)), today, filters);
}

export type { AnalyticsFilters, BandSummary, BreakdownRow, OutlierRow, RepresentationRow, TrendPoint };
