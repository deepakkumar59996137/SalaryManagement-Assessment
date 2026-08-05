/**
 * Print every analytics figure against the seeded dataset.
 *
 *   npx tsx scripts/analytics-check.ts
 *
 * A sanity harness, not a test: it exists so the numbers can be read by a
 * person and compared against what the screens claim. The assertions live in
 * tests/integration/analytics.test.ts.
 */

import { formatMoney, formatPercent } from '../src/domain/money';
import { getConnection } from '../src/server/db/client';
import {
  getBreakdowns,
  getDistribution,
  getHeadlineFigures,
  getOutliers,
  getPayEquity,
  getTrend,
} from '../src/server/services/analytics.service';

const { sqlite } = getConnection();
const usd = (minor: number | null) =>
  minor === null ? '—' : formatMoney(minor, 'USD', { compactDecimals: true });

const timed = <T>(label: string, run: () => T): T => {
  const started = performance.now();
  const result = run();
  console.log(`  [${(performance.now() - started).toFixed(1).padStart(6)} ms] ${label}`);
  return result;
};

console.log('\nQuery timings');
const headline = timed('headline figures', () => getHeadlineFigures(sqlite));
const distribution = timed('distribution + histogram', () => getDistribution(sqlite));
const breakdowns = timed('three breakdowns', () => getBreakdowns(sqlite));
const equity = timed('pay equity', () => getPayEquity(sqlite));
const outliers = timed('band outliers', () => getOutliers(sqlite));
const trend = timed('payroll trend', () => getTrend(sqlite));

console.log(`
Headline
  headcount            ${headline.headcount.toLocaleString('en-US')} across ${headline.countryCount} countries
  annual payroll       ${usd(headline.totalAnnualUsdMinor)}
  median / mean        ${usd(headline.medianUsdMinor)} / ${usd(headline.meanUsdMinor)}
  outside band         ${headline.bands.below} below, ${headline.bands.above} above
  cost to fix below    ${usd(headline.bands.costToMinimumUsdMinor)} a year

Distribution
  p25 ${usd(distribution.p25UsdMinor)}   p50 ${usd(distribution.p50UsdMinor)}   p75 ${usd(distribution.p75UsdMinor)}   p90 ${usd(distribution.p90UsdMinor)}
  range ${usd(distribution.minUsdMinor)} – ${usd(distribution.maxUsdMinor)} in ${distribution.buckets.length} buckets

Pay equity
  unadjusted median gap   ${equity.unadjusted.medianGap === null ? '—' : formatPercent(equity.unadjusted.medianGap)}
  like-for-like gap       ${equity.likeForLike.weightedMedianGap === null ? '—' : formatPercent(equity.likeForLike.weightedMedianGap)}
  cohorts compared        ${equity.likeForLike.cohorts.length}, covering ${equity.likeForLike.coverage === null ? '—' : formatPercent(equity.likeForLike.coverage, 0)} of the org
  not comparable          ${equity.notComparedHeadcount} employees`);

console.log('\n  representation by level');
for (const row of equity.representation) {
  const total = row.femaleCount + row.maleCount;
  const share = total === 0 ? 0 : row.femaleCount / total;
  console.log(`    ${row.levelCode}  ${String(row.femaleCount).padStart(4)} women / ${String(row.maleCount).padStart(4)} men   ${formatPercent(share)} women`);
}

console.log('\n  widest cohort gaps');
for (const cohort of equity.likeForLike.cohorts.slice(0, 5)) {
  console.log(`    ${cohort.key.padEnd(26)} ${formatPercent(cohort.medianGap!).padStart(7)}  (${cohort.headcount} people)`);
}

console.log('\nCost by country');
for (const row of breakdowns.country) {
  console.log(`  ${row.label.padEnd(18)} ${String(row.headcount).padStart(5)}  ${usd(row.totalAnnualUsdMinor).padStart(14)}  median ${usd(row.medianUsdMinor)}`);
}

console.log('\nCost by level');
for (const row of breakdowns.level) {
  console.log(`  ${row.label.padEnd(26)} ${String(row.headcount).padStart(5)}  ${usd(row.totalAnnualUsdMinor).padStart(14)}  median ${usd(row.medianUsdMinor)}`);
}

console.log('\nFurthest below band');
for (const row of outliers.below.slice(0, 5)) {
  console.log(`  ${row.name.padEnd(22)} ${row.levelCode} ${row.countryName.padEnd(16)} compa ${row.compaRatio.toFixed(2)}`);
}

console.log('\nPayroll trend (current workforce, quarterly)');
for (const point of trend.filter((_, index) => index % 4 === 0)) {
  console.log(`  ${point.asOf}  ${String(point.headcount).padStart(6)} people  ${usd(point.totalAnnualUsdMinor).padStart(14)}`);
}

console.log();
getConnection().close();
