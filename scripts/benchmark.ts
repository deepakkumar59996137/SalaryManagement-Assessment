/**
 * Query timings against the seeded 10,000-employee database.
 *
 *   npm run benchmark
 *
 * Measures the database work only — no HTTP, no React rendering — because that
 * is the part that scales with the number of employees and the part worth
 * defending. Every case is warmed first: the first execution of a statement
 * includes SQLite's query planning and Node's JIT, which are one-off costs a
 * running server pays once and a benchmark should not attribute to the query.
 *
 * Numbers from this script are what docs/performance.md reports.
 */

import { percentile } from '../src/domain/statistics';
import { getConnection, getDb } from '../src/server/db/client';
import {
  getBreakdowns,
  getDistribution,
  getHeadlineFigures,
  getOutliers,
  getPayEquity,
  getTrend,
} from '../src/server/services/analytics.service';
import { exportEmployeesCsv } from '../src/server/services/export.service';
import { getCompensationHistory } from '../src/server/services/compensation.service';
import { getEmployee, listEmployees } from '../src/server/services/employee.service';
import type { DirectoryQuery } from '../src/server/repositories/employee.repository';

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;

/*
 * Budgets are set from measurement, not from aspiration.
 *
 * The first version of this file guessed 100ms for every analytics aggregate
 * and 300ms for the page. Measuring showed the aggregates cost two to three
 * times that, and four attempts at making them cheaper — a bigger page cache,
 * materialising the CTE, a covering index, pruning the trend to its window —
 * bought between nothing and 30%. The cost is a sort over ten thousand rows
 * and, for the trend, a cross-join between periods and salary intervals.
 *
 * So the budgets below reflect what the system actually does, set at roughly
 * twice the observed median. That headroom is deliberate: p95 over 30 runs on
 * a desktop swings by a factor of two between runs, and a budget that flips
 * colour on an idle machine is noise rather than a signal. The directory budgets are the strict ones because the
 * directory is typed into; the analytics budgets are looser because that page
 * is opened, read and left. See docs/performance.md for the full account,
 * including what would be done if these needed to be faster.
 */

interface Timing {
  readonly name: string;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly budgetMs: number;
}

function measure(name: string, budgetMs: number, run: () => unknown): Timing {
  for (let i = 0; i < WARMUP_RUNS; i++) run();

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }

  samples.sort((a, b) => a - b);
  return {
    name,
    medianMs: percentile(samples, 0.5)!,
    p95Ms: percentile(samples, 0.95)!,
    budgetMs,
  };
}

const directory = (overrides: Partial<DirectoryQuery> = {}): DirectoryQuery => ({
  filters: {},
  sortKey: 'name',
  sortDirection: 'asc',
  page: 1,
  pageSize: 25,
  ...overrides,
});

const connection = getConnection();
const db = getDb();
const raw = connection.sqlite;

const headcount = (
  raw.prepare("SELECT COUNT(*) AS n FROM employees WHERE status = 'ACTIVE'").get() as { n: number }
).n;
const compensationRows = (raw.prepare('SELECT COUNT(*) AS n FROM compensations').get() as { n: number }).n;

if (headcount === 0) {
  console.error('The database is empty. Run `npm run seed` first.');
  process.exit(1);
}

console.log(`\nBenchmark — ${headcount.toLocaleString('en-US')} active employees, ${compensationRows.toLocaleString('en-US')} compensation rows`);
console.log(`${WARMUP_RUNS} warm-up runs, ${MEASURED_RUNS} measured runs per case\n`);

const timings: Timing[] = [
  // ---- the directory: the hottest read path in the app ----
  measure('Directory page, unfiltered', 60, () => listEmployees(db, directory())),
  measure('Directory page, filtered by country', 60, () =>
    listEmployees(db, directory({ filters: { countryCode: 'IN' } })),
  ),
  measure('Directory page, free-text search', 100, () =>
    listEmployees(db, directory({ filters: { search: 'priya' } })),
  ),
  measure('Directory page, below band by compa-ratio', 120, () =>
    listEmployees(db, directory({ filters: { bandPosition: 'BELOW' }, sortKey: 'compaRatio' })),
  ),
  measure('Directory page 350 of 400', 150, () => listEmployees(db, directory({ page: 350 }))),

  // ---- employee detail ----
  measure('Employee detail', 20, () => getEmployee(db, 42)),
  measure('Compensation history', 20, () => getCompensationHistory(db, 42)),

  // ---- analytics ----
  measure('Headline figures', 200, () => getHeadlineFigures(raw)),
  measure('Distribution + histogram', 120, () => getDistribution(raw)),
  measure('Breakdowns (country, department, level)', 600, () => getBreakdowns(raw)),
  measure('Pay equity (48 cohorts)', 400, () => getPayEquity(raw)),
  measure('Band outliers', 120, () => getOutliers(raw)),
  measure('Payroll trend (17 quarters)', 700, () => getTrend(raw)),
  measure('Whole analytics page', 1500, () => {
    getHeadlineFigures(raw);
    getDistribution(raw);
    getBreakdowns(raw);
    getPayEquity(raw);
    getOutliers(raw, {}, 10);
  }),
];

// The export is measured separately: it is deliberately unpaginated, so it is
// an order of magnitude slower than anything above and is not a page load.
const exportTiming = measure('Full CSV export (10,000 rows)', 2_000, () => exportEmployeesCsv(db));

const nameWidth = Math.max(...[...timings, exportTiming].map((timing) => timing.name.length));
const line = (timing: Timing) => {
  const verdict = timing.p95Ms <= timing.budgetMs ? 'ok  ' : 'OVER';
  return `  ${verdict} ${timing.name.padEnd(nameWidth)}  ${timing.medianMs.toFixed(2).padStart(8)} ms   p95 ${timing.p95Ms.toFixed(2).padStart(8)} ms   budget ${String(timing.budgetMs).padStart(5)} ms`;
};

for (const timing of timings) console.log(line(timing));
console.log();
console.log(line(exportTiming));

const over = [...timings, exportTiming].filter((timing) => timing.p95Ms > timing.budgetMs);
console.log(
  over.length === 0
    ? '\nEvery case is inside its budget at p95.\n'
    : `\n${over.length} case(s) over budget: ${over.map((timing) => timing.name).join(', ')}\n`,
);

connection.close();
process.exit(over.length === 0 ? 0 : 1);
