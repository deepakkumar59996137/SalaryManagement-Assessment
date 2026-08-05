/**
 * Pay equity analysis.
 *
 * The headline gender pay gap on its own is close to useless — it mixes a
 * genuine "paid differently for the same work" effect with a "distributed
 * differently across levels and functions" effect, and those two findings call
 * for completely different responses. So this module computes both:
 *
 *   unadjusted   — the whole population, one comparison. What is reported
 *                  publicly (UK ONS methodology), and what stakeholders ask for.
 *   like-for-like — computed within (department, level) cohorts and then
 *                  weighted back up. Isolates the same-work component.
 *
 * The distance between the two numbers is the actual insight: a large
 * unadjusted gap with a small like-for-like gap is a representation problem in
 * promotion and hiring, not a pay-setting problem.
 *
 * Pure functions. Salaries must already be normalised to one currency.
 */

import { median } from './statistics';

export type Gender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';

export interface PayGap {
  /** Fraction, following UK convention: (male − female) / male. Positive means men are paid more. */
  readonly medianGap: number | null;
  readonly meanGap: number | null;
  readonly maleCount: number;
  readonly femaleCount: number;
  readonly maleMedian: number | null;
  readonly femaleMedian: number | null;
}

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function gapBetween(male: number | null, female: number | null): number | null {
  if (male === null || female === null || male === 0) return null;
  return (male - female) / male;
}

/**
 * Unadjusted gap across a whole population.
 *
 * Only FEMALE and MALE are compared. Employees recorded as OTHER or
 * UNDISCLOSED are counted in headcount elsewhere but excluded here, because a
 * binary comparison cannot represent them and silently folding them into one
 * side would misstate both groups.
 */
export function unadjustedGap(
  maleSalaries: readonly number[],
  femaleSalaries: readonly number[],
): PayGap {
  const maleSorted = sortedCopy(maleSalaries);
  const femaleSorted = sortedCopy(femaleSalaries);

  const maleMedian = median(maleSorted);
  const femaleMedian = median(femaleSorted);

  return {
    medianGap: gapBetween(maleMedian, femaleMedian),
    meanGap: gapBetween(average(maleSorted), average(femaleSorted)),
    maleCount: maleSorted.length,
    femaleCount: femaleSorted.length,
    maleMedian,
    femaleMedian,
  };
}

export interface Cohort {
  /** Human-readable identity of the comparison group, e.g. "Engineering · L4". */
  readonly key: string;
  readonly maleSalaries: readonly number[];
  readonly femaleSalaries: readonly number[];
}

export interface CohortGap extends PayGap {
  readonly key: string;
  readonly headcount: number;
}

export interface LikeForLikeResult {
  /** Headcount-weighted mean of the included cohorts' median gaps. */
  readonly weightedMedianGap: number | null;
  readonly cohorts: readonly CohortGap[];
  /** Employees inside cohorts large enough to include. */
  readonly coveredHeadcount: number;
  /** Employees in the input who fell into cohorts too small to compare. */
  readonly excludedHeadcount: number;
  /** Covered / (covered + excluded). Qualifies how much the number is worth. */
  readonly coverage: number | null;
}

/**
 * Like-for-like gap: compare within cohorts, then weight by cohort size.
 *
 * Cohorts with fewer than `minimumPerGroup` of either gender are excluded, for
 * two reasons. Statistically, a gap computed from two people is noise. And
 * practically, publishing a pay comparison for a cohort of one identifies that
 * person's salary to anyone who knows the org chart.
 */
export function likeForLikeGap(
  cohorts: readonly Cohort[],
  minimumPerGroup = 3,
): LikeForLikeResult {
  const included: CohortGap[] = [];
  let excludedHeadcount = 0;

  for (const cohort of cohorts) {
    const headcount = cohort.maleSalaries.length + cohort.femaleSalaries.length;

    if (
      cohort.maleSalaries.length < minimumPerGroup ||
      cohort.femaleSalaries.length < minimumPerGroup
    ) {
      excludedHeadcount += headcount;
      continue;
    }

    const gap = unadjustedGap(cohort.maleSalaries, cohort.femaleSalaries);
    if (gap.medianGap === null) {
      excludedHeadcount += headcount;
      continue;
    }

    included.push({ ...gap, key: cohort.key, headcount });
  }

  const coveredHeadcount = included.reduce((total, cohort) => total + cohort.headcount, 0);
  const totalHeadcount = coveredHeadcount + excludedHeadcount;

  const weightedMedianGap =
    coveredHeadcount === 0
      ? null
      : included.reduce(
          (total, cohort) => total + (cohort.medianGap ?? 0) * cohort.headcount,
          0,
        ) / coveredHeadcount;

  return {
    weightedMedianGap,
    // Widest gaps first — the cohorts worth investigating.
    cohorts: [...included].sort(
      (a, b) => Math.abs(b.medianGap ?? 0) - Math.abs(a.medianGap ?? 0),
    ),
    coveredHeadcount,
    excludedHeadcount,
    coverage: totalHeadcount === 0 ? null : coveredHeadcount / totalHeadcount,
  };
}

/**
 * Split employees into cohorts keyed by department and level.
 *
 * Kept here rather than in the analytics service so the cohorting rule — what
 * counts as "the same work" — is stated once, next to the maths that uses it.
 */
export function buildCohorts(
  employees: readonly { department: string; level: string; gender: Gender; salary: number }[],
): Cohort[] {
  const groups = new Map<string, { male: number[]; female: number[] }>();

  for (const employee of employees) {
    if (employee.gender !== 'MALE' && employee.gender !== 'FEMALE') continue;

    const key = `${employee.department} · ${employee.level}`;
    let group = groups.get(key);
    if (!group) {
      group = { male: [], female: [] };
      groups.set(key, group);
    }

    if (employee.gender === 'MALE') group.male.push(employee.salary);
    else group.female.push(employee.salary);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    maleSalaries: group.male,
    femaleSalaries: group.female,
  }));
}
