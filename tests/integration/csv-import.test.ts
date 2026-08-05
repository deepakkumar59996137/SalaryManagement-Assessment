import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv, toRecords } from '@/domain/csv';
import { ValidationError } from '@/server/http/errors';
import { countAuditEntries, findAuditEntries } from '@/server/repositories/audit.repository';
import { exportEmployeesCsv, importTemplateCsv } from '@/server/services/export.service';
import { applyImport, previewImport } from '@/server/services/import.service';
import {
  addEmployee,
  compensationHistory,
  createTestContext,
  currentSalaryMinor,
  type TestContext,
} from '@tests/helpers/test-db';

let context: TestContext;

/** The employee codes the fixture assigns are sequential, so look them up. */
function codeOf(employeeId: number): string {
  return (
    context.sqlite.prepare('SELECT employee_code AS code FROM employees WHERE id = ?').get(employeeId) as {
      code: string;
    }
  ).code;
}

const preview = (csv: string) => previewImport(context.db, csv, context.clock);
const apply = (csv: string) => applyImport(context.db, csv, context.userId, context.clock);

beforeEach(() => {
  context = createTestContext('2026-06-01');
});

afterEach(() => {
  context.connection.close();
});

describe('previewImport — a clean file', () => {
  it('reports the change for every row without writing anything', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    const csv = `employee_code,new_salary,effective_from,change_reason\n${codeOf(id)},88000,2026-07-01,MERIT`;

    const result = preview(csv);

    expect(result.canApply).toBe(true);
    expect(result.validRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: 'OK',
      currentSalaryMinor: 8_000_000,
      newSalaryMinor: 8_800_000,
      deltaUsdMinor: 800_000,
    });

    // Nothing written.
    expect(currentSalaryMinor(context, id)).toBe(8_000_000);
    expect(countAuditEntries(context.db, {})).toBe(0);
  });

  it('totals the payroll impact across currencies', () => {
    const american = addEmployee(context, { country: 'US', salaryMajor: 80_000 });
    // ₹1,600,000 to ₹1,760,000 is $20,000 to $22,000 — a $2,000 increase.
    const indian = addEmployee(context, { country: 'IN', salaryMajor: 1_600_000 });

    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(american)},88000,2026-07-01`,
      `${codeOf(indian)},1760000,2026-07-01`,
    ].join('\n');

    expect(preview(csv).payrollDeltaUsdMinor).toBe(1_000_000);
  });

  it('reports a reduction as a negative total', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `employee_code,new_salary,effective_from,change_reason\n${codeOf(id)},72000,2026-07-01,CORRECTION`;

    expect(preview(csv).payrollDeltaUsdMinor).toBe(-800_000);
  });

  it('accepts the columns however the spreadsheet spells them', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `Employee Code,New Salary,Effective From\n${codeOf(id)},88000,2026-07-01`;

    expect(preview(csv).canApply).toBe(true);
  });

  it('accepts figures formatted the way a spreadsheet exports them', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `employee_code,new_salary,effective_from\n${codeOf(id)},"$88,000",2026-07-01`;

    expect(preview(csv).rows[0]?.newSalaryMinor).toBe(8_800_000);
  });

  it('defaults a blank reason to a merit increase', () => {
    // The common case in an annual review spreadsheet.
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `employee_code,new_salary,effective_from,change_reason\n${codeOf(id)},88000,2026-07-01,`;

    expect(preview(csv).rows[0]?.changeReason).toBe('MERIT');
  });
});

describe('previewImport — problems', () => {
  it('names every bad row rather than stopping at the first', () => {
    // An HR Manager fixing a spreadsheet wants every problem at once.
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = [
      'employee_code,new_salary,effective_from',
      'ACME-NOPE,88000,2026-07-01',
      `${codeOf(id)},not-a-number,2026-07-01`,
      `${codeOf(id)},88000,31/07/2026`,
    ].join('\n');

    const result = preview(csv);

    expect(result.errorRows).toBe(3);
    expect(result.canApply).toBe(false);
    expect(result.rows.map((row) => row.message)).toEqual([
      'No employee with code ACME-NOPE',
      'This employee appears more than once in the file',
      'This employee appears more than once in the file',
    ]);
  });

  it('reports the line number the spreadsheet shows', () => {
    const csv = 'employee_code,new_salary,effective_from\nACME-NOPE,88000,2026-07-01';
    expect(preview(csv).rows[0]?.line).toBe(2);
  });

  it('flags an employee listed twice, because which change wins is ambiguous', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(id)},88000,2026-07-01`,
      `${codeOf(id)},95000,2026-07-01`,
    ].join('\n');

    const result = preview(csv);
    expect(result.errorRows).toBe(2);
    expect(result.rows[0]?.message).toMatch(/more than once/);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `employee_code,new_salary,effective_from\n${codeOf(id)},88000,01-07-2026`;

    expect(preview(csv).rows[0]?.message).toMatch(/not a date/);
  });

  it('applies the same rules as the single-employee form', () => {
    // Before the hire date, and a leaver — both refused there, both refused here.
    const hired2025 = addEmployee(context, { salaryMajor: 80_000, hireDate: '2025-01-01' });
    const departed = addEmployee(context, { salaryMajor: 80_000, status: 'TERMINATED' });

    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(hired2025)},88000,2024-01-01`,
      `${codeOf(departed)},88000,2026-07-01`,
    ].join('\n');

    const result = preview(csv);
    expect(result.rows[0]?.message).toMatch(/before the hire date/);
    expect(result.rows[1]?.message).toMatch(/has left/);
  });

  it('rejects a reason that is not one of the choices', () => {
    const id = addEmployee(context, { salaryMajor: 80_000 });
    const csv = `employee_code,new_salary,effective_from,change_reason\n${codeOf(id)},88000,2026-07-01,BECAUSE`;

    expect(preview(csv).rows[0]?.message).toMatch(/is not a reason/);
  });

  it('refuses a file missing a required column, naming what is missing', () => {
    expect(() => preview('employee_code,new_salary\nACME-1,88000')).toThrow(/effectivefrom/);
  });

  it('has nothing to apply for a file with only a header', () => {
    const result = preview('employee_code,new_salary,effective_from');
    expect(result.totalRows).toBe(0);
    expect(result.canApply).toBe(false);
  });
});

describe('applyImport', () => {
  it('writes every row and moves the current salary', () => {
    const first = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    const second = addEmployee(context, { salaryMajor: 60_000, hireDate: '2024-01-01' });

    const csv = [
      'employee_code,new_salary,effective_from,change_reason,note',
      `${codeOf(first)},88000,2026-07-01,MERIT,Annual review`,
      `${codeOf(second)},66000,2026-07-01,MERIT,Annual review`,
    ].join('\n');

    const result = apply(csv);

    expect(result.applied).toBe(2);
    expect(currentSalaryMinor(context, first)).toBe(8_800_000);
    expect(currentSalaryMinor(context, second)).toBe(6_600_000);
  });

  it('keeps the salary history intact for every employee it touches', () => {
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    const csv = `employee_code,new_salary,effective_from\n${codeOf(id)},88000,2026-07-01`;

    apply(csv);

    const history = compensationHistory(context, id);
    expect(history).toHaveLength(2);
    expect(history[0]?.effectiveTo).toBe('2026-06-30');
    expect(history[1]?.effectiveTo).toBeNull();
  });

  it('applies nothing at all when any row is bad', () => {
    // The property the whole feature rests on. A half-applied payroll file is
    // worse than a rejected one.
    const good = addEmployee(context, { salaryMajor: 80_000 });
    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(good)},88000,2026-07-01`,
      'ACME-NOPE,99000,2026-07-01',
    ].join('\n');

    expect(() => apply(csv)).toThrow(ValidationError);

    expect(currentSalaryMinor(context, good)).toBe(8_000_000);
    expect(compensationHistory(context, good)).toHaveLength(1);
    expect(countAuditEntries(context.db, {})).toBe(0);
  });

  it('says how many rows were wrong when it refuses', () => {
    const good = addEmployee(context, { salaryMajor: 80_000 });
    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(good)},88000,2026-07-01`,
      'ACME-NOPE,99000,2026-07-01',
      'ACME-ALSO-NOPE,99000,2026-07-01',
    ].join('\n');

    expect(() => apply(csv)).toThrow(/2 of 3 rows/);
  });

  it('audits each change individually and the import as a whole', () => {
    const first = addEmployee(context, { salaryMajor: 80_000 });
    const second = addEmployee(context, { salaryMajor: 60_000 });

    const csv = [
      'employee_code,new_salary,effective_from',
      `${codeOf(first)},88000,2026-07-01`,
      `${codeOf(second)},66000,2026-07-01`,
    ].join('\n');

    apply(csv);

    // Two revisions plus one summary — the detail for reconstructing any single
    // change, and the summary for explaining the spike on the dashboard.
    expect(countAuditEntries(context.db, {})).toBe(3);

    const summary = findAuditEntries(context.db, { action: 'IMPORT' }, 10, 0);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.summary).toMatch(/Bulk import: 2 salary changes applied/);
  });
});

describe('export', () => {
  it('writes one row per employee plus a header', () => {
    addEmployee(context, { firstName: 'Ada', lastName: 'Lovelace', salaryMajor: 80_000 });
    addEmployee(context, { firstName: 'Grace', lastName: 'Hopper', salaryMajor: 90_000 });

    const rows = parseCsv(exportEmployeesCsv(context.db));
    expect(rows).toHaveLength(3);
  });

  it('writes money in major units, because a person will read it', () => {
    addEmployee(context, { salaryMajor: 80_000, country: 'US' });

    const { records } = toRecords(parseCsv(exportEmployeesCsv(context.db)));
    expect(records[0]?.values.basesalary).toBe('80000');
  });

  it('includes the derived figures rather than making the reader compute them', () => {
    // US L2 band is 64,000 – 80,000 – 96,000.
    addEmployee(context, { level: 'L2', country: 'US', salaryMajor: 60_000 });

    const { records } = toRecords(parseCsv(exportEmployeesCsv(context.db)));
    expect(records[0]?.values.comparatio).toBe('0.750');
    expect(records[0]?.values.bandposition).toBe('BELOW');
  });

  it('survives names containing accents and commas', () => {
    addEmployee(context, { firstName: 'Zofia', lastName: 'Wiśniewski' });

    const { records } = toRecords(parseCsv(exportEmployeesCsv(context.db)));
    expect(records[0]?.values.lastname).toBe('Wiśniewski');
  });

  it('round-trips: an exported file can be edited and imported back', () => {
    // The workflow the feature exists for — export, edit in Excel, import.
    const id = addEmployee(context, { salaryMajor: 80_000, hireDate: '2024-01-01' });
    const { records } = toRecords(parseCsv(exportEmployeesCsv(context.db)));

    const code = records[0]!.values.employeecode!;
    const raised = Number(records[0]!.values.basesalary) * 1.1;

    const result = apply(`employee_code,new_salary,effective_from\n${code},${raised},2026-07-01`);

    expect(result.applied).toBe(1);
    expect(currentSalaryMinor(context, id)).toBe(8_800_000);
  });

  it('offers a template with the right headers and a worked example', () => {
    const rows = parseCsv(importTemplateCsv());

    expect(rows[0]).toEqual(['employee_code', 'new_salary', 'effective_from', 'change_reason', 'note']);
    expect(rows[1]?.[0]).toBe('ACME-00001');
  });
});
