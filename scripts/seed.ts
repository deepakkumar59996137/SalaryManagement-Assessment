/**
 * Seed the database with the deterministic 10,000-employee dataset.
 *
 *   npm run seed
 *
 * Wipes and rewrites all business data. Re-running produces a byte-identical
 * database, which is what makes the deployed demo stable and benchmark numbers
 * comparable between runs.
 */

import fs from 'node:fs';
import { hashPassword } from '../src/server/auth/password';
import { getConnection, runMigrations } from '../src/server/db/client';
import { databaseDirectory, databaseFile } from '../src/server/db/paths';
import { DEFAULT_FX_RATES, FX_SNAPSHOT_AS_OF } from '../src/domain/fx';
import { generateDataset } from './seed/generate';
import { AS_OF, COUNTRIES, DEPARTMENTS, JOB_LEVELS } from './seed/reference';

/** Demo credentials. Printed on completion and documented in the README. */
export const DEMO_EMAIL = process.env.SEED_HR_EMAIL ?? 'hr.manager@acme.example';
export const DEMO_PASSWORD = process.env.SEED_HR_PASSWORD ?? 'DemoPass!2026';

/**
 * A fixed salt for the seeded account only, so the whole database hashes
 * identically on every run. Accounts created through the application get a
 * random salt from `hashPassword`'s default.
 */
const DEMO_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const SEED_TIMESTAMP = `${AS_OF}T00:00:00.000Z`;

function seed(): void {
  const startedAt = performance.now();

  fs.mkdirSync(databaseDirectory(), { recursive: true });
  const { sqlite } = getConnection();
  runMigrations(getConnection());

  const dataset = generateDataset();

  // Children before parents, so foreign keys stay satisfied throughout.
  const wipeOrder = [
    'audit_log', 'sessions', 'compensations', 'employees',
    'salary_bands', 'fx_rates', 'countries', 'departments', 'job_levels', 'users',
  ];

  const insertAll = sqlite.transaction(() => {
    // The pointer from employees to compensations is not a declared foreign key
    // (see schema.ts), so it cannot block the wipe — but employees does
    // reference compensations logically, so clear in dependency order anyway.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    for (const table of wipeOrder) sqlite.prepare(`DELETE FROM ${table}`).run();
    sqlite.prepare("DELETE FROM sqlite_sequence WHERE name IN (" +
      wipeOrder.map(() => '?').join(',') + ')').run(...wipeOrder);
    sqlite.exec('PRAGMA foreign_keys = ON');

    // ---- reference data -------------------------------------------------
    const insertCountry = sqlite.prepare(
      'INSERT INTO countries (code, name, currency) VALUES (?, ?, ?)',
    );
    for (const country of COUNTRIES) {
      insertCountry.run(country.code, country.name, country.currency);
    }

    const insertFxRate = sqlite.prepare(
      'INSERT INTO fx_rates (currency, rate_to_usd, as_of) VALUES (?, ?, ?)',
    );
    for (const [currency, rate] of Object.entries(DEFAULT_FX_RATES)) {
      insertFxRate.run(currency, rate, FX_SNAPSHOT_AS_OF);
    }

    const insertDepartment = sqlite.prepare('INSERT INTO departments (name) VALUES (?)');
    const departmentIds = new Map<string, number>();
    for (const department of DEPARTMENTS) {
      const result = insertDepartment.run(department.name);
      departmentIds.set(department.name, Number(result.lastInsertRowid));
    }

    const insertLevel = sqlite.prepare(
      'INSERT INTO job_levels (code, name, rank) VALUES (?, ?, ?)',
    );
    const levelIds = new Map<string, number>();
    for (const level of JOB_LEVELS) {
      const result = insertLevel.run(level.code, level.name, level.rank);
      levelIds.set(level.code, Number(result.lastInsertRowid));
    }

    const insertBand = sqlite.prepare(`
      INSERT INTO salary_bands (job_level_id, country_code, currency, min_minor, mid_minor, max_minor)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const band of dataset.bands) {
      insertBand.run(
        levelIds.get(band.levelCode),
        band.countryCode,
        band.currency,
        band.minMinor,
        band.midMinor,
        band.maxMinor,
      );
    }

    // ---- the HR Manager -------------------------------------------------
    const insertUser = sqlite.prepare(`
      INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)
    `);
    const userId = Number(
      insertUser.run(
        DEMO_EMAIL,
        'Alex Morgan',
        hashPassword(DEMO_PASSWORD, DEMO_SALT),
        'HR_MANAGER',
        SEED_TIMESTAMP,
      ).lastInsertRowid,
    );

    // ---- employees ------------------------------------------------------
    // Manager and current-compensation pointers are filled in afterwards,
    // since both reference rows that do not exist yet at this point.
    const insertEmployee = sqlite.prepare(`
      INSERT INTO employees (
        employee_code, first_name, last_name, email, department_id, job_level_id, job_title,
        country_code, currency, manager_id, hire_date, employment_type, gender, status,
        current_compensation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
    `);

    const employeeIds: number[] = [];
    for (const employee of dataset.employees) {
      const result = insertEmployee.run(
        employee.employeeCode,
        employee.firstName,
        employee.lastName,
        employee.email,
        departmentIds.get(employee.departmentName),
        levelIds.get(employee.levelCode),
        employee.jobTitle,
        employee.countryCode,
        employee.currency,
        employee.hireDate,
        employee.employmentType,
        employee.gender,
        employee.status,
        SEED_TIMESTAMP,
        SEED_TIMESTAMP,
      );
      employeeIds.push(Number(result.lastInsertRowid));
    }

    // ---- compensation history ------------------------------------------
    const insertCompensation = sqlite.prepare(`
      INSERT INTO compensations (
        employee_id, base_salary_minor, currency, effective_from, effective_to,
        annual_base_usd_minor, change_reason, note, changed_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    const setPointers = sqlite.prepare(
      'UPDATE employees SET current_compensation_id = ?, manager_id = ? WHERE id = ?',
    );

    let compensationRows = 0;
    dataset.employees.forEach((employee, index) => {
      const employeeId = employeeIds[index]!;
      let openCompensationId: number | null = null;

      for (const compensation of employee.compensations) {
        const result = insertCompensation.run(
          employeeId,
          compensation.baseSalaryMinor,
          compensation.currency,
          compensation.effectiveFrom,
          compensation.effectiveTo,
          compensation.annualBaseUsdMinor,
          compensation.changeReason,
          userId,
          SEED_TIMESTAMP,
        );
        compensationRows++;
        if (compensation.effectiveTo === null) openCompensationId = Number(result.lastInsertRowid);
      }

      const managerId =
        employee.managerIndex === null ? null : (employeeIds[employee.managerIndex] ?? null);
      setPointers.run(openCompensationId, managerId, employeeId);
    });

    return compensationRows;
  });

  const compensationRows = insertAll();

  // Rebuild query-planner statistics; without this SQLite may prefer a scan
  // over the directory's indexes on a freshly written database.
  sqlite.exec('ANALYZE');

  const elapsedMs = performance.now() - startedAt;
  report(elapsedMs, dataset.employees.length, compensationRows);
}

function report(elapsedMs: number, employees: number, compensations: number): void {
  const { sqlite } = getConnection();
  const count = (query: string): number =>
    (sqlite.prepare(query).get() as { n: number }).n;

  const activeHeadcount = count("SELECT COUNT(*) AS n FROM employees WHERE status = 'ACTIVE'");
  const outsideBand = count(`
    SELECT COUNT(*) AS n
    FROM employees e
    JOIN compensations c ON c.id = e.current_compensation_id
    JOIN salary_bands b ON b.job_level_id = e.job_level_id AND b.country_code = e.country_code
    WHERE e.status = 'ACTIVE' AND (c.base_salary_minor < b.min_minor OR c.base_salary_minor > b.max_minor)
  `);
  const payrollUsd = (
    sqlite
      .prepare(`
        SELECT COALESCE(SUM(c.annual_base_usd_minor), 0) AS n
        FROM employees e
        JOIN compensations c ON c.id = e.current_compensation_id
        WHERE e.status = 'ACTIVE'
      `)
      .get() as { n: number }
  ).n;

  console.log(`
Seeded ${databaseFile()} in ${(elapsedMs / 1000).toFixed(2)}s

  employees            ${employees.toLocaleString('en-US')}  (${activeHeadcount.toLocaleString('en-US')} active)
  compensation rows    ${compensations.toLocaleString('en-US')}
  annual payroll       $${Math.round(payrollUsd / 100).toLocaleString('en-US')}
  paid outside band    ${outsideBand.toLocaleString('en-US')}

  sign in with         ${DEMO_EMAIL} / ${DEMO_PASSWORD}
`);
}

seed();
getConnection().close();
