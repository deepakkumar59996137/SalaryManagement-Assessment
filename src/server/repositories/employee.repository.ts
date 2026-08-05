import { and, asc, desc, eq, isNotNull, isNull, like, or, type SQL, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import {
  compensations,
  countries,
  departments,
  employees,
  jobLevels,
  salaryBands,
} from '../db/schema';

/**
 * The employee directory query.
 *
 * This is the hottest read path in the application — 10,000 rows, filtered,
 * sorted and paginated on every keystroke. Two things keep it fast:
 *
 *   - `employees.current_compensation_id` (ADR-0003) makes current salary a
 *     plain join rather than a correlated subquery per row.
 *   - Filtering, sorting and counting all happen in SQL. The page handler never
 *     sees more than `pageSize` rows.
 */

export interface EmployeeFilters {
  readonly search?: string;
  readonly departmentId?: number;
  readonly jobLevelId?: number;
  readonly countryCode?: string;
  readonly status?: 'ACTIVE' | 'TERMINATED';
  readonly employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  /** Where the salary sits against the band for its level and country. */
  readonly bandPosition?: 'BELOW' | 'WITHIN' | 'ABOVE';
}

export type EmployeeSortKey =
  | 'name'
  | 'salary'
  | 'level'
  | 'department'
  | 'country'
  | 'hireDate'
  | 'compaRatio';

export interface DirectoryQuery {
  readonly filters: EmployeeFilters;
  readonly sortKey: EmployeeSortKey;
  readonly sortDirection: 'asc' | 'desc';
  /** 1-based. */
  readonly page: number;
  readonly pageSize: number;
}

export interface DirectoryRow {
  readonly id: number;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly status: 'ACTIVE' | 'TERMINATED';
  readonly employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  readonly hireDate: string;
  readonly baseSalaryMinor: number | null;
  readonly annualBaseUsdMinor: number | null;
  readonly bandMinMinor: number | null;
  readonly bandMidMinor: number | null;
  readonly bandMaxMinor: number | null;
}

/**
 * Band position, expressed in SQL.
 *
 * Must agree exactly with `bandPosition()` in domain/compensation.ts, since one
 * filters and the other labels. An integration test asserts they do.
 */
const bandPositionSql = sql<string>`
  CASE
    WHEN ${compensations.baseSalaryMinor} IS NULL OR ${salaryBands.minMinor} IS NULL THEN 'UNKNOWN'
    WHEN ${compensations.baseSalaryMinor} < ${salaryBands.minMinor} THEN 'BELOW'
    WHEN ${compensations.baseSalaryMinor} > ${salaryBands.maxMinor} THEN 'ABOVE'
    ELSE 'WITHIN'
  END
`;

/** Salary as a fraction of the band midpoint. NULL rather than a division by zero. */
const compaRatioSql = sql<number>`
  CASE WHEN ${salaryBands.midMinor} > 0
       THEN CAST(${compensations.baseSalaryMinor} AS REAL) / ${salaryBands.midMinor}
  END
`;

function buildWhere(filters: EmployeeFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (filters.search?.trim()) {
    // 10,000 rows makes this a sub-5ms scan; FTS5 would be infrastructure with
    // no user-visible benefit at this size. See requirements.md.
    const term = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${employees.firstName} || ' ' || ${employees.lastName})`, term),
        like(sql`lower(${employees.employeeCode})`, term),
        like(sql`lower(${employees.email})`, term),
        like(sql`lower(${employees.jobTitle})`, term),
      ),
    );
  }

  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.jobLevelId) conditions.push(eq(employees.jobLevelId, filters.jobLevelId));
  if (filters.countryCode) conditions.push(eq(employees.countryCode, filters.countryCode));
  if (filters.status) conditions.push(eq(employees.status, filters.status));
  if (filters.employmentType) conditions.push(eq(employees.employmentType, filters.employmentType));
  if (filters.bandPosition) conditions.push(sql`${bandPositionSql} = ${filters.bandPosition}`);

  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  return present.length > 0 ? and(...present) : undefined;
}

function orderBy(key: EmployeeSortKey, direction: 'asc' | 'desc'): SQL[] {
  const order = direction === 'asc' ? asc : desc;

  switch (key) {
    case 'salary':
      // Always the USD-normalised figure: sorting by local amounts would rank
      // ¥8,000,000 above $150,000 and mean nothing across countries.
      return [order(compensations.annualBaseUsdMinor), asc(employees.id)];
    case 'level':
      return [order(jobLevels.rank), asc(employees.lastName), asc(employees.id)];
    case 'department':
      return [order(departments.name), asc(employees.lastName), asc(employees.id)];
    case 'country':
      return [order(employees.countryCode), asc(employees.lastName), asc(employees.id)];
    case 'hireDate':
      return [order(employees.hireDate), asc(employees.id)];
    case 'compaRatio':
      return [order(compaRatioSql), asc(employees.id)];
    case 'name':
    default:
      return [order(employees.lastName), order(employees.firstName), asc(employees.id)];
  }
}

const SELECTION = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  firstName: employees.firstName,
  lastName: employees.lastName,
  email: employees.email,
  jobTitle: employees.jobTitle,
  department: departments.name,
  levelCode: jobLevels.code,
  countryCode: employees.countryCode,
  countryName: countries.name,
  currency: employees.currency,
  status: employees.status,
  employmentType: employees.employmentType,
  hireDate: employees.hireDate,
  baseSalaryMinor: compensations.baseSalaryMinor,
  annualBaseUsdMinor: compensations.annualBaseUsdMinor,
  bandMinMinor: salaryBands.minMinor,
  bandMidMinor: salaryBands.midMinor,
  bandMaxMinor: salaryBands.maxMinor,
} as const;

/**
 * Shared join shape.
 *
 * Compensation and band are LEFT joins on purpose: an employee with no salary
 * on record is a data problem the directory should show, not hide.
 */
function directoryFrom(db: AppDatabase) {
  return db
    .select(SELECTION)
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(jobLevels, eq(jobLevels.id, employees.jobLevelId))
    .innerJoin(countries, eq(countries.code, employees.countryCode))
    .leftJoin(compensations, eq(compensations.id, employees.currentCompensationId))
    .leftJoin(
      salaryBands,
      and(
        eq(salaryBands.jobLevelId, employees.jobLevelId),
        eq(salaryBands.countryCode, employees.countryCode),
      ),
    );
}

export function findDirectoryPage(db: AppDatabase, query: DirectoryQuery): DirectoryRow[] {
  return directoryFrom(db)
    .where(buildWhere(query.filters))
    .orderBy(...orderBy(query.sortKey, query.sortDirection))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all() as DirectoryRow[];
}

export function countDirectory(db: AppDatabase, filters: EmployeeFilters): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(jobLevels, eq(jobLevels.id, employees.jobLevelId))
    .innerJoin(countries, eq(countries.code, employees.countryCode))
    .leftJoin(compensations, eq(compensations.id, employees.currentCompensationId))
    .leftJoin(
      salaryBands,
      and(
        eq(salaryBands.jobLevelId, employees.jobLevelId),
        eq(salaryBands.countryCode, employees.countryCode),
      ),
    )
    .where(buildWhere(filters))
    .get();

  return result?.total ?? 0;
}

export function findEmployeeById(db: AppDatabase, id: number): DirectoryRow | undefined {
  return directoryFrom(db).where(eq(employees.id, id)).get() as DirectoryRow | undefined;
}

export interface ManagerSummary {
  readonly id: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly jobTitle: string;
}

export function findManagerOf(db: AppDatabase, employeeId: number): ManagerSummary | undefined {
  const manager = employees;
  const report = sql`(SELECT manager_id FROM employees WHERE id = ${employeeId})`;

  return db
    .select({
      id: manager.id,
      firstName: manager.firstName,
      lastName: manager.lastName,
      jobTitle: manager.jobTitle,
    })
    .from(manager)
    .where(sql`${manager.id} = ${report}`)
    .get();
}

export function countDirectReports(db: AppDatabase, employeeId: number): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(employees)
    .where(and(eq(employees.managerId, employeeId), eq(employees.status, 'ACTIVE')))
    .get();

  return result?.total ?? 0;
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export interface FilterOptions {
  readonly departments: readonly { id: number; name: string }[];
  readonly levels: readonly { id: number; code: string; name: string; rank: number }[];
  readonly countries: readonly { code: string; name: string; currency: string }[];
}

/** Everything the filter bar needs, in one round trip. */
export function findFilterOptions(db: AppDatabase): FilterOptions {
  return {
    departments: db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
      .all(),
    levels: db
      .select({ id: jobLevels.id, code: jobLevels.code, name: jobLevels.name, rank: jobLevels.rank })
      .from(jobLevels)
      .orderBy(asc(jobLevels.rank))
      .all(),
    countries: db
      .select({ code: countries.code, name: countries.name, currency: countries.currency })
      .from(countries)
      .orderBy(asc(countries.name))
      .all(),
  };
}

/** Employees with no open compensation interval — a data integrity check. */
export function findEmployeesWithoutSalary(db: AppDatabase): { id: number; employeeCode: string }[] {
  return db
    .select({ id: employees.id, employeeCode: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.status, 'ACTIVE'), isNull(employees.currentCompensationId)))
    .all();
}

/** Guard for the pointer invariant in ADR-0003: every pointer must resolve. */
export function countDanglingCompensationPointers(db: AppDatabase): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(employees)
    .leftJoin(compensations, eq(compensations.id, employees.currentCompensationId))
    .where(and(isNotNull(employees.currentCompensationId), isNull(compensations.id)))
    .get();

  return result?.total ?? 0;
}
