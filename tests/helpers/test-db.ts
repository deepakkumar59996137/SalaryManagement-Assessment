import { type Clock, fixedClock, type IsoDate } from '@/domain/dates';
import { type CurrencyCode, minorUnitsPerMajor, toMinor } from '@/domain/money';
import { type FxRateTable, toUsdMinor } from '@/domain/fx';
import { hashPassword, TEST_SCRYPT_PARAMETERS } from '@/server/auth/password';
import { type Connection, openInMemory } from '@/server/db/client';

/**
 * A real SQLite database, in memory, with migrations applied.
 *
 * Integration tests use this rather than a mock. `better-sqlite3` is
 * synchronous and in-process, so a fresh migrated database costs about a
 * millisecond — which makes testing against the real engine cheaper than
 * maintaining a fake of it, and means the SQL itself is under test.
 *
 * The fixture is deliberately tiny and built from round numbers, so a test can
 * assert an exact median or payroll total that a reader can verify by hand.
 */

/** A rate of 0.0125 means ₹80 to the dollar — chosen so conversions stay mental arithmetic. */
export const TEST_FX_RATES: FxRateTable = { USD: 1, INR: 0.0125 };

export const TEST_TODAY: IsoDate = '2026-06-01';

export const TEST_COUNTRIES = [
  { code: 'US', name: 'United States', currency: 'USD' as CurrencyCode },
  { code: 'IN', name: 'India', currency: 'INR' as CurrencyCode },
] as const;

export const TEST_DEPARTMENTS = ['Engineering', 'Sales', 'People'] as const;

export const TEST_LEVELS = [
  { code: 'L1', name: 'Associate', rank: 1, usMidMajor: 50_000 },
  { code: 'L2', name: 'Professional', rank: 2, usMidMajor: 80_000 },
  { code: 'L3', name: 'Senior', rank: 3, usMidMajor: 120_000 },
] as const;

/** India pays 0.28 of the US rate for the same level. */
const INDIA_SALARY_INDEX = 0.28;

export type TestDepartment = (typeof TEST_DEPARTMENTS)[number];
export type TestLevel = (typeof TEST_LEVELS)[number]['code'];
export type TestCountry = (typeof TEST_COUNTRIES)[number]['code'];

export interface TestContext {
  readonly connection: Connection;
  readonly db: Connection['db'];
  readonly sqlite: Connection['sqlite'];
  readonly clock: Clock;
  readonly userId: number;
  readonly departmentIds: Readonly<Record<TestDepartment, number>>;
  readonly levelIds: Readonly<Record<TestLevel, number>>;
  readonly currencyOf: (country: TestCountry) => CurrencyCode;
}

export const TEST_USER_EMAIL = 'hr@test.example';
export const TEST_USER_PASSWORD = 'correct horse battery staple';

/** Bands are min = 0.8 × mid, max = 1.2 × mid, in local major units. */
export function bandMidMajor(level: TestLevel, country: TestCountry): number {
  const spec = TEST_LEVELS.find((candidate) => candidate.code === level)!;
  if (country === 'US') return spec.usMidMajor;
  // ₹80 to the dollar, at 0.28 of the US rate.
  return spec.usMidMajor * INDIA_SALARY_INDEX * 80;
}

export function createTestContext(today: IsoDate = TEST_TODAY): TestContext {
  const connection = openInMemory();
  const { sqlite } = connection;

  for (const country of TEST_COUNTRIES) {
    sqlite
      .prepare('INSERT INTO countries (code, name, currency) VALUES (?, ?, ?)')
      .run(country.code, country.name, country.currency);
  }

  for (const [currency, rate] of Object.entries(TEST_FX_RATES)) {
    sqlite
      .prepare('INSERT INTO fx_rates (currency, rate_to_usd, as_of) VALUES (?, ?, ?)')
      .run(currency, rate, '2026-01-01');
  }

  const departmentIds = {} as Record<TestDepartment, number>;
  for (const name of TEST_DEPARTMENTS) {
    const result = sqlite.prepare('INSERT INTO departments (name) VALUES (?)').run(name);
    departmentIds[name] = Number(result.lastInsertRowid);
  }

  const levelIds = {} as Record<TestLevel, number>;
  for (const level of TEST_LEVELS) {
    const result = sqlite
      .prepare('INSERT INTO job_levels (code, name, rank) VALUES (?, ?, ?)')
      .run(level.code, level.name, level.rank);
    levelIds[level.code] = Number(result.lastInsertRowid);
  }

  const insertBand = sqlite.prepare(`
    INSERT INTO salary_bands (job_level_id, country_code, currency, min_minor, mid_minor, max_minor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const level of TEST_LEVELS) {
    for (const country of TEST_COUNTRIES) {
      const mid = bandMidMajor(level.code, country.code);
      insertBand.run(
        levelIds[level.code],
        country.code,
        country.currency,
        toMinor(mid * 0.8, country.currency),
        toMinor(mid, country.currency),
        toMinor(mid * 1.2, country.currency),
      );
    }
  }

  const userId = Number(
    sqlite
      .prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        TEST_USER_EMAIL,
        'Test Manager',
        hashPassword(TEST_USER_PASSWORD, { salt: 'fixedsaltfortests', parameters: TEST_SCRYPT_PARAMETERS }),
        'HR_MANAGER',
        `${today}T00:00:00.000Z`,
      ).lastInsertRowid,
  );

  const currencyOf = (country: TestCountry) =>
    TEST_COUNTRIES.find((candidate) => candidate.code === country)!.currency;

  return {
    connection,
    db: connection.db,
    sqlite,
    clock: fixedClock(today, '09:00:00.000'),
    userId,
    departmentIds,
    levelIds,
    currencyOf,
  };
}

export interface EmployeeSpec {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly department?: TestDepartment;
  readonly level?: TestLevel;
  readonly country?: TestCountry;
  readonly gender?: 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';
  readonly status?: 'ACTIVE' | 'TERMINATED';
  readonly employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  readonly hireDate?: IsoDate;
  /** Annual base in local major units. Defaults to the band midpoint. */
  readonly salaryMajor?: number;
  readonly managerId?: number;
}

let sequence = 0;

/**
 * Insert an employee with a single open compensation interval.
 *
 * Mirrors what the seed and the application do: employee first, then the
 * compensation row, then the pointer — so no foreign key is ever unsatisfied.
 */
export function addEmployee(context: TestContext, spec: EmployeeSpec = {}): number {
  const {
    firstName = 'Test',
    lastName = `Person${++sequence}`,
    department = 'Engineering',
    level = 'L2',
    country = 'US',
    gender = 'UNDISCLOSED',
    status = 'ACTIVE',
    employmentType = 'FULL_TIME',
    hireDate = '2024-01-01',
    managerId,
  } = spec;

  const currency = context.currencyOf(country);
  const salaryMajor = spec.salaryMajor ?? bandMidMajor(level, country);
  const salaryMinor = toMinor(salaryMajor, currency);
  const code = `T-${String(sequence).padStart(5, '0')}`;

  const employeeId = Number(
    context.sqlite
      .prepare(`
        INSERT INTO employees (
          employee_code, first_name, last_name, email, department_id, job_level_id, job_title,
          country_code, currency, manager_id, hire_date, employment_type, gender, status,
          current_compensation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `)
      .run(
        code,
        firstName,
        lastName,
        `${code.toLowerCase()}@test.example`,
        context.departmentIds[department],
        context.levelIds[level],
        `${department} ${level}`,
        country,
        currency,
        managerId ?? null,
        hireDate,
        employmentType,
        gender,
        status,
        `${hireDate}T00:00:00.000Z`,
        `${hireDate}T00:00:00.000Z`,
      ).lastInsertRowid,
  );

  const compensationId = Number(
    context.sqlite
      .prepare(`
        INSERT INTO compensations (
          employee_id, base_salary_minor, currency, effective_from, effective_to,
          annual_base_usd_minor, change_reason, note, changed_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 'INITIAL', NULL, ?, ?)
      `)
      .run(
        employeeId,
        salaryMinor,
        currency,
        hireDate,
        toUsdMinor(salaryMinor, currency, TEST_FX_RATES),
        context.userId,
        `${hireDate}T00:00:00.000Z`,
      ).lastInsertRowid,
  );

  context.sqlite
    .prepare('UPDATE employees SET current_compensation_id = ? WHERE id = ?')
    .run(compensationId, employeeId);

  return employeeId;
}

/** Read an employee's current salary in local minor units. */
export function currentSalaryMinor(context: TestContext, employeeId: number): number | null {
  const row = context.sqlite
    .prepare(`
      SELECT c.base_salary_minor AS salary
      FROM employees e JOIN compensations c ON c.id = e.current_compensation_id
      WHERE e.id = ?
    `)
    .get(employeeId) as { salary: number } | undefined;

  return row?.salary ?? null;
}

/** Every compensation interval for an employee, oldest first. */
export function compensationHistory(context: TestContext, employeeId: number) {
  return context.sqlite
    .prepare(`
      SELECT id, base_salary_minor AS salaryMinor, effective_from AS effectiveFrom,
             effective_to AS effectiveTo, change_reason AS changeReason
      FROM compensations WHERE employee_id = ? ORDER BY effective_from
    `)
    .all(employeeId) as {
    id: number;
    salaryMinor: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    changeReason: string;
  }[];
}

export { minorUnitsPerMajor };
