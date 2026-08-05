import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { median, percentile } from '@/domain/statistics';
import {
  getBreakdowns,
  getDistribution,
  getHeadlineFigures,
  getOutliers,
  getPayEquity,
  getTrend,
} from '@/server/services/analytics.service';
import { reviseSalary } from '@/server/services/compensation.service';
import { addEmployee, createTestContext, type TestContext } from '@tests/helpers/test-db';

/**
 * Analytics are asserted against numbers a reader can verify by hand.
 *
 * The fixture uses round salaries and ₹80 to the dollar, so every expected
 * total, median and gap below can be checked with arithmetic rather than by
 * trusting the implementation that produced it.
 */

let context: TestContext;
/** The raw driver — the analytics repository runs hand-written SQL. */
let raw: TestContext['sqlite'];

beforeEach(() => {
  context = createTestContext('2026-06-01');
  raw = context.sqlite;
});

afterEach(() => {
  context.connection.close();
});

describe('headline figures', () => {
  it('totals annual payroll in USD across currencies', () => {
    addEmployee(context, { country: 'US', salaryMajor: 100_000 });
    addEmployee(context, { country: 'US', salaryMajor: 60_000 });
    // ₹1,600,000 at ₹80 to the dollar is $20,000.
    addEmployee(context, { country: 'IN', salaryMajor: 1_600_000 });

    const figures = getHeadlineFigures(raw);

    expect(figures.headcount).toBe(3);
    expect(figures.totalAnnualUsdMinor).toBe(18_000_000);
    expect(figures.countryCount).toBe(2);
  });

  it('reports the median, not just the mean', () => {
    // One very high earner pulls the mean well above the middle of the range.
    for (const salary of [50_000, 55_000, 60_000, 65_000, 1_000_000]) {
      addEmployee(context, { country: 'US', salaryMajor: salary });
    }

    const figures = getHeadlineFigures(raw);

    expect(figures.medianUsdMinor).toBe(6_000_000);
    expect(figures.meanUsdMinor).toBe(24_600_000);
  });

  it('excludes people who have left', () => {
    addEmployee(context, { country: 'US', salaryMajor: 100_000 });
    addEmployee(context, { country: 'US', salaryMajor: 100_000, status: 'TERMINATED' });

    expect(getHeadlineFigures(raw).headcount).toBe(1);
  });

  it('is all zeroes and nulls for an empty organisation', () => {
    const figures = getHeadlineFigures(raw);

    expect(figures.headcount).toBe(0);
    expect(figures.totalAnnualUsdMinor).toBe(0);
    expect(figures.medianUsdMinor).toBeNull();
    expect(figures.medianGenderGap).toBeNull();
  });

  it('narrows to a filtered slice', () => {
    addEmployee(context, { country: 'US', salaryMajor: 100_000 });
    addEmployee(context, { country: 'IN', salaryMajor: 1_600_000 });

    expect(getHeadlineFigures(raw, { countryCode: 'IN' })).toMatchObject({
      headcount: 1,
      totalAnnualUsdMinor: 2_000_000,
    });
  });
});

describe('distribution', () => {
  it('matches the array percentile implementation exactly', () => {
    // The SQL and the domain function share percentileSelection's index maths,
    // so they must agree on the same data — for odd and even counts alike.
    const salaries = [40_000, 52_000, 61_000, 75_000, 88_000, 96_000, 130_000];
    for (const salary of salaries) addEmployee(context, { country: 'US', salaryMajor: salary });

    const sorted = salaries.map((salary) => salary * 100).sort((a, b) => a - b);
    const distribution = getDistribution(raw);

    expect(distribution.p25UsdMinor).toBe(Math.round(percentile(sorted, 0.25)!));
    expect(distribution.p50UsdMinor).toBe(Math.round(median(sorted)!));
    expect(distribution.p75UsdMinor).toBe(Math.round(percentile(sorted, 0.75)!));
    expect(distribution.p90UsdMinor).toBe(Math.round(percentile(sorted, 0.9)!));
  });

  it('agrees with the array implementation on an even count too', () => {
    const salaries = [40_000, 52_000, 61_000, 75_000, 88_000, 96_000];
    for (const salary of salaries) addEmployee(context, { country: 'US', salaryMajor: salary });

    const sorted = salaries.map((salary) => salary * 100).sort((a, b) => a - b);
    expect(getDistribution(raw).p50UsdMinor).toBe(Math.round(median(sorted)!));
  });

  it('counts every employee exactly once across histogram buckets', () => {
    for (let i = 0; i < 40; i++) {
      addEmployee(context, { country: 'US', salaryMajor: 40_000 + i * 3_000 });
    }

    const distribution = getDistribution(raw);
    const counted = distribution.buckets.reduce((total, bucket) => total + bucket.count, 0);

    expect(counted).toBe(40);
    expect(distribution.buckets.length).toBeGreaterThan(1);
  });

  it('puts the highest earner inside the last bucket, not past the end', () => {
    for (const salary of [40_000, 60_000, 80_000, 100_000]) {
      addEmployee(context, { country: 'US', salaryMajor: salary });
    }

    const distribution = getDistribution(raw);
    expect(distribution.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(4);
    expect(distribution.maxUsdMinor).toBe(10_000_000);
  });

  it('has nothing to describe when nobody matches', () => {
    const distribution = getDistribution(raw);
    expect(distribution.count).toBe(0);
    expect(distribution.buckets).toEqual([]);
    expect(distribution.p50UsdMinor).toBeNull();
  });
});

describe('breakdowns', () => {
  beforeEach(() => {
    addEmployee(context, { department: 'Engineering', level: 'L1', country: 'US', salaryMajor: 50_000 });
    addEmployee(context, { department: 'Engineering', level: 'L3', country: 'US', salaryMajor: 150_000 });
    addEmployee(context, { department: 'Sales', level: 'L2', country: 'IN', salaryMajor: 1_600_000 });
  });

  it('reports headcount, total and median per department', () => {
    const { department } = getBreakdowns(raw);

    const engineering = department.find((row) => row.label === 'Engineering');
    expect(engineering).toMatchObject({
      headcount: 2,
      totalAnnualUsdMinor: 20_000_000,
      medianUsdMinor: 10_000_000,
    });
  });

  it('converts before comparing countries', () => {
    const { country } = getBreakdowns(raw);

    expect(country.find((row) => row.key === 'IN')).toMatchObject({
      headcount: 1,
      totalAnnualUsdMinor: 2_000_000,
    });
  });

  it('orders levels by seniority and everything else by cost', () => {
    const { level, country } = getBreakdowns(raw);

    expect(level.map((row) => row.key)).toEqual(['L1', 'L2', 'L3']);
    // The US costs more in total, so it leads.
    expect(country[0]?.key).toBe('US');
  });

  it('accounts for every employee exactly once in each breakdown', () => {
    for (const rows of Object.values(getBreakdowns(raw))) {
      expect(rows.reduce((total, row) => total + row.headcount, 0)).toBe(3);
    }
  });
});

describe('salary bands', () => {
  beforeEach(() => {
    // US L2 band is 64,000 – 80,000 – 96,000.
    addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 60_000 });
    addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 62_000 });
    addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 80_000 });
    addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 110_000 });
  });

  it('counts who sits below, inside and above their band', () => {
    const { summary } = getOutliers(raw);

    expect(summary.below).toBe(2);
    expect(summary.within).toBe(1);
    expect(summary.above).toBe(1);
  });

  it('prices what it would cost to lift everyone up to their band minimum', () => {
    // (64,000 − 60,000) + (64,000 − 62,000) = 6,000 a year.
    expect(getOutliers(raw).summary.costToMinimumUsdMinor).toBe(600_000);
  });

  it('prices the shortfall in USD for a non-USD country', () => {
    const other = createTestContext('2026-06-01');
    // India L2 band minimum is ₹1,433,600; paying ₹1,033,600 is ₹400,000 short,
    // which is $5,000 at ₹80 to the dollar.
    addEmployee(other, { level: 'L2', country: 'IN', salaryMajor: 1_033_600 });

    expect(getOutliers(other.sqlite).summary.costToMinimumUsdMinor).toBe(500_000);
    other.connection.close();
  });

  it('lists the worst-paid first, and the most overpaid first', () => {
    const outliers = getOutliers(raw);

    expect(outliers.below.map((row) => row.baseSalaryMinor)).toEqual([6_000_000, 6_200_000]);
    expect(outliers.above[0]?.baseSalaryMinor).toBe(11_000_000);
    expect(outliers.below[0]?.compaRatio).toBeCloseTo(0.75, 10);
  });
});

describe('pay equity', () => {
  /**
   * The demonstration case, in miniature: men and women are paid within 1% of
   * each other inside every cohort, but men hold the senior, well-paid roles.
   * The headline gap is large; the like-for-like gap is not.
   */
  function buildSkewedOrganisation() {
    for (let i = 0; i < 10; i++) {
      addEmployee(context, { department: 'Engineering', level: 'L3', country: 'US', gender: 'MALE', salaryMajor: 200_000 });
    }
    for (let i = 0; i < 3; i++) {
      addEmployee(context, { department: 'Engineering', level: 'L3', country: 'US', gender: 'FEMALE', salaryMajor: 198_000 });
    }
    for (let i = 0; i < 3; i++) {
      addEmployee(context, { department: 'Engineering', level: 'L1', country: 'US', gender: 'MALE', salaryMajor: 100_000 });
    }
    for (let i = 0; i < 10; i++) {
      addEmployee(context, { department: 'Engineering', level: 'L1', country: 'US', gender: 'FEMALE', salaryMajor: 99_000 });
    }
  }

  it('separates a representation problem from a pay-setting one', () => {
    buildSkewedOrganisation();

    const equity = getPayEquity(raw);

    // Median man is on 200,000; median woman on 99,000.
    expect(equity.unadjusted.medianGap).toBeCloseTo(0.505, 10);
    // Within each cohort the difference is 1%.
    expect(equity.likeForLike.weightedMedianGap).toBeCloseTo(0.01, 10);
  });

  it('shows the representation gradient that explains the headline number', () => {
    buildSkewedOrganisation();

    const byLevel = getPayEquity(raw).representation;

    expect(byLevel.find((row) => row.levelCode === 'L1')).toMatchObject({ femaleCount: 10, maleCount: 3 });
    expect(byLevel.find((row) => row.levelCode === 'L3')).toMatchObject({ femaleCount: 3, maleCount: 10 });
  });

  it('excludes cohorts too small to compare, and says how much it excluded', () => {
    for (let i = 0; i < 5; i++) {
      addEmployee(context, { department: 'Engineering', level: 'L2', gender: 'MALE', salaryMajor: 80_000 });
      addEmployee(context, { department: 'Engineering', level: 'L2', gender: 'FEMALE', salaryMajor: 76_000 });
    }
    // A cohort with only one woman: comparing would publish her salary.
    for (let i = 0; i < 4; i++) {
      addEmployee(context, { department: 'Sales', level: 'L2', gender: 'MALE', salaryMajor: 80_000 });
    }
    addEmployee(context, { department: 'Sales', level: 'L2', gender: 'FEMALE', salaryMajor: 60_000 });

    const equity = getPayEquity(raw);

    expect(equity.likeForLike.cohorts.map((cohort) => cohort.key)).toEqual(['Engineering · L2']);
    expect(equity.likeForLike.coveredHeadcount).toBe(10);
    expect(equity.likeForLike.excludedHeadcount).toBe(5);
    expect(equity.likeForLike.coverage).toBeCloseTo(10 / 15, 10);
  });

  it('counts people the binary comparison cannot represent, without folding them into either side', () => {
    addEmployee(context, { gender: 'MALE', salaryMajor: 80_000 });
    addEmployee(context, { gender: 'FEMALE', salaryMajor: 80_000 });
    addEmployee(context, { gender: 'OTHER', salaryMajor: 200_000 });
    addEmployee(context, { gender: 'UNDISCLOSED', salaryMajor: 200_000 });

    const equity = getPayEquity(raw);

    expect(equity.notComparedHeadcount).toBe(2);
    expect(equity.unadjusted.maleCount).toBe(1);
    expect(equity.unadjusted.femaleCount).toBe(1);
    // The two high earners must not move the gap in either direction.
    expect(equity.unadjusted.medianGap).toBe(0);
  });

  it('has no gap to report when one side is empty', () => {
    addEmployee(context, { gender: 'MALE', salaryMajor: 80_000 });
    expect(getPayEquity(raw).unadjusted.medianGap).toBeNull();
  });
});

describe('payroll trend', () => {
  it('follows the pay of the current workforce backwards through its history', () => {
    const id = addEmployee(context, { country: 'US', salaryMajor: 80_000, hireDate: '2023-01-01' });
    reviseSalary(
      context.db,
      { employeeId: id, baseSalaryMajor: 100_000, effectiveFrom: '2025-01-01', changeReason: 'MERIT' },
      context.userId,
      context.clock,
    );

    const trend = getTrend(raw, {}, context.clock);

    const before = trend.find((point) => point.asOf === '2024-01-01');
    const after = trend.find((point) => point.asOf === '2026-01-01');

    expect(before?.totalAnnualUsdMinor).toBe(8_000_000);
    expect(after?.totalAnnualUsdMinor).toBe(10_000_000);
  });

  it('reports nothing before the employee existed', () => {
    addEmployee(context, { country: 'US', salaryMajor: 80_000, hireDate: '2025-01-01' });

    const trend = getTrend(raw, {}, context.clock);
    expect(trend.find((point) => point.asOf === '2023-01-01')?.headcount).toBe(0);
  });

  it('produces quarterly points across the window', () => {
    addEmployee(context, { country: 'US', salaryMajor: 80_000, hireDate: '2022-01-01' });

    const trend = getTrend(raw, {}, context.clock);
    // Four years of quarters, inclusive of both ends.
    expect(trend.length).toBeGreaterThanOrEqual(16);
    expect(trend.every((point, index) => index === 0 || point.asOf > trend[index - 1]!.asOf)).toBe(true);
  });
});
