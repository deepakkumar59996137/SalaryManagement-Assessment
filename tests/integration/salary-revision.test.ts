import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeReasonCode } from '@/domain/compensation';
import { intervalsOverlap } from '@/domain/dates';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { countAuditEntries, findAuditEntries } from '@/server/repositories/audit.repository';
import { countDanglingCompensationPointers } from '@/server/repositories/employee.repository';
import {
  getCompensationHistory,
  previewAgainstBand,
  reviseSalary,
} from '@/server/services/compensation.service';
import {
  addEmployee,
  compensationHistory,
  createTestContext,
  currentSalaryMinor,
  type TestContext,
} from '@tests/helpers/test-db';

/**
 * The invariants from ADR-0002, tested directly.
 *
 * Every test here ends by re-checking the same three properties, because the
 * failure mode that matters is not "the raise did not save" — it is "the raise
 * saved and quietly left two overlapping salaries behind", which no user-facing
 * assertion would notice.
 */

let context: TestContext;

/** Assert the three invariants hold for an employee, whatever just happened. */
function assertHistoryIsSound(employeeId: number) {
  const rows = compensationHistory(context, employeeId);

  const open = rows.filter((row) => row.effectiveTo === null);
  expect(open, 'exactly one open interval').toHaveLength(1);
  expect(rows.at(-1)?.effectiveTo, 'the open interval is the last one').toBeNull();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      expect(
        intervalsOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo),
        `intervals ${a.effectiveFrom}..${a.effectiveTo} and ${b.effectiveFrom}..${b.effectiveTo} must not overlap`,
      ).toBe(false);
    }
  }

  // The pointer must resolve, and must point at the open row.
  expect(countDanglingCompensationPointers(context.db)).toBe(0);
  const pointer = context.sqlite
    .prepare('SELECT current_compensation_id AS id FROM employees WHERE id = ?')
    .get(employeeId) as { id: number | null };
  expect(pointer.id).toBe(open[0]!.id);
}

const revise = (
  employeeId: number,
  salaryMajor: number,
  effectiveFrom: string,
  reason: ChangeReasonCode = 'MERIT',
) =>
  reviseSalary(
    context.db,
    { employeeId, baseSalaryMajor: salaryMajor, effectiveFrom, changeReason: reason },
    context.userId,
    context.clock,
  );

beforeEach(() => {
  context = createTestContext('2026-06-01');
});

afterEach(() => {
  context.connection.close();
});

describe('reviseSalary — appending to the end', () => {
  it('closes the previous interval the day before the new one starts', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });

    revise(id, 88_000, '2026-03-01');

    const rows = compensationHistory(context, id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ effectiveFrom: '2024-01-01', effectiveTo: '2026-02-28' });
    expect(rows[1]).toMatchObject({ effectiveFrom: '2026-03-01', effectiveTo: null });
    assertHistoryIsSound(id);
  });

  it('makes the new interval the current salary', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    const result = revise(id, 88_000, '2026-03-01');

    expect(result.isCurrent).toBe(true);
    expect(currentSalaryMinor(context, id)).toBe(8_800_000);
  });

  it('reports the size of the change', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    const result = revise(id, 88_000, '2026-03-01');

    expect(result.previousSalaryMinor).toBe(8_000_000);
    expect(result.newSalaryMinor).toBe(8_800_000);
    expect(result.percentChange).toBeCloseTo(0.1, 10);
  });

  it('handles a pay cut as readily as a raise', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    const result = revise(id, 72_000, '2026-03-01', 'CORRECTION');

    expect(result.percentChange).toBeCloseTo(-0.1, 10);
    expect(result.summary).toContain('reduced');
    assertHistoryIsSound(id);
  });

  it('survives several revisions in a row', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2023-01-01' });

    revise(id, 84_000, '2024-01-01');
    revise(id, 90_000, '2025-01-01');
    revise(id, 96_000, '2026-01-01');

    const rows = compensationHistory(context, id);
    expect(rows.map((row) => row.salaryMinor)).toEqual([8_000_000, 8_400_000, 9_000_000, 9_600_000]);
    assertHistoryIsSound(id);
  });

  it('converts to USD using the stored FX snapshot', () => {
    // ₹80 to the dollar in the fixture, so ₹1,600,000 is $20,000.
    const id = addEmployee(context, { country: 'IN', salaryMajor: 1_400_000 });

    revise(id, 1_600_000, '2026-03-01');

    const stored = context.sqlite
      .prepare('SELECT annual_base_usd_minor AS usd FROM compensations WHERE employee_id = ? AND effective_to IS NULL')
      .get(id) as { usd: number };
    expect(stored.usd).toBe(2_000_000);
  });
});

describe('reviseSalary — same effective date', () => {
  it('corrects the existing row rather than creating a zero-length interval', () => {
    // A salary that was never true for a single day is not a fact worth storing.
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    revise(id, 88_000, '2026-03-01');

    const result = revise(id, 90_000, '2026-03-01', 'CORRECTION');

    const rows = compensationHistory(context, id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ salaryMinor: 9_000_000, effectiveTo: null });
    expect(result.isCurrent).toBe(true);
    assertHistoryIsSound(id);
  });

  it('corrects the starting salary in place', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });

    revise(id, 82_000, '2024-01-01', 'CORRECTION');

    const rows = compensationHistory(context, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ salaryMinor: 8_200_000, effectiveTo: null });
    assertHistoryIsSound(id);
  });
});

describe('reviseSalary — back-dating', () => {
  it('splices into the middle without disturbing later revisions', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2023-01-01' });
    revise(id, 100_000, '2025-01-01');

    // A correction to what they were paid during 2024.
    const result = revise(id, 90_000, '2024-06-01', 'CORRECTION');

    const rows = compensationHistory(context, id);
    expect(rows.map((row) => [row.effectiveFrom, row.effectiveTo, row.salaryMinor])).toEqual([
      ['2023-01-01', '2024-05-31', 8_000_000],
      ['2024-06-01', '2024-12-31', 9_000_000],
      ['2025-01-01', null, 10_000_000],
    ]);

    // It is history, not the current salary.
    expect(result.isCurrent).toBe(false);
    expect(currentSalaryMinor(context, id)).toBe(10_000_000);
    assertHistoryIsSound(id);
  });

  it('leaves the current-salary pointer alone when back-dating', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2023-01-01' });
    revise(id, 100_000, '2025-01-01');

    const before = context.sqlite
      .prepare('SELECT current_compensation_id AS id FROM employees WHERE id = ?')
      .get(id) as { id: number };

    revise(id, 90_000, '2024-06-01', 'CORRECTION');

    const after = context.sqlite
      .prepare('SELECT current_compensation_id AS id FROM employees WHERE id = ?')
      .get(id) as { id: number };
    expect(after.id).toBe(before.id);
  });

  it('refuses a date before the employee was hired', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });

    expect(() => revise(id, 90_000, '2023-12-31')).toThrow(ValidationError);
    expect(compensationHistory(context, id)).toHaveLength(1);
  });
});

describe('reviseSalary — future dating', () => {
  it('accepts a raise that takes effect later this year', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    const result = revise(id, 88_000, '2026-10-01');

    expect(result.isCurrent).toBe(true);
    assertHistoryIsSound(id);
  });

  it('refuses a date so far out it must be a typo', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    expect(() => revise(id, 88_000, '2226-01-01')).toThrow(ValidationError);
  });
});

describe('reviseSalary — refusals', () => {
  it('refuses an employee who does not exist', () => {
    expect(() => revise(999_999, 90_000, '2026-03-01')).toThrow(NotFoundError);
  });

  it('refuses someone who has left', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, status: 'TERMINATED' });
    expect(() => revise(id, 90_000, '2026-03-01')).toThrow(ConflictError);
  });

  it('refuses a zero or negative salary', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    expect(() => revise(id, 0, '2026-03-01')).toThrow(ValidationError);
    expect(() => revise(id, -1_000, '2026-03-01')).toThrow(ValidationError);
  });

  it('leaves the history untouched when a revision is refused', () => {
    // The whole point of doing this in one transaction.
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    revise(id, 88_000, '2025-01-01');

    const before = compensationHistory(context, id);
    expect(() => revise(id, -5, '2026-01-01')).toThrow();
    expect(compensationHistory(context, id)).toEqual(before);
    assertHistoryIsSound(id);
  });
});

describe('audit trail', () => {
  it('records who changed what, when', () => {
    const id = addEmployee(context, { firstName: 'Ada', lastName: 'Lovelace', salaryMajor: 80_000 });

    revise(id, 88_000, '2026-03-01', 'PROMOTION');

    const entries = findAuditEntries(context.db, {}, 10, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'SALARY_REVISION',
      entity: 'COMPENSATION',
      actorName: 'Test Manager',
      at: context.clock.now(),
    });
  });

  it('writes a summary that reads without joining to anything', () => {
    const id = addEmployee(context, { firstName: 'Ada', lastName: 'Lovelace', salaryMajor: 80_000 });

    revise(id, 88_000, '2026-03-01', 'PROMOTION');

    const [entry] = findAuditEntries(context.db, {}, 10, 0);
    expect(entry!.summary).toBe(
      'Ada Lovelace: salary increased from $80,000 to $88,000 (+10.0%), effective 1 March 2026 — Promotion',
    );
  });

  it('keeps both sides of the change for reconstruction', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    revise(id, 88_000, '2026-03-01');

    const [entry] = findAuditEntries(context.db, {}, 10, 0);
    expect(JSON.parse(entry!.beforeJson!)).toMatchObject({ baseSalaryMinor: 8_000_000 });
    expect(JSON.parse(entry!.afterJson!)).toMatchObject({ baseSalaryMinor: 8_800_000, currency: 'USD' });
  });

  it('writes one entry per revision', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2023-01-01' });

    revise(id, 84_000, '2024-01-01');
    revise(id, 90_000, '2025-01-01');

    expect(countAuditEntries(context.db, {})).toBe(2);
  });

  it('writes nothing when the revision is refused', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });

    expect(() => revise(id, 0, '2026-03-01')).toThrow();

    expect(countAuditEntries(context.db, {})).toBe(0);
  });
});

describe('getCompensationHistory', () => {
  it('returns intervals oldest first with each step already worked out', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2023-01-01' });
    revise(id, 88_000, '2024-01-01');
    revise(id, 92_400, '2025-01-01');

    const history = getCompensationHistory(context.db, id);

    expect(history.map((entry) => entry.percentChange)).toEqual([
      null,
      expect.closeTo(0.1, 10),
      expect.closeTo(0.05, 10),
    ]);
    expect(history.map((entry) => entry.changeMinor)).toEqual([null, 800_000, 440_000]);
    expect(history.at(-1)?.isCurrent).toBe(true);
  });

  it('is empty for an employee with no salary on record', () => {
    expect(getCompensationHistory(context.db, 999_999)).toEqual([]);
  });
});

describe('previewAgainstBand', () => {
  it('shows where a proposed salary would land before it is saved', () => {
    // US L2 band is 64,000 – 80,000 – 96,000.
    const id = addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 80_000 });

    const preview = previewAgainstBand(context.db, id, 10_400_000);

    expect(preview?.summary.compaRatio).toBeCloseTo(1.3, 10);
    expect(preview?.summary.position).toBe('ABOVE');
  });

  it('flags a proposal that would leave someone below their band', () => {
    const id = addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 80_000 });

    const preview = previewAgainstBand(context.db, id, 6_000_000);

    expect(preview?.summary.position).toBe('BELOW');
    expect(preview?.summary.costToMinimumMinor).toBe(400_000);
  });
});
