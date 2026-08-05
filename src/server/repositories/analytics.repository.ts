import { percentileSelection } from '@/domain/statistics';
import type { RawDatabase } from '../db/client';

/**
 * Compensation analytics.
 *
 * Everything here aggregates in SQL. Nothing pulls ten thousand rows into
 * JavaScript to reduce them — the largest result any of these returns is one
 * row per department, level or country.
 *
 * All figures are the denormalised `annual_base_usd_minor` (ADR-0003), because
 * summing or ranking local amounts across ten currencies is meaningless.
 *
 * Written with the driver directly rather than through the query builder: these
 * are window functions and recursive CTEs, and the SQL reads better as SQL.
 */

export interface AnalyticsFilters {
  readonly countryCode?: string;
  readonly departmentId?: number;
  readonly jobLevelId?: number;
  readonly employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
}

interface Predicate {
  readonly sql: string;
  readonly params: (string | number)[];
}

/**
 * The population every figure on the analytics screen is computed over:
 * currently-employed people who have a salary on record.
 *
 * Leavers are excluded — including them would mean "what we paid last year's
 * staff", which is not what anyone means by "what do we pay people".
 */
function population(filters: AnalyticsFilters): Predicate {
  const clauses = ["e.status = 'ACTIVE'", 'c.id IS NOT NULL'];
  const params: (string | number)[] = [];

  if (filters.countryCode) {
    clauses.push('e.country_code = ?');
    params.push(filters.countryCode);
  }
  if (filters.departmentId) {
    clauses.push('e.department_id = ?');
    params.push(filters.departmentId);
  }
  if (filters.jobLevelId) {
    clauses.push('e.job_level_id = ?');
    params.push(filters.jobLevelId);
  }
  if (filters.employmentType) {
    clauses.push('e.employment_type = ?');
    params.push(filters.employmentType);
  }

  return { sql: clauses.join(' AND '), params };
}

const FROM_POPULATION = `
  FROM employees e
  JOIN compensations c ON c.id = e.current_compensation_id
`;

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export interface Overview {
  readonly headcount: number;
  readonly totalAnnualUsdMinor: number;
  readonly meanUsdMinor: number | null;
  readonly minUsdMinor: number | null;
  readonly maxUsdMinor: number | null;
  readonly countryCount: number;
}

export function getOverview(db: RawDatabase, filters: AnalyticsFilters = {}): Overview {
  const where = population(filters);

  const row = db
    .prepare(`
      SELECT COUNT(*) AS headcount,
             COALESCE(SUM(c.annual_base_usd_minor), 0) AS total,
             AVG(c.annual_base_usd_minor) AS mean,
             MIN(c.annual_base_usd_minor) AS lowest,
             MAX(c.annual_base_usd_minor) AS highest,
             COUNT(DISTINCT e.country_code) AS countries
      ${FROM_POPULATION}
      WHERE ${where.sql}
    `)
    .get(...where.params) as {
    headcount: number;
    total: number;
    mean: number | null;
    lowest: number | null;
    highest: number | null;
    countries: number;
  };

  return {
    headcount: row.headcount,
    totalAnnualUsdMinor: row.total,
    meanUsdMinor: row.mean === null ? null : Math.round(row.mean),
    minUsdMinor: row.lowest,
    maxUsdMinor: row.highest,
    countryCount: row.countries,
  };
}

/**
 * Percentiles of the USD salary distribution.
 *
 * SQLite has no percentile_cont, so the bracketing rows are selected with
 * ROW_NUMBER() and interpolated. The indices come from `percentileSelection` in
 * src/domain/statistics.ts — the same function the array implementation uses —
 * so the SQL and JavaScript answers agree by construction rather than by
 * someone remembering to keep two formulas in step.
 */
export function getPercentiles(
  db: RawDatabase,
  probabilities: readonly number[],
  filters: AnalyticsFilters = {},
): Map<number, number | null> {
  const result = new Map<number, number | null>();
  const where = population(filters);

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count ${FROM_POPULATION} WHERE ${where.sql}`)
    .get(...where.params) as { count: number };

  if (count === 0) {
    for (const p of probabilities) result.set(p, null);
    return result;
  }

  // Gather every row index any of the requested percentiles needs, so one
  // query serves all of them.
  const selections = new Map(
    probabilities.map((p) => [p, percentileSelection(count, p)!]),
  );
  const wanted = new Set<number>();
  for (const selection of selections.values()) {
    // ROW_NUMBER() is 1-based; percentileSelection returns 0-based indices.
    wanted.add(selection.lowerIndex + 1);
    wanted.add(selection.upperIndex + 1);
  }

  const placeholders = [...wanted].map(() => '?').join(',');
  const rows = db
    .prepare(`
      WITH ranked AS (
        SELECT c.annual_base_usd_minor AS value,
               ROW_NUMBER() OVER (ORDER BY c.annual_base_usd_minor) AS position
        ${FROM_POPULATION}
        WHERE ${where.sql}
      )
      SELECT position, value FROM ranked WHERE position IN (${placeholders})
    `)
    .all(...where.params, ...wanted) as { position: number; value: number }[];

  const byPosition = new Map(rows.map((row) => [row.position, row.value]));

  for (const [p, selection] of selections) {
    const lower = byPosition.get(selection.lowerIndex + 1);
    const upper = byPosition.get(selection.upperIndex + 1);

    result.set(
      p,
      lower === undefined || upper === undefined
        ? null
        : Math.round(lower + (upper - lower) * selection.fraction),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export type BreakdownDimension = 'country' | 'department' | 'level';

export interface BreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly headcount: number;
  readonly totalAnnualUsdMinor: number;
  readonly medianUsdMinor: number | null;
  readonly meanUsdMinor: number | null;
}

const DIMENSIONS: Record<BreakdownDimension, { join: string; key: string; label: string; order: string }> = {
  country: {
    join: 'JOIN countries dim ON dim.code = e.country_code',
    key: 'e.country_code',
    label: 'dim.name',
    order: 'total DESC',
  },
  department: {
    join: 'JOIN departments dim ON dim.id = e.department_id',
    key: 'CAST(e.department_id AS TEXT)',
    label: 'dim.name',
    order: 'total DESC',
  },
  level: {
    join: 'JOIN job_levels dim ON dim.id = e.job_level_id',
    key: 'dim.code',
    label: "dim.code || ' · ' || dim.name",
    order: 'MIN(dim.rank) ASC',
  },
};

/**
 * Headcount, total cost and median pay per country, department or level.
 *
 * The median is computed inside SQL by ranking within each group and averaging
 * the one or two middle rows — which is exactly what linear interpolation
 * reduces to at p50, so it matches `median()` in src/domain/statistics.ts for
 * both odd and even group sizes.
 */
export function getBreakdown(
  db: RawDatabase,
  dimension: BreakdownDimension,
  filters: AnalyticsFilters = {},
): BreakdownRow[] {
  const where = population(filters);
  const spec = DIMENSIONS[dimension];

  return db
    .prepare(`
      WITH ranked AS (
        SELECT ${spec.key} AS key,
               ${spec.label} AS label,
               dim.rowid AS dim_rowid,
               c.annual_base_usd_minor AS value,
               ROW_NUMBER() OVER (PARTITION BY ${spec.key} ORDER BY c.annual_base_usd_minor) AS position,
               COUNT(*) OVER (PARTITION BY ${spec.key}) AS group_size
        ${FROM_POPULATION}
        ${spec.join}
        WHERE ${where.sql}
      )
      SELECT key,
             MIN(label) AS label,
             MIN(group_size) AS headcount,
             SUM(value) AS total,
             AVG(value) AS mean,
             AVG(CASE WHEN position IN ((group_size + 1) / 2, (group_size + 2) / 2) THEN value END) AS median
      FROM ranked
      GROUP BY key
      ORDER BY ${dimension === 'level' ? 'MIN(dim_rowid) ASC' : spec.order}
    `)
    .all(...where.params)
    .map((raw) => {
      const row = raw as {
        key: string;
        label: string;
        headcount: number;
        total: number;
        mean: number | null;
        median: number | null;
      };

      return {
        key: row.key,
        label: row.label,
        headcount: row.headcount,
        totalAnnualUsdMinor: row.total,
        medianUsdMinor: row.median === null ? null : Math.round(row.median),
        meanUsdMinor: row.mean === null ? null : Math.round(row.mean),
      };
    });
}

/** Counts per histogram bucket, given edges computed from the min and max. */
export function getHistogram(
  db: RawDatabase,
  edges: readonly number[],
  filters: AnalyticsFilters = {},
): number[] {
  const bucketCount = edges.length - 1;
  if (bucketCount < 1) return [];

  const first = edges[0]!;
  const last = edges[bucketCount]!;
  const width = (last - first) / bucketCount;
  const where = population(filters);

  const rows = db
    .prepare(`
      SELECT MIN(CAST((c.annual_base_usd_minor - ?) / ? AS INTEGER), ?) AS bucket,
             COUNT(*) AS count
      ${FROM_POPULATION}
      WHERE ${where.sql}
      GROUP BY bucket
    `)
    .all(first, width, bucketCount - 1, ...where.params) as { bucket: number; count: number }[];

  const counts = new Array<number>(bucketCount).fill(0);
  for (const row of rows) {
    // The top edge is inclusive, so the maximum lands in the last bucket
    // rather than one past the end — matching bucketIndexFor in the domain.
    const index = Math.min(Math.max(row.bucket, 0), bucketCount - 1);
    counts[index] = (counts[index] ?? 0) + row.count;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Salary bands
// ---------------------------------------------------------------------------

export interface BandSummary {
  readonly below: number;
  readonly within: number;
  readonly above: number;
  readonly noBand: number;
  /** What it would cost per year to lift everyone below their band up to it. */
  readonly costToMinimumUsdMinor: number;
}

export function getBandSummary(db: RawDatabase, filters: AnalyticsFilters = {}): BandSummary {
  const where = population(filters);

  const row = db
    .prepare(`
      SELECT
        SUM(CASE WHEN b.min_minor IS NULL THEN 1 ELSE 0 END) AS no_band,
        SUM(CASE WHEN b.min_minor IS NOT NULL AND c.base_salary_minor < b.min_minor THEN 1 ELSE 0 END) AS below,
        SUM(CASE WHEN b.min_minor IS NOT NULL AND c.base_salary_minor > b.max_minor THEN 1 ELSE 0 END) AS above,
        SUM(CASE WHEN b.min_minor IS NOT NULL
                  AND c.base_salary_minor >= b.min_minor
                  AND c.base_salary_minor <= b.max_minor THEN 1 ELSE 0 END) AS within,
        COALESCE(SUM(
          CASE WHEN b.min_minor IS NOT NULL AND c.base_salary_minor < b.min_minor
               -- Scale the local shortfall into USD using this row's own
               -- already-converted figures, so no FX join is needed.
               THEN CAST((b.min_minor - c.base_salary_minor) * (
                      CAST(c.annual_base_usd_minor AS REAL) / c.base_salary_minor
                    ) AS INTEGER)
          END
        ), 0) AS cost_to_minimum
      ${FROM_POPULATION}
      LEFT JOIN salary_bands b
        ON b.job_level_id = e.job_level_id AND b.country_code = e.country_code
      WHERE ${where.sql}
    `)
    .get(...where.params) as {
    no_band: number | null;
    below: number | null;
    above: number | null;
    within: number | null;
    cost_to_minimum: number;
  };

  return {
    below: row.below ?? 0,
    within: row.within ?? 0,
    above: row.above ?? 0,
    noBand: row.no_band ?? 0,
    costToMinimumUsdMinor: row.cost_to_minimum,
  };
}

export interface OutlierRow {
  readonly id: number;
  readonly name: string;
  readonly employeeCode: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly levelCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly baseSalaryMinor: number;
  readonly bandMinMinor: number;
  readonly bandMidMinor: number;
  readonly bandMaxMinor: number;
  readonly compaRatio: number;
}

/** The people furthest outside their band — worst first. */
export function getBandOutliers(
  db: RawDatabase,
  direction: 'BELOW' | 'ABOVE',
  limit: number,
  filters: AnalyticsFilters = {},
): OutlierRow[] {
  const where = population(filters);
  const comparison = direction === 'BELOW' ? 'c.base_salary_minor < b.min_minor' : 'c.base_salary_minor > b.max_minor';
  const order = direction === 'BELOW' ? 'ASC' : 'DESC';

  return db
    .prepare(`
      SELECT e.id,
             e.first_name || ' ' || e.last_name AS name,
             e.employee_code AS employeeCode,
             e.job_title AS jobTitle,
             d.name AS department,
             l.code AS levelCode,
             ctry.name AS countryName,
             e.currency,
             c.base_salary_minor AS baseSalaryMinor,
             b.min_minor AS bandMinMinor,
             b.mid_minor AS bandMidMinor,
             b.max_minor AS bandMaxMinor,
             CAST(c.base_salary_minor AS REAL) / b.mid_minor AS compaRatio
      ${FROM_POPULATION}
      JOIN departments d ON d.id = e.department_id
      JOIN job_levels l ON l.id = e.job_level_id
      JOIN countries ctry ON ctry.code = e.country_code
      JOIN salary_bands b ON b.job_level_id = e.job_level_id AND b.country_code = e.country_code
      WHERE ${where.sql} AND ${comparison}
      ORDER BY compaRatio ${order}
      LIMIT ?
    `)
    .all(...where.params, limit) as OutlierRow[];
}

// ---------------------------------------------------------------------------
// Pay equity
// ---------------------------------------------------------------------------

export interface GenderStats {
  readonly gender: string;
  readonly headcount: number;
  readonly medianUsdMinor: number | null;
  readonly meanUsdMinor: number | null;
}

/** Median and mean per gender across the whole filtered population. */
export function getGenderStats(db: RawDatabase, filters: AnalyticsFilters = {}): GenderStats[] {
  const where = population(filters);

  return db
    .prepare(`
      WITH ranked AS (
        SELECT e.gender AS gender,
               c.annual_base_usd_minor AS value,
               ROW_NUMBER() OVER (PARTITION BY e.gender ORDER BY c.annual_base_usd_minor) AS position,
               COUNT(*) OVER (PARTITION BY e.gender) AS group_size
        ${FROM_POPULATION}
        WHERE ${where.sql}
      )
      SELECT gender,
             MIN(group_size) AS headcount,
             AVG(value) AS mean,
             AVG(CASE WHEN position IN ((group_size + 1) / 2, (group_size + 2) / 2) THEN value END) AS median
      FROM ranked
      GROUP BY gender
    `)
    .all(...where.params)
    .map((row) => {
      const typed = row as { gender: string; headcount: number; mean: number | null; median: number | null };
      return {
        gender: typed.gender,
        headcount: typed.headcount,
        medianUsdMinor: typed.median === null ? null : Math.round(typed.median),
        meanUsdMinor: typed.mean === null ? null : Math.round(typed.mean),
      };
    });
}

export interface CohortStatsRow {
  readonly key: string;
  readonly maleCount: number;
  readonly femaleCount: number;
  readonly maleMedian: number | null;
  readonly femaleMedian: number | null;
  readonly maleMean: number | null;
  readonly femaleMean: number | null;
}

/**
 * Median and mean per gender within each (department, level) cohort.
 *
 * One query produces every comparison group the like-for-like figure needs.
 * The alternative — pulling ten thousand salaries into JavaScript and grouping
 * them there — would work at this size and stop working at the next one.
 */
export function getCohortStats(db: RawDatabase, filters: AnalyticsFilters = {}): CohortStatsRow[] {
  const where = population(filters);

  return db
    .prepare(`
      WITH ranked AS (
        SELECT d.name || ' · ' || l.code AS key,
               e.gender AS gender,
               c.annual_base_usd_minor AS value,
               ROW_NUMBER() OVER (PARTITION BY e.department_id, e.job_level_id, e.gender
                                  ORDER BY c.annual_base_usd_minor) AS position,
               COUNT(*) OVER (PARTITION BY e.department_id, e.job_level_id, e.gender) AS group_size
        ${FROM_POPULATION}
        JOIN departments d ON d.id = e.department_id
        JOIN job_levels l ON l.id = e.job_level_id
        -- Only the two groups a binary comparison can represent. Everyone else
        -- is counted in headcount elsewhere but cannot appear on either side.
        WHERE ${where.sql} AND e.gender IN ('MALE', 'FEMALE')
      ),
      per_gender AS (
        SELECT key, gender,
               MIN(group_size) AS headcount,
               AVG(value) AS mean,
               AVG(CASE WHEN position IN ((group_size + 1) / 2, (group_size + 2) / 2) THEN value END) AS median
        FROM ranked
        GROUP BY key, gender
      )
      SELECT key,
             COALESCE(SUM(CASE WHEN gender = 'MALE' THEN headcount END), 0) AS maleCount,
             COALESCE(SUM(CASE WHEN gender = 'FEMALE' THEN headcount END), 0) AS femaleCount,
             MAX(CASE WHEN gender = 'MALE' THEN median END) AS maleMedian,
             MAX(CASE WHEN gender = 'FEMALE' THEN median END) AS femaleMedian,
             MAX(CASE WHEN gender = 'MALE' THEN mean END) AS maleMean,
             MAX(CASE WHEN gender = 'FEMALE' THEN mean END) AS femaleMean
      FROM per_gender
      GROUP BY key
    `)
    .all(...where.params) as CohortStatsRow[];
}

/** Share of each gender at each level — the representation picture. */
export interface RepresentationRow {
  readonly levelCode: string;
  readonly levelRank: number;
  readonly femaleCount: number;
  readonly maleCount: number;
  readonly otherCount: number;
}

export function getRepresentationByLevel(
  db: RawDatabase,
  filters: AnalyticsFilters = {},
): RepresentationRow[] {
  const where = population(filters);

  return db
    .prepare(`
      SELECT l.code AS levelCode,
             l.rank AS levelRank,
             SUM(CASE WHEN e.gender = 'FEMALE' THEN 1 ELSE 0 END) AS femaleCount,
             SUM(CASE WHEN e.gender = 'MALE' THEN 1 ELSE 0 END) AS maleCount,
             SUM(CASE WHEN e.gender NOT IN ('FEMALE', 'MALE') THEN 1 ELSE 0 END) AS otherCount
      ${FROM_POPULATION}
      JOIN job_levels l ON l.id = e.job_level_id
      WHERE ${where.sql}
      GROUP BY l.code, l.rank
      ORDER BY l.rank
    `)
    .all(...where.params) as RepresentationRow[];
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  readonly asOf: string;
  readonly headcount: number;
  readonly totalAnnualUsdMinor: number;
}

/**
 * Annualised payroll for the *current* workforce, evaluated at past dates.
 *
 * Deliberately not "payroll as it was" — this system records no termination
 * date, so it cannot say who was employed in March 2024. Holding the population
 * fixed and moving only the salaries answers a question it genuinely can:
 * how much has the pay of today's staff risen over time, without joiners and
 * leavers muddying the line. The chart says so on its face.
 */
export function getPayrollTrend(
  db: RawDatabase,
  from: string,
  to: string,
  filters: AnalyticsFilters = {},
): TrendPoint[] {
  const where = population(filters);

  return db
    .prepare(`
      WITH RECURSIVE periods(as_of) AS (
        SELECT date(?, 'start of month')
        UNION ALL
        SELECT date(as_of, '+3 months') FROM periods WHERE date(as_of, '+3 months') <= ?
      )
      SELECT p.as_of AS asOf,
             COUNT(hist.employee_id) AS headcount,
             COALESCE(SUM(hist.annual_base_usd_minor), 0) AS totalAnnualUsdMinor
      FROM periods p
      LEFT JOIN (
        SELECT h.employee_id, h.annual_base_usd_minor, h.effective_from, h.effective_to
        FROM compensations h
        JOIN employees e ON e.id = h.employee_id
        JOIN compensations c ON c.id = e.current_compensation_id
        WHERE ${where.sql}
      ) hist
        ON hist.effective_from <= p.as_of
       AND (hist.effective_to IS NULL OR hist.effective_to >= p.as_of)
      GROUP BY p.as_of
      ORDER BY p.as_of
    `)
    .all(from, to, ...where.params) as TrendPoint[];
}
