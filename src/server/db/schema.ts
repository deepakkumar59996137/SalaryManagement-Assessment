import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Database schema.
 *
 * Conventions:
 *   *_minor  — an integer in the currency's minor unit. Never a float. (ADR-0001)
 *   dates    — ISO `YYYY-MM-DD` TEXT. Sorts and compares correctly in SQL, and
 *              carries no timezone to be misinterpreted.
 *   times    — ISO 8601 UTC TEXT, for audit timestamps where the instant matters.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** scrypt, stored as `salt:derivedKey` in hex. See server/services/auth.service.ts */
  passwordHash: text('password_hash').notNull(),
  /**
   * One role today. The column exists so adding HR_ANALYST or ADMIN later is a
   * migration of data rather than of schema — see requirements.md on why a full
   * role matrix is out of scope for a single-persona product.
   */
  role: text('role', { enum: ['HR_MANAGER'] }).notNull().default('HR_MANAGER'),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** Opaque random token, also the cookie value. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const departments = sqliteTable('departments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const jobLevels = sqliteTable('job_levels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** L1..L6 */
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  /** Seniority order. Sorting by code would put L10 between L1 and L2. */
  rank: integer('rank').notNull(),
});

export const countries = sqliteTable('countries', {
  /** ISO 3166-1 alpha-2 */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** The currency employees in this country are paid in. */
  currency: text('currency').notNull(),
});

export const fxRates = sqliteTable('fx_rates', {
  currency: text('currency').primaryKey(),
  /** USD per one major unit of this currency. */
  rateToUsd: real('rate_to_usd').notNull(),
  asOf: text('as_of').notNull(),
});

export const salaryBands = sqliteTable(
  'salary_bands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobLevelId: integer('job_level_id')
      .notNull()
      .references(() => jobLevels.id),
    countryCode: text('country_code')
      .notNull()
      .references(() => countries.code),
    currency: text('currency').notNull(),
    minMinor: integer('min_minor').notNull(),
    midMinor: integer('mid_minor').notNull(),
    maxMinor: integer('max_minor').notNull(),
  },
  (table) => [
    // Pay ranges are set per level per market — exactly one band for each pair.
    uniqueIndex('salary_bands_level_country_idx').on(table.jobLevelId, table.countryCode),
  ],
);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const employees = sqliteTable(
  'employees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    employeeCode: text('employee_code').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull().unique(),

    departmentId: integer('department_id')
      .notNull()
      .references(() => departments.id),
    jobLevelId: integer('job_level_id')
      .notNull()
      .references(() => jobLevels.id),
    jobTitle: text('job_title').notNull(),

    countryCode: text('country_code')
      .notNull()
      .references(() => countries.code),
    /** Denormalised from the country for query convenience; they always agree. */
    currency: text('currency').notNull(),

    managerId: integer('manager_id').references((): AnySQLiteColumn => employees.id),

    hireDate: text('hire_date').notNull(),
    employmentType: text('employment_type', {
      enum: ['FULL_TIME', 'PART_TIME', 'CONTRACT'],
    }).notNull(),
    /** Held for pay-equity analysis. OTHER and UNDISCLOSED are excluded from binary gap maths. */
    gender: text('gender', { enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] }).notNull(),
    status: text('status', { enum: ['ACTIVE', 'TERMINATED'] }).notNull().default('ACTIVE'),

    /**
     * Pointer to the open compensation row (ADR-0003), maintained inside the
     * same transaction as any compensation write.
     *
     * Deliberately not a declared foreign key: employees -> compensations ->
     * employees is a cycle, which makes dump/restore ordering and migrations
     * fragile for no benefit. The invariant is already guaranteed by
     * compensation.service.ts being the only writer, and by the partial unique
     * index on compensations below.
     */
    currentCompensationId: integer('current_compensation_id'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // The directory filters on these and sorts by name; the analytics group by them.
    index('employees_department_idx').on(table.departmentId),
    index('employees_country_idx').on(table.countryCode),
    index('employees_level_idx').on(table.jobLevelId),
    index('employees_status_idx').on(table.status),
    index('employees_last_name_idx').on(table.lastName),
    index('employees_manager_idx').on(table.managerId),
    index('employees_current_comp_idx').on(table.currentCompensationId),
  ],
);

export const compensations = sqliteTable(
  'compensations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => employees.id),

    /** Annual base salary in the employee's local currency. */
    baseSalaryMinor: integer('base_salary_minor').notNull(),
    currency: text('currency').notNull(),

    effectiveFrom: text('effective_from').notNull(),
    /** NULL means current. Closing a row sets this to the next row's start, minus a day. */
    effectiveTo: text('effective_to'),

    /**
     * Annual base converted to USD at the FX snapshot current when this row was
     * written (ADR-0003). Lets every analytics aggregate be a plain SUM over one
     * column, and keeps historical reports reproducible at the rate of their time.
     */
    annualBaseUsdMinor: integer('annual_base_usd_minor').notNull(),

    changeReason: text('change_reason', {
      enum: ['INITIAL', 'MERIT', 'PROMOTION', 'MARKET_ADJUSTMENT', 'CORRECTION', 'IMPORT'],
    }).notNull(),
    note: text('note'),

    changedByUserId: integer('changed_by_user_id').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    // Timeline lookups, and the "salary as at date X" query.
    index('compensations_employee_from_idx').on(table.employeeId, table.effectiveFrom),
    index('compensations_effective_from_idx').on(table.effectiveFrom),

    /**
     * The ADR-0002 invariant, enforced by the database rather than only by the
     * service: an employee can have at most one open compensation interval.
     * A partial unique index is the cheapest possible way to make the bug
     * impossible instead of merely tested for.
     */
    uniqueIndex('compensations_one_open_per_employee_idx')
      .on(table.employeeId)
      .where(sql`effective_to is null`),
  ],
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: integer('actor_user_id').references(() => users.id),
    entity: text('entity', { enum: ['EMPLOYEE', 'COMPENSATION'] }).notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action', { enum: ['CREATE', 'UPDATE', 'SALARY_REVISION', 'IMPORT'] }).notNull(),
    /** JSON snapshots of the changed fields only, not the whole row. */
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    /** Pre-rendered one-line description, so the audit screen needs no joins. */
    summary: text('summary').notNull(),
    at: text('at').notNull(),
  },
  (table) => [
    index('audit_log_at_idx').on(table.at),
    index('audit_log_entity_idx').on(table.entity, table.entityId),
    index('audit_log_actor_idx').on(table.actorUserId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred types — used throughout the server layer.
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type JobLevel = typeof jobLevels.$inferSelect;
export type Country = typeof countries.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type SalaryBandRow = typeof salaryBands.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Compensation = typeof compensations.$inferSelect;
export type NewCompensation = typeof compensations.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;

export type ChangeReason = Compensation['changeReason'];
export type Gender = Employee['gender'];
export type EmployeeStatus = Employee['status'];
