import { describe, expect, it } from 'vitest';
import {
  buildCohorts,
  type Cohort,
  likeForLikeGap,
  unadjustedGap,
} from '@/domain/pay-equity';

const repeat = (value: number, times: number) => Array.from({ length: times }, () => value);

describe('unadjustedGap', () => {
  it('follows the UK convention — positive means men are paid more', () => {
    const gap = unadjustedGap([100, 110, 120], [90, 95, 100]);
    expect(gap.maleMedian).toBe(110);
    expect(gap.femaleMedian).toBe(95);
    expect(gap.medianGap).toBeCloseTo((110 - 95) / 110, 10);
  });

  it('is negative when women are paid more', () => {
    const gap = unadjustedGap([90, 95, 100], [100, 110, 120]);
    expect(gap.medianGap!).toBeLessThan(0);
  });

  it('is zero when the two medians match', () => {
    expect(unadjustedGap([100, 200, 300], [100, 200, 300]).medianGap).toBe(0);
  });

  it('reports mean and median separately, since outliers move only one', () => {
    const gap = unadjustedGap([100, 100, 100, 10_000], [100, 100, 100, 100]);
    expect(gap.medianGap).toBe(0);
    expect(gap.meanGap!).toBeGreaterThan(0.9);
  });

  it('has no answer when either group is empty', () => {
    expect(unadjustedGap([], [100]).medianGap).toBeNull();
    expect(unadjustedGap([100], []).medianGap).toBeNull();
  });

  it('does not mutate the arrays it is given', () => {
    const male = [300, 100, 200];
    unadjustedGap(male, [100]);
    expect(male).toEqual([300, 100, 200]);
  });
});

describe('likeForLikeGap', () => {
  /**
   * The case the whole module exists for.
   *
   * Two cohorts. Within each, men and women are paid within 1% of each other —
   * there is essentially no same-work pay problem. But the senior, well-paid
   * cohort is mostly men and the junior one is mostly women, so the headline
   * number looks catastrophic. The two figures point at completely different
   * remedies, which is why both are reported.
   */
  const seniorHeavyOnMen: Cohort = {
    key: 'Engineering · L5',
    maleSalaries: repeat(200, 10),
    femaleSalaries: repeat(198, 3),
  };
  const juniorHeavyOnWomen: Cohort = {
    key: 'Engineering · L2',
    maleSalaries: repeat(100, 3),
    femaleSalaries: repeat(99, 10),
  };

  it('separates a representation problem from a pay-setting problem', () => {
    const allMale = [...seniorHeavyOnMen.maleSalaries, ...juniorHeavyOnWomen.maleSalaries];
    const allFemale = [...seniorHeavyOnMen.femaleSalaries, ...juniorHeavyOnWomen.femaleSalaries];

    const headline = unadjustedGap(allMale, allFemale);
    expect(headline.medianGap).toBeCloseTo(0.505, 10);

    const withinCohorts = likeForLikeGap([seniorHeavyOnMen, juniorHeavyOnWomen]);
    expect(withinCohorts.weightedMedianGap).toBeCloseTo(0.01, 10);
  });

  it('weights cohorts by headcount rather than treating them as equals', () => {
    const large: Cohort = { key: 'large', maleSalaries: repeat(100, 50), femaleSalaries: repeat(100, 50) };
    const small: Cohort = { key: 'small', maleSalaries: repeat(100, 3), femaleSalaries: repeat(50, 3) };

    const result = likeForLikeGap([large, small]);
    // A 50% gap in a cohort of 6 alongside no gap in a cohort of 100.
    expect(result.weightedMedianGap).toBeCloseTo((0.5 * 6) / 106, 10);
  });

  it('excludes cohorts too small to compare, and says how much it excluded', () => {
    const comparable: Cohort = { key: 'ok', maleSalaries: repeat(100, 5), femaleSalaries: repeat(90, 5) };
    const tooFewWomen: Cohort = { key: 'thin', maleSalaries: repeat(100, 8), femaleSalaries: [90, 95] };

    const result = likeForLikeGap([comparable, tooFewWomen]);

    expect(result.cohorts.map((cohort) => cohort.key)).toEqual(['ok']);
    expect(result.coveredHeadcount).toBe(10);
    expect(result.excludedHeadcount).toBe(10);
    expect(result.coverage).toBe(0.5);
  });

  it('honours a caller-supplied minimum cohort size', () => {
    const cohort: Cohort = { key: 'pair', maleSalaries: [100, 100], femaleSalaries: [90, 90] };
    expect(likeForLikeGap([cohort], 3).cohorts).toHaveLength(0);
    expect(likeForLikeGap([cohort], 2).cohorts).toHaveLength(1);
  });

  it('ranks cohorts by how far from parity they are, widest first', () => {
    const mild: Cohort = { key: 'mild', maleSalaries: repeat(100, 3), femaleSalaries: repeat(98, 3) };
    const severe: Cohort = { key: 'severe', maleSalaries: repeat(100, 3), femaleSalaries: repeat(60, 3) };
    const reversed: Cohort = { key: 'reversed', maleSalaries: repeat(100, 3), femaleSalaries: repeat(120, 3) };

    const result = likeForLikeGap([mild, severe, reversed]);
    expect(result.cohorts.map((cohort) => cohort.key)).toEqual(['severe', 'reversed', 'mild']);
  });

  it('has no answer when nothing is comparable', () => {
    const result = likeForLikeGap([]);
    expect(result.weightedMedianGap).toBeNull();
    expect(result.coverage).toBeNull();
  });
});

describe('buildCohorts', () => {
  it('groups by department and level together', () => {
    const cohorts = buildCohorts([
      { department: 'Engineering', level: 'L4', gender: 'MALE', salary: 100 },
      { department: 'Engineering', level: 'L4', gender: 'FEMALE', salary: 95 },
      { department: 'Engineering', level: 'L5', gender: 'MALE', salary: 150 },
      { department: 'Sales', level: 'L4', gender: 'FEMALE', salary: 90 },
    ]);

    expect(cohorts.map((cohort) => cohort.key).sort()).toEqual([
      'Engineering · L4',
      'Engineering · L5',
      'Sales · L4',
    ]);

    const engineeringL4 = cohorts.find((cohort) => cohort.key === 'Engineering · L4');
    expect(engineeringL4?.maleSalaries).toEqual([100]);
    expect(engineeringL4?.femaleSalaries).toEqual([95]);
  });

  it('leaves out genders a binary comparison cannot represent', () => {
    const cohorts = buildCohorts([
      { department: 'Engineering', level: 'L4', gender: 'MALE', salary: 100 },
      { department: 'Engineering', level: 'L4', gender: 'OTHER', salary: 105 },
      { department: 'Engineering', level: 'L4', gender: 'UNDISCLOSED', salary: 110 },
    ]);

    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]!.maleSalaries).toEqual([100]);
    expect(cohorts[0]!.femaleSalaries).toEqual([]);
  });
});
