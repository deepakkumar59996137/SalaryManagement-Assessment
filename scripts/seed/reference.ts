/**
 * The shape of the fictional organisation.
 *
 * These constants exist only to generate data — the application reads the
 * database, never this file. They live under scripts/ so nothing in src/ can
 * accidentally depend on them.
 *
 * The numbers are chosen so the analytics screens have something true to say.
 * A dashboard over uniform noise looks impressive and means nothing; this
 * generator deliberately plants findable structure. See PLANTED_SIGNALS below.
 */

import type { CurrencyCode } from '../../src/domain/money';

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface CountrySpec {
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** Share of total headcount. */
  readonly headcountWeight: number;
  /** Cost of labour relative to the US. Drives the local salary band. */
  readonly salaryIndex: number;
  /** Salaries are quoted in round numbers; this is the local rounding step, in major units. */
  readonly salaryRounding: number;
}

export const COUNTRIES: readonly CountrySpec[] = [
  { code: 'US', name: 'United States', currency: 'USD', headcountWeight: 0.28, salaryIndex: 1.0, salaryRounding: 500 },
  { code: 'IN', name: 'India', currency: 'INR', headcountWeight: 0.22, salaryIndex: 0.28, salaryRounding: 25_000 },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', headcountWeight: 0.1, salaryIndex: 0.78, salaryRounding: 500 },
  { code: 'DE', name: 'Germany', currency: 'EUR', headcountWeight: 0.09, salaryIndex: 0.72, salaryRounding: 500 },
  { code: 'PL', name: 'Poland', currency: 'PLN', headcountWeight: 0.07, salaryIndex: 0.42, salaryRounding: 2_000 },
  { code: 'BR', name: 'Brazil', currency: 'BRL', headcountWeight: 0.06, salaryIndex: 0.33, salaryRounding: 2_000 },
  { code: 'CA', name: 'Canada', currency: 'CAD', headcountWeight: 0.06, salaryIndex: 0.75, salaryRounding: 500 },
  { code: 'SG', name: 'Singapore', currency: 'SGD', headcountWeight: 0.05, salaryIndex: 0.68, salaryRounding: 500 },
  { code: 'AU', name: 'Australia', currency: 'AUD', headcountWeight: 0.04, salaryIndex: 0.72, salaryRounding: 500 },
  { code: 'JP', name: 'Japan', currency: 'JPY', headcountWeight: 0.03, salaryIndex: 0.62, salaryRounding: 100_000 },
];

// ---------------------------------------------------------------------------
// Org structure
// ---------------------------------------------------------------------------

export interface DepartmentSpec {
  readonly name: string;
  readonly headcountWeight: number;
  /** Pay premium or discount against the band midpoint for the same level. */
  readonly payMultiplier: number;
  /** Share of employees recorded as female at mid-level, before the level gradient. */
  readonly baseFemaleShare: number;
  readonly titles: Readonly<Record<string, string>>;
}

/**
 * Titles are per (department, level) so the directory reads like a real org
 * chart rather than "Engineering L3" repeated ten thousand times.
 */
export const DEPARTMENTS: readonly DepartmentSpec[] = [
  {
    name: 'Engineering',
    headcountWeight: 0.34,
    payMultiplier: 1.12,
    baseFemaleShare: 0.28,
    titles: {
      L1: 'Associate Engineer', L2: 'Software Engineer', L3: 'Senior Software Engineer',
      L4: 'Staff Engineer', L5: 'Principal Engineer', L6: 'VP of Engineering',
    },
  },
  {
    name: 'Sales',
    headcountWeight: 0.14,
    payMultiplier: 1.05,
    baseFemaleShare: 0.38,
    titles: {
      L1: 'Sales Development Rep', L2: 'Account Executive', L3: 'Senior Account Executive',
      L4: 'Sales Manager', L5: 'Director of Sales', L6: 'VP of Sales',
    },
  },
  {
    name: 'Customer Support',
    headcountWeight: 0.13,
    payMultiplier: 0.9,
    baseFemaleShare: 0.55,
    titles: {
      L1: 'Support Associate', L2: 'Support Specialist', L3: 'Senior Support Specialist',
      L4: 'Support Team Lead', L5: 'Director of Support', L6: 'VP of Customer Experience',
    },
  },
  {
    name: 'Operations',
    headcountWeight: 0.1,
    payMultiplier: 0.95,
    baseFemaleShare: 0.45,
    titles: {
      L1: 'Operations Associate', L2: 'Operations Analyst', L3: 'Senior Operations Analyst',
      L4: 'Operations Manager', L5: 'Director of Operations', L6: 'VP of Operations',
    },
  },
  {
    name: 'Product',
    headcountWeight: 0.08,
    payMultiplier: 1.1,
    baseFemaleShare: 0.42,
    titles: {
      L1: 'Associate Product Manager', L2: 'Product Manager', L3: 'Senior Product Manager',
      L4: 'Group Product Manager', L5: 'Director of Product', L6: 'VP of Product',
    },
  },
  {
    name: 'Marketing',
    headcountWeight: 0.08,
    payMultiplier: 1.0,
    baseFemaleShare: 0.58,
    titles: {
      L1: 'Marketing Associate', L2: 'Marketing Specialist', L3: 'Senior Marketing Manager',
      L4: 'Marketing Lead', L5: 'Director of Marketing', L6: 'VP of Marketing',
    },
  },
  {
    name: 'Finance',
    headcountWeight: 0.07,
    payMultiplier: 1.02,
    baseFemaleShare: 0.48,
    titles: {
      L1: 'Finance Associate', L2: 'Financial Analyst', L3: 'Senior Financial Analyst',
      L4: 'Finance Manager', L5: 'Director of Finance', L6: 'VP of Finance',
    },
  },
  {
    name: 'People',
    headcountWeight: 0.06,
    payMultiplier: 0.96,
    baseFemaleShare: 0.68,
    titles: {
      L1: 'People Associate', L2: 'People Partner', L3: 'Senior People Partner',
      L4: 'People Manager', L5: 'Director of People', L6: 'Chief People Officer',
    },
  },
];

export interface JobLevelSpec {
  readonly code: string;
  readonly name: string;
  readonly rank: number;
  /** Share of headcount — a pyramid, with most people in the middle. */
  readonly headcountWeight: number;
  /** US annual band midpoint in major units; other countries scale by salaryIndex. */
  readonly usMidpointUsd: number;
  /**
   * Shift in the share of women at this level, added to the department base.
   *
   * This is the mechanism behind the planted representation effect: women are
   * over-represented at junior levels and under-represented at senior ones, so
   * the org-wide gender pay gap is large while the within-cohort gap is small.
   */
  readonly femaleShareAdjustment: number;
}

export const JOB_LEVELS: readonly JobLevelSpec[] = [
  { code: 'L1', name: 'Associate', rank: 1, headcountWeight: 0.22, usMidpointUsd: 55_000, femaleShareAdjustment: 0.08 },
  { code: 'L2', name: 'Professional', rank: 2, headcountWeight: 0.3, usMidpointUsd: 80_000, femaleShareAdjustment: 0.04 },
  { code: 'L3', name: 'Senior', rank: 3, headcountWeight: 0.24, usMidpointUsd: 115_000, femaleShareAdjustment: 0 },
  { code: 'L4', name: 'Staff / Manager', rank: 4, headcountWeight: 0.14, usMidpointUsd: 155_000, femaleShareAdjustment: -0.05 },
  { code: 'L5', name: 'Principal / Director', rank: 5, headcountWeight: 0.07, usMidpointUsd: 205_000, femaleShareAdjustment: -0.09 },
  { code: 'L6', name: 'Vice President', rank: 6, headcountWeight: 0.03, usMidpointUsd: 290_000, femaleShareAdjustment: -0.12 },
];

// ---------------------------------------------------------------------------
// Generation parameters
// ---------------------------------------------------------------------------

export const TOTAL_EMPLOYEES = 10_000;

/** Change this and every generated value changes; keep it fixed for reproducibility. */
export const SEED = 20_260_101;

/** "Today" for the generated dataset. Never `new Date()` — that would break determinism. */
export const AS_OF = '2026-01-01';

/** Band half-width around the midpoint: min = mid × 0.75, max = mid × 1.25. */
export const BAND_SPREAD = 0.25;

/**
 * Structure deliberately planted so the analytics screens have real findings.
 * The seed test asserts each of these is present, so a change to the generator
 * that flattens the data fails loudly.
 */
export const PLANTED_SIGNALS = {
  /** Share of employees placed below their band minimum — the "flight risk" list. */
  belowBandShare: 0.03,
  /** Share placed above their band maximum — the "no headroom to promote" list. */
  aboveBandShare: 0.02,
  /** Spread of salaries within a band. Log-normal, so the tail leans right. */
  salarySigma: 0.09,
  /**
   * Within-cohort pay penalty applied to women in these departments only.
   *
   * Small on purpose. Most of the headline gap comes from the level gradient
   * above, not from here — which is exactly the point the analytics screen has
   * to be able to demonstrate.
   */
  withinCohortFemalePenalty: 0.015,
  penalisedDepartments: ['Engineering', 'Sales'] as readonly string[],
  /** Employees who have left. Excluded from pay analytics, kept for history. */
  terminatedShare: 0.04,
  /** Contractors and part-timers, so employment type is not a single value. */
  partTimeShare: 0.03,
  contractShare: 0.04,
  otherGenderShare: 0.02,
  undisclosedGenderShare: 0.03,
  /** Longest tenure generated, in years. */
  maxTenureYears: 9,
} as const;

/** Raise sizes by reason, as a fraction. Used to build salary history backwards. */
export const RAISE_BANDS = {
  MERIT: { min: 0.025, max: 0.075 },
  PROMOTION: { min: 0.12, max: 0.2 },
  MARKET_ADJUSTMENT: { min: 0.06, max: 0.11 },
} as const;
