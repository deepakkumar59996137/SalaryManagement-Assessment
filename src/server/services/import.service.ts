import { CHANGE_REASON_LABELS, type ChangeReasonCode, SELECTABLE_CHANGE_REASONS } from '@/domain/compensation';
import { parseCsv, toRecords } from '@/domain/csv';
import { type Clock, isIsoDate, type IsoDate, systemClock } from '@/domain/dates';
import { type CurrencyCode, formatMoney, percentChange } from '@/domain/money';
import type { AppDatabase } from '../db/client';
import { AppError, ValidationError } from '../http/errors';
import { insertAuditEntry } from '../repositories/audit.repository';
import { commitRevision, prepareRevision, type PreparedRevision } from './compensation.service';
import { findEmployeeByCode } from '../repositories/import.repository';

/**
 * Bulk salary changes from a CSV file.
 *
 * The HR team is coming off spreadsheets, and an annual review cycle is a
 * spreadsheet of a few hundred rows. Typing them one at a time is the thing
 * this product is supposed to remove, so the import has to be trustworthy:
 *
 *   1. Every row is validated before anything is written.
 *   2. The preview shows what will happen, per row and in total.
 *   3. Applying is all or nothing.
 *
 * That third point is the important one. A partially-applied payroll file is
 * worse than a rejected one: some people get their raise, others silently do
 * not, and nobody can tell which without reading every row. Rejecting the file
 * costs one round trip; a half-applied file costs a reconciliation.
 */

export const REQUIRED_COLUMNS = ['employeecode', 'newsalary', 'effectivefrom'] as const;
export const OPTIONAL_COLUMNS = ['changereason', 'note'] as const;

/** The header row of the template offered for download. */
export const IMPORT_TEMPLATE_HEADERS = [
  'employee_code',
  'new_salary',
  'effective_from',
  'change_reason',
  'note',
] as const;

export interface ImportRow {
  readonly line: number;
  readonly employeeCode: string;
  readonly status: 'OK' | 'ERROR';
  readonly message?: string;
  readonly employeeId?: number;
  readonly employeeName?: string;
  readonly currency?: CurrencyCode;
  readonly currentSalaryMinor?: number;
  readonly newSalaryMinor?: number;
  readonly percentChange?: number | null;
  /** Change in annualised USD cost, so rows in ten currencies can be totalled. */
  readonly deltaUsdMinor?: number;
  readonly effectiveFrom?: IsoDate;
  readonly changeReason?: ChangeReasonCode;
}

export interface ImportPreview {
  readonly rows: readonly ImportRow[];
  readonly totalRows: number;
  readonly validRows: number;
  readonly errorRows: number;
  /** Annual payroll change in USD if the file were applied. */
  readonly payrollDeltaUsdMinor: number;
  readonly canApply: boolean;
}

interface ParsedRow {
  readonly line: number;
  readonly employeeCode: string;
  readonly prepared?: PreparedRevision;
  readonly previousSalaryMinor?: number;
  readonly previousUsdMinor?: number;
  readonly error?: string;
}

/**
 * Validate a file without writing anything.
 *
 * Errors are collected per row rather than thrown on the first one — an HR
 * Manager fixing a spreadsheet wants every problem at once, not one per upload.
 */
export function previewImport(
  db: AppDatabase,
  csvText: string,
  clock: Clock = systemClock,
): ImportPreview {
  const parsed = parseFile(db, csvText, clock);

  const rows: ImportRow[] = parsed.map((row) => {
    if (row.error || !row.prepared) {
      return {
        line: row.line,
        employeeCode: row.employeeCode,
        status: 'ERROR',
        message: row.error ?? 'Could not be prepared',
      };
    }

    const { prepared } = row;
    const previous = row.previousSalaryMinor ?? 0;

    return {
      line: row.line,
      employeeCode: row.employeeCode,
      status: 'OK',
      employeeId: prepared.employee.id,
      employeeName: `${prepared.employee.firstName} ${prepared.employee.lastName}`,
      currency: prepared.employee.currency,
      currentSalaryMinor: previous,
      newSalaryMinor: prepared.baseSalaryMinor,
      percentChange: percentChange(previous, prepared.baseSalaryMinor),
      deltaUsdMinor: prepared.annualBaseUsdMinor - (row.previousUsdMinor ?? 0),
      effectiveFrom: prepared.effectiveFrom,
      changeReason: prepared.changeReason,
    };
  });

  const validRows = rows.filter((row) => row.status === 'OK');

  return {
    rows,
    totalRows: rows.length,
    validRows: validRows.length,
    errorRows: rows.length - validRows.length,
    payrollDeltaUsdMinor: validRows.reduce((total, row) => total + (row.deltaUsdMinor ?? 0), 0),
    // Only a clean file can be applied.
    canApply: rows.length > 0 && validRows.length === rows.length,
  };
}

export interface ImportResult extends ImportPreview {
  readonly applied: number;
  readonly payrollDeltaAppliedUsdMinor: number;
}

/**
 * Apply a file. Every row succeeds, or none does.
 *
 * All the writes share one transaction — which is why the revision logic is
 * split into prepare and commit halves, rather than each row opening its own.
 */
export function applyImport(
  db: AppDatabase,
  csvText: string,
  actorUserId: number,
  clock: Clock = systemClock,
): ImportResult {
  const preview = previewImport(db, csvText, clock);

  if (!preview.canApply) {
    throw new ValidationError(
      preview.totalRows === 0
        ? 'That file has no rows to import'
        : `${preview.errorRows} of ${preview.totalRows} rows have problems. Fix them and upload again — nothing has been changed.`,
      preview.rows.filter((row) => row.status === 'ERROR'),
    );
  }

  // Re-prepare inside the transaction. The preview may have been generated a
  // while ago, and a salary changed in between would make it stale.
  const parsed = parseFile(db, csvText, clock);
  const now = clock.now();

  const applied = db.transaction((tx) => {
    let count = 0;

    for (const row of parsed) {
      if (!row.prepared) {
        // Something changed between preview and apply; abort the whole file.
        throw new ValidationError(
          `Line ${row.line} (${row.employeeCode}) is no longer valid: ${row.error ?? 'unknown reason'}. Nothing has been changed.`,
        );
      }

      commitRevision(tx, row.prepared, actorUserId, now);
      count++;
    }

    insertAuditEntry(tx, {
      actorUserId,
      entity: 'COMPENSATION',
      entityId: 0,
      action: 'IMPORT',
      beforeJson: null,
      afterJson: JSON.stringify({ rows: count, payrollDeltaUsdMinor: preview.payrollDeltaUsdMinor }),
      summary: `Bulk import: ${count} salary ${count === 1 ? 'change' : 'changes'} applied, annual payroll ${preview.payrollDeltaUsdMinor >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(preview.payrollDeltaUsdMinor), 'USD', { compactDecimals: true })}`,
      at: now,
    });

    return count;
  });

  return {
    ...preview,
    applied,
    payrollDeltaAppliedUsdMinor: preview.payrollDeltaUsdMinor,
  };
}

// ---------------------------------------------------------------------------
// Parsing and per-row validation
// ---------------------------------------------------------------------------

function parseFile(db: AppDatabase, csvText: string, clock: Clock): ParsedRow[] {
  const document = toRecords(parseCsv(csvText));

  const missing = REQUIRED_COLUMNS.filter((column) => !document.headers.includes(column));
  if (missing.length > 0) {
    throw new ValidationError(
      `That file is missing the ${missing.join(', ')} column${missing.length > 1 ? 's' : ''}. Expected: ${IMPORT_TEMPLATE_HEADERS.join(', ')}.`,
    );
  }

  // Two changes for one person in one file is ambiguous — which wins? Flag
  // both rather than silently applying whichever comes last.
  const occurrences = new Map<string, number>();
  for (const record of document.records) {
    const code = (record.values.employeecode ?? '').toUpperCase();
    occurrences.set(code, (occurrences.get(code) ?? 0) + 1);
  }

  return document.records.map((record) => {
    const employeeCode = (record.values.employeecode ?? '').trim().toUpperCase();
    const fail = (message: string): ParsedRow => ({ line: record.line, employeeCode, error: message });

    if (!employeeCode) return fail('No employee code');
    if ((occurrences.get(employeeCode) ?? 0) > 1) {
      return fail('This employee appears more than once in the file');
    }

    const employee = findEmployeeByCode(db, employeeCode);
    if (!employee) return fail(`No employee with code ${employeeCode}`);

    const salaryText = (record.values.newsalary ?? '').trim();
    // Spreadsheets export "1,234.56" and sometimes a currency symbol.
    const salary = Number(salaryText.replace(/[,\s$£€¥₹]/g, ''));
    if (!salaryText) return fail('No new salary');
    if (!Number.isFinite(salary)) return fail(`"${salaryText}" is not a number`);

    const effectiveFrom = (record.values.effectivefrom ?? '').trim();
    if (!effectiveFrom) return fail('No effective date');
    if (!isIsoDate(effectiveFrom)) return fail(`"${effectiveFrom}" is not a date in YYYY-MM-DD form`);

    const reasonText = (record.values.changereason ?? '').trim().toUpperCase().replace(/[\s-]/g, '_');
    // A blank reason is the common case in a review-cycle spreadsheet.
    const changeReason = (reasonText || 'MERIT') as ChangeReasonCode;
    if (!SELECTABLE_CHANGE_REASONS.includes(changeReason as (typeof SELECTABLE_CHANGE_REASONS)[number])) {
      return fail(
        `"${record.values.changereason}" is not a reason. Use one of: ${SELECTABLE_CHANGE_REASONS.map((code) => CHANGE_REASON_LABELS[code]).join(', ')}`,
      );
    }

    try {
      const prepared = prepareRevision(
        db,
        {
          employeeId: employee.id,
          baseSalaryMajor: salary,
          effectiveFrom,
          changeReason,
          note: (record.values.note ?? '').trim() || null,
        },
        clock,
      );

      return {
        line: record.line,
        employeeCode,
        prepared,
        previousSalaryMinor: employee.currentSalaryMinor ?? 0,
        previousUsdMinor: employee.currentUsdMinor ?? 0,
      };
    } catch (error) {
      return fail(error instanceof AppError ? error.message : 'Could not be validated');
    }
  });
}
