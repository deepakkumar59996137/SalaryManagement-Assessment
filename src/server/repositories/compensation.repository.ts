import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { FxRateTable } from '@/domain/fx';
import type { CurrencyCode } from '@/domain/money';
import type { IsoDate } from '@/domain/dates';
import type { AppDatabase } from '../db/client';
import {
  compensations,
  employees,
  fxRates,
  salaryBands,
  type ChangeReason,
  type Compensation,
} from '../db/schema';

/**
 * Compensation history and the writes that maintain it.
 *
 * Every mutation here is called from inside a transaction in
 * compensation.service.ts — they are not safe to use individually, because it
 * is the *sequence* that preserves the ADR-0002 invariants.
 */

export interface CompensationRow {
  readonly id: number;
  readonly employeeId: number;
  readonly baseSalaryMinor: number;
  readonly currency: CurrencyCode;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly annualBaseUsdMinor: number;
  readonly changeReason: ChangeReason;
  readonly note: string | null;
  readonly changedByUserId: number | null;
  readonly createdAt: string;
}

/** Full history, oldest first — the order the timeline is drawn in. */
export function findHistory(db: AppDatabase, employeeId: number): CompensationRow[] {
  return db
    .select()
    .from(compensations)
    .where(eq(compensations.employeeId, employeeId))
    .orderBy(asc(compensations.effectiveFrom), asc(compensations.id))
    .all() as CompensationRow[];
}

export function findOpenInterval(db: AppDatabase, employeeId: number): CompensationRow | undefined {
  return db
    .select()
    .from(compensations)
    .where(and(eq(compensations.employeeId, employeeId), isNull(compensations.effectiveTo)))
    .get() as CompensationRow | undefined;
}

/**
 * The interval covering a date — the row a new revision has to be spliced into.
 *
 * An open interval (effective_to IS NULL) covers everything from its start
 * onwards, so it matches any date at or after `on`.
 */
export function findIntervalCovering(
  db: AppDatabase,
  employeeId: number,
  on: IsoDate,
): CompensationRow | undefined {
  return db
    .select()
    .from(compensations)
    .where(
      and(
        eq(compensations.employeeId, employeeId),
        lte(compensations.effectiveFrom, on),
        or(isNull(compensations.effectiveTo), sql`${compensations.effectiveTo} >= ${on}`),
      ),
    )
    .orderBy(desc(compensations.effectiveFrom))
    .get() as CompensationRow | undefined;
}

export function findByExactStart(
  db: AppDatabase,
  employeeId: number,
  effectiveFrom: IsoDate,
): CompensationRow | undefined {
  return db
    .select()
    .from(compensations)
    .where(
      and(eq(compensations.employeeId, employeeId), eq(compensations.effectiveFrom, effectiveFrom)),
    )
    .get() as CompensationRow | undefined;
}

export interface NewCompensationInput {
  readonly employeeId: number;
  readonly baseSalaryMinor: number;
  readonly currency: CurrencyCode;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly annualBaseUsdMinor: number;
  readonly changeReason: ChangeReason;
  readonly note: string | null;
  readonly changedByUserId: number;
  readonly createdAt: string;
}

export function insertCompensation(db: AppDatabase, input: NewCompensationInput): number {
  const inserted = db
    .insert(compensations)
    .values(input)
    .returning({ id: compensations.id })
    .get();

  return inserted.id;
}

/** Close an interval the day before its successor begins. */
export function closeInterval(db: AppDatabase, id: number, effectiveTo: IsoDate): void {
  db.update(compensations).set({ effectiveTo }).where(eq(compensations.id, id)).run();
}

/** Overwrite a row in place — used when a revision lands on an existing start date. */
export function replaceCompensation(
  db: AppDatabase,
  id: number,
  values: Pick<Compensation, 'baseSalaryMinor' | 'annualBaseUsdMinor' | 'changeReason' | 'note' | 'changedByUserId'>,
): void {
  db.update(compensations).set(values).where(eq(compensations.id, id)).run();
}

export function setCurrentCompensation(
  db: AppDatabase,
  employeeId: number,
  compensationId: number,
  updatedAt: string,
): void {
  db
    .update(employees)
    .set({ currentCompensationId: compensationId, updatedAt })
    .where(eq(employees.id, employeeId))
    .run();
}

// ---------------------------------------------------------------------------
// Supporting lookups
// ---------------------------------------------------------------------------

/** The FX snapshot, as the plain table src/domain/fx.ts expects. */
export function findFxRates(db: AppDatabase): FxRateTable {
  const rows = db.select().from(fxRates).all();
  return Object.fromEntries(rows.map((row) => [row.currency, row.rateToUsd])) as FxRateTable;
}

export interface BandRow {
  readonly minMinor: number;
  readonly midMinor: number;
  readonly maxMinor: number;
  readonly currency: string;
}

export function findBandFor(
  db: AppDatabase,
  jobLevelId: number,
  countryCode: string,
): BandRow | undefined {
  return db
    .select({
      minMinor: salaryBands.minMinor,
      midMinor: salaryBands.midMinor,
      maxMinor: salaryBands.maxMinor,
      currency: salaryBands.currency,
    })
    .from(salaryBands)
    .where(and(eq(salaryBands.jobLevelId, jobLevelId), eq(salaryBands.countryCode, countryCode)))
    .get();
}

export interface EmployeeForRevision {
  readonly id: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly currency: CurrencyCode;
  readonly hireDate: IsoDate;
  readonly status: 'ACTIVE' | 'TERMINATED';
  readonly jobLevelId: number;
  readonly countryCode: string;
  readonly currentCompensationId: number | null;
}

export function findEmployeeForRevision(
  db: AppDatabase,
  employeeId: number,
): EmployeeForRevision | undefined {
  return db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      currency: employees.currency,
      hireDate: employees.hireDate,
      status: employees.status,
      jobLevelId: employees.jobLevelId,
      countryCode: employees.countryCode,
      currentCompensationId: employees.currentCompensationId,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .get() as EmployeeForRevision | undefined;
}
