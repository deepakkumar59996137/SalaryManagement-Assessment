import { and, asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { compensations, countries, departments, employees, jobLevels, salaryBands } from '../db/schema';

/** Lookups the CSV import and export need. */

export interface EmployeeByCode {
  readonly id: number;
  readonly employeeCode: string;
  readonly currentSalaryMinor: number | null;
  readonly currentUsdMinor: number | null;
}

export function findEmployeeByCode(db: AppDatabase, code: string): EmployeeByCode | undefined {
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      currentSalaryMinor: compensations.baseSalaryMinor,
      currentUsdMinor: compensations.annualBaseUsdMinor,
    })
    .from(employees)
    .leftJoin(compensations, eq(compensations.id, employees.currentCompensationId))
    .where(eq(employees.employeeCode, code))
    .get();
}

export interface ExportRow {
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
  readonly employmentType: string;
  readonly status: string;
  readonly hireDate: string;
  readonly gender: string;
  readonly managerCode: string | null;
  readonly baseSalaryMinor: number | null;
  readonly annualBaseUsdMinor: number | null;
  readonly effectiveFrom: string | null;
  readonly bandMinMinor: number | null;
  readonly bandMidMinor: number | null;
  readonly bandMaxMinor: number | null;
}

/**
 * Everything about every employee, for the export.
 *
 * Unpaginated by design — the point of an export is to get the whole thing.
 * Ten thousand rows is a few megabytes of CSV, which is well within what a
 * single response can carry and what Excel will open.
 */
export function findAllForExport(db: AppDatabase): ExportRow[] {
  const manager = db.$with('manager').as(
    db.select({ id: employees.id, code: employees.employeeCode }).from(employees),
  );

  return db
    .with(manager)
    .select({
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
      employmentType: employees.employmentType,
      status: employees.status,
      hireDate: employees.hireDate,
      gender: employees.gender,
      managerCode: manager.code,
      baseSalaryMinor: compensations.baseSalaryMinor,
      annualBaseUsdMinor: compensations.annualBaseUsdMinor,
      effectiveFrom: compensations.effectiveFrom,
      bandMinMinor: salaryBands.minMinor,
      bandMidMinor: salaryBands.midMinor,
      bandMaxMinor: salaryBands.maxMinor,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(jobLevels, eq(jobLevels.id, employees.jobLevelId))
    .innerJoin(countries, eq(countries.code, employees.countryCode))
    .leftJoin(compensations, eq(compensations.id, employees.currentCompensationId))
    .leftJoin(manager, eq(manager.id, employees.managerId))
    .leftJoin(
      salaryBands,
      and(
        eq(salaryBands.jobLevelId, employees.jobLevelId),
        eq(salaryBands.countryCode, employees.countryCode),
      ),
    )
    .orderBy(asc(employees.employeeCode))
    .all() as ExportRow[];
}
