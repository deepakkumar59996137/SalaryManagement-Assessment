import { bandPosition, compaRatio, rangePenetration, type SalaryBand } from '@/domain/compensation';
import type { CurrencyCode } from '@/domain/money';
import type { AppDatabase } from '../db/client';
import { NotFoundError } from '../http/errors';
import {
  countDirectory,
  countDirectReports,
  type DirectoryQuery,
  type DirectoryRow,
  type EmployeeFilters,
  type EmployeeSortKey,
  findDirectoryPage,
  findEmployeeById,
  findFilterOptions,
  type FilterOptions,
  findManagerOf,
  type ManagerSummary,
} from '../repositories/employee.repository';

/**
 * Employee directory and detail.
 *
 * The repository returns rows; this layer turns them into something the UI can
 * render — attaching the band measures from src/domain so that the number shown
 * beside a salary comes from the same function the tests cover.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export interface EmployeeListItem {
  readonly id: number;
  readonly employeeCode: string;
  readonly name: string;
  readonly email: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: CurrencyCode;
  readonly status: 'ACTIVE' | 'TERMINATED';
  readonly employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  readonly hireDate: string;
  readonly baseSalaryMinor: number | null;
  readonly annualBaseUsdMinor: number | null;
  readonly band: SalaryBand | null;
  readonly compaRatio: number | null;
  readonly rangePenetration: number | null;
  readonly bandPosition: 'BELOW' | 'WITHIN' | 'ABOVE' | 'UNKNOWN';
}

export interface EmployeePage {
  readonly items: readonly EmployeeListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export function toListItem(row: DirectoryRow): EmployeeListItem {
  const band: SalaryBand | null =
    row.bandMinMinor !== null && row.bandMidMinor !== null && row.bandMaxMinor !== null
      ? { minMinor: row.bandMinMinor, midMinor: row.bandMidMinor, maxMinor: row.bandMaxMinor }
      : null;

  const salary = row.baseSalaryMinor;

  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: `${row.firstName} ${row.lastName}`,
    email: row.email,
    jobTitle: row.jobTitle,
    department: row.department,
    levelCode: row.levelCode,
    countryCode: row.countryCode,
    countryName: row.countryName,
    currency: row.currency as CurrencyCode,
    status: row.status,
    employmentType: row.employmentType,
    hireDate: row.hireDate,
    baseSalaryMinor: salary,
    annualBaseUsdMinor: row.annualBaseUsdMinor,
    band,
    compaRatio: band && salary !== null ? compaRatio(salary, band) : null,
    rangePenetration: band && salary !== null ? rangePenetration(salary, band) : null,
    // Matches the CASE expression the repository filters on; an integration
    // test asserts the two never disagree.
    bandPosition: band && salary !== null ? bandPosition(salary, band) : 'UNKNOWN',
  };
}

export function listEmployees(db: AppDatabase, query: DirectoryQuery): EmployeePage {
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const total = countDirectory(db, query.filters);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A filter change can leave the browser asking for page 9 of a 2-page result.
  // Clamping beats returning an empty table with no explanation.
  const page = Math.min(Math.max(1, query.page), totalPages);

  const rows = findDirectoryPage(db, { ...query, page, pageSize });

  return { items: rows.map(toListItem), total, page, pageSize, totalPages };
}

export interface EmployeeDetail extends EmployeeListItem {
  readonly manager: ManagerSummary | null;
  readonly directReports: number;
}

export function getEmployee(db: AppDatabase, id: number): EmployeeDetail {
  const row = findEmployeeById(db, id);
  if (!row) throw new NotFoundError('Employee');

  return {
    ...toListItem(row),
    manager: findManagerOf(db, id) ?? null,
    directReports: countDirectReports(db, id),
  };
}

export function getFilterOptions(db: AppDatabase): FilterOptions {
  return findFilterOptions(db);
}

export type { DirectoryQuery, EmployeeFilters, EmployeeSortKey, FilterOptions };
