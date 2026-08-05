import {
  CHANGE_REASON_LABELS,
  type ChangeReasonCode,
  summariseAgainstBand,
  type SalaryBand,
} from '@/domain/compensation';
import { addDays, addYears, type Clock, formatDateLong, type IsoDate, systemClock } from '@/domain/dates';
import { toUsdMinor } from '@/domain/fx';
import { type CurrencyCode, formatMoney, formatPercent, percentChange, toMinor } from '@/domain/money';
import type { AppDatabase } from '../db/client';
import { ConflictError, NotFoundError, ValidationError } from '../http/errors';
import { insertAuditEntry } from '../repositories/audit.repository';
import {
  closeInterval,
  type CompensationRow,
  type EmployeeForRevision,
  findBandFor,
  findByExactStart,
  findEmployeeForRevision,
  findFxRates,
  findHistory,
  findIntervalCovering,
  insertCompensation,
  replaceCompensation,
  setCurrentCompensation,
} from '../repositories/compensation.repository';

/**
 * Salary revisions — the one write path in this system with real invariants.
 *
 * From ADR-0002, all three must hold after every change:
 *
 *   1. An employee has exactly one open interval (effective_to IS NULL).
 *   2. Intervals never overlap.
 *   3. Intervals are contiguous — each ends the day before the next begins.
 *
 * Everything happens in a single transaction, so a failure part-way through
 * leaves the history untouched rather than half-rewritten. The database also
 * carries a partial unique index enforcing (1) independently, as a backstop.
 */

/** A revision more than two years out is a typo, not a plan. */
const MAX_FUTURE_YEARS = 2;

export interface RevisionInput {
  readonly employeeId: number;
  /**
   * The salary as a person types it — 92,000, not 9,200,000.
   *
   * Conversion to minor units happens here rather than at the HTTP boundary,
   * because it depends on the employee's currency and a caller should not have
   * to know that yen has no decimal places.
   */
  readonly baseSalaryMajor: number;
  readonly effectiveFrom: IsoDate;
  readonly changeReason: ChangeReasonCode;
  readonly note?: string | null;
}

export interface RevisionResult {
  readonly compensationId: number;
  readonly previousSalaryMinor: number | null;
  readonly newSalaryMinor: number;
  readonly currency: CurrencyCode;
  readonly percentChange: number | null;
  readonly effectiveFrom: IsoDate;
  /** False for a back-dated correction that lands behind a later revision. */
  readonly isCurrent: boolean;
  readonly summary: string;
}

/**
 * Everything a revision needs, validated and converted, ready to write.
 *
 * Separating this from the write is what lets the CSV import validate a whole
 * file, report on it, and then apply every row inside ONE transaction — rather
 * than opening a nested transaction per row.
 */
export interface PreparedRevision {
  readonly employee: EmployeeForRevision;
  readonly baseSalaryMinor: number;
  readonly annualBaseUsdMinor: number;
  readonly effectiveFrom: IsoDate;
  readonly changeReason: ChangeReasonCode;
  readonly note: string | null;
}

/** Validate and convert. Throws on anything that would make the write invalid. */
export function prepareRevision(
  db: AppDatabase,
  input: RevisionInput,
  clock: Clock = systemClock,
): PreparedRevision {
  const employee = findEmployeeForRevision(db, input.employeeId);
  if (!employee) throw new NotFoundError('Employee');

  if (employee.status !== 'ACTIVE') {
    throw new ConflictError('This employee has left the organisation, so their salary cannot be changed');
  }

  if (!Number.isFinite(input.baseSalaryMajor) || input.baseSalaryMajor <= 0) {
    throw new ValidationError('Enter a salary greater than zero');
  }

  const baseSalaryMinor = toMinor(input.baseSalaryMajor, employee.currency);
  if (baseSalaryMinor <= 0) {
    throw new ValidationError('Enter a salary greater than zero');
  }

  if (input.effectiveFrom < employee.hireDate) {
    throw new ValidationError(
      `A salary cannot take effect before the hire date of ${formatDateLong(employee.hireDate)}`,
    );
  }

  const latestAllowed = addYears(clock.today(), MAX_FUTURE_YEARS);
  if (input.effectiveFrom > latestAllowed) {
    throw new ValidationError(
      `An effective date more than ${MAX_FUTURE_YEARS} years ahead is probably a typo`,
    );
  }

  return {
    employee,
    baseSalaryMinor,
    annualBaseUsdMinor: toUsdMinor(baseSalaryMinor, employee.currency, findFxRates(db)),
    effectiveFrom: input.effectiveFrom,
    changeReason: input.changeReason,
    note: input.note ?? null,
  };
}

/**
 * Write a prepared revision.
 *
 * Must be called inside a transaction — `tx` is the handle. On its own this
 * function can leave the history in a state that violates ADR-0002 if it
 * throws part-way, which is exactly why it is never called outside one.
 */
export function commitRevision(
  tx: AppDatabase,
  prepared: PreparedRevision,
  actorUserId: number,
  now: string,
): RevisionResult {
  const { employee, baseSalaryMinor, annualBaseUsdMinor, effectiveFrom } = prepared;

  // An existing row starting on the same day is corrected in place. Splicing
  // a new one in would create a zero-length interval — a salary that was
  // never true for a single day.
  const exact = findByExactStart(tx, employee.id, effectiveFrom);

  const previous = exact ?? findIntervalCovering(tx, employee.id, effectiveFrom);
  if (!previous) {
    throw new ConflictError('No salary record covers that date, so there is nothing to revise from');
  }

  let compensationId: number;
  let isCurrent: boolean;

  if (exact) {
    replaceCompensation(tx, exact.id, {
      baseSalaryMinor,
      annualBaseUsdMinor,
      changeReason: prepared.changeReason,
      note: prepared.note,
      changedByUserId: actorUserId,
    });
    compensationId = exact.id;
    isCurrent = exact.effectiveTo === null;
  } else {
    // Close the predecessor *before* inserting, so there is never a moment
    // with two open intervals — which the partial unique index would reject.
    closeInterval(tx, previous.id, addDays(effectiveFrom, -1));

    compensationId = insertCompensation(tx, {
      employeeId: employee.id,
      baseSalaryMinor,
      currency: employee.currency,
      effectiveFrom,
      // The new row inherits whatever the predecessor's end was: null when
      // splicing onto the end, or the predecessor's old end when back-dating
      // into the middle of the history.
      effectiveTo: previous.effectiveTo,
      annualBaseUsdMinor,
      changeReason: prepared.changeReason,
      note: prepared.note,
      changedByUserId: actorUserId,
      createdAt: now,
    });
    isCurrent = previous.effectiveTo === null;
  }

  if (isCurrent) {
    setCurrentCompensation(tx, employee.id, compensationId, now);
  }

  const change = percentChange(previous.baseSalaryMinor, baseSalaryMinor);
  const summary = describeRevision({
    employeeName: `${employee.firstName} ${employee.lastName}`,
    currency: employee.currency,
    fromMinor: previous.baseSalaryMinor,
    toMinorAmount: baseSalaryMinor,
    change,
    effectiveFrom,
    reason: prepared.changeReason,
  });

  insertAuditEntry(tx, {
    actorUserId,
    entity: 'COMPENSATION',
    entityId: compensationId,
    action: prepared.changeReason === 'IMPORT' ? 'IMPORT' : 'SALARY_REVISION',
    beforeJson: JSON.stringify({
      baseSalaryMinor: previous.baseSalaryMinor,
      currency: previous.currency,
      effectiveFrom: previous.effectiveFrom,
      effectiveTo: previous.effectiveTo,
      changeReason: previous.changeReason,
    }),
    afterJson: JSON.stringify({
      employeeId: employee.id,
      baseSalaryMinor,
      currency: employee.currency,
      effectiveFrom,
      annualBaseUsdMinor,
      changeReason: prepared.changeReason,
      note: prepared.note,
    }),
    summary,
    at: now,
  });

  return {
    compensationId,
    previousSalaryMinor: previous.baseSalaryMinor,
    newSalaryMinor: baseSalaryMinor,
    currency: employee.currency,
    percentChange: change,
    effectiveFrom,
    isCurrent,
    summary,
  };
}

export function reviseSalary(
  db: AppDatabase,
  input: RevisionInput,
  actorUserId: number,
  clock: Clock = systemClock,
): RevisionResult {
  const prepared = prepareRevision(db, input, clock);
  return db.transaction((tx) => commitRevision(tx, prepared, actorUserId, clock.now()));
}

function describeRevision(details: {
  employeeName: string;
  currency: CurrencyCode;
  fromMinor: number;
  toMinorAmount: number;
  change: number | null;
  effectiveFrom: IsoDate;
  reason: ChangeReasonCode;
}): string {
  const { employeeName, currency, fromMinor, toMinorAmount, change, effectiveFrom, reason } = details;

  const verb = toMinorAmount > fromMinor ? 'increased' : toMinorAmount < fromMinor ? 'reduced' : 'restated';
  const from = formatMoney(fromMinor, currency, { compactDecimals: true });
  const to = formatMoney(toMinorAmount, currency, { compactDecimals: true });
  const delta = change === null || change === 0 ? '' : ` (${change > 0 ? '+' : ''}${formatPercent(change)})`;

  return `${employeeName}: salary ${verb} from ${from} to ${to}${delta}, effective ${formatDateLong(effectiveFrom)} — ${CHANGE_REASON_LABELS[reason]}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CompensationHistoryEntry {
  readonly id: number;
  readonly baseSalaryMinor: number;
  readonly currency: CurrencyCode;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly annualBaseUsdMinor: number;
  readonly changeReason: ChangeReasonCode;
  readonly note: string | null;
  readonly isCurrent: boolean;
  /** Change from the interval before this one. Null for the first. */
  readonly percentChange: number | null;
  readonly changeMinor: number | null;
}

/** Salary history, oldest first, with each step's change already worked out. */
export function getCompensationHistory(
  db: AppDatabase,
  employeeId: number,
): CompensationHistoryEntry[] {
  const rows = findHistory(db, employeeId);

  return rows.map((row: CompensationRow, index) => {
    const previous = rows[index - 1];

    return {
      id: row.id,
      baseSalaryMinor: row.baseSalaryMinor,
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      annualBaseUsdMinor: row.annualBaseUsdMinor,
      changeReason: row.changeReason,
      note: row.note,
      isCurrent: row.effectiveTo === null,
      percentChange: previous ? percentChange(previous.baseSalaryMinor, row.baseSalaryMinor) : null,
      changeMinor: previous ? row.baseSalaryMinor - previous.baseSalaryMinor : null,
    };
  });
}

export interface BandContext {
  readonly band: SalaryBand;
  readonly currency: CurrencyCode;
  readonly summary: ReturnType<typeof summariseAgainstBand>;
}

/**
 * How a proposed salary would sit against the band.
 *
 * Used by the raise dialog to show the effect before it is saved — the point
 * being that "is 92,000 reasonable for this role?" is answerable at the moment
 * the number is typed rather than after it is committed.
 */
export function previewAgainstBand(
  db: AppDatabase,
  employeeId: number,
  proposedSalaryMinor: number,
): BandContext | null {
  const employee = findEmployeeForRevision(db, employeeId);
  if (!employee) throw new NotFoundError('Employee');

  const band = findBandFor(db, employee.jobLevelId, employee.countryCode);
  if (!band) return null;

  const shape: SalaryBand = {
    minMinor: band.minMinor,
    midMinor: band.midMinor,
    maxMinor: band.maxMinor,
  };

  return {
    band: shape,
    currency: employee.currency,
    summary: summariseAgainstBand(proposedSalaryMinor, shape),
  };
}
