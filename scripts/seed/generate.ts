/**
 * Generates the dataset in memory.
 *
 * Kept separate from the database writing in scripts/seed.ts so that tests can
 * assert on the generated data — including that it is reproducible and that the
 * planted signals are present — without touching SQLite at all.
 */

import { addDays, addYears, daysBetween, type IsoDate } from '../../src/domain/dates';
import { DEFAULT_FX_RATES } from '../../src/domain/fx';
import { toUsdMinor } from '../../src/domain/fx';
import { type CurrencyCode, minorUnitsPerMajor, roundHalfUp } from '../../src/domain/money';
import { namePoolFor, toEmailToken } from './names';
import { SeededRandom, type Weighted } from './random';
import {
  AS_OF,
  BAND_SPREAD,
  COUNTRIES,
  type CountrySpec,
  DEPARTMENTS,
  type DepartmentSpec,
  JOB_LEVELS,
  type JobLevelSpec,
  PLANTED_SIGNALS,
  RAISE_BANDS,
  SEED,
  TOTAL_EMPLOYEES,
} from './reference';

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface GeneratedBand {
  readonly levelCode: string;
  readonly countryCode: string;
  readonly currency: CurrencyCode;
  readonly minMinor: number;
  readonly midMinor: number;
  readonly maxMinor: number;
}

export interface GeneratedCompensation {
  readonly baseSalaryMinor: number;
  readonly currency: CurrencyCode;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly annualBaseUsdMinor: number;
  readonly changeReason: 'INITIAL' | 'MERIT' | 'PROMOTION' | 'MARKET_ADJUSTMENT';
}

export interface GeneratedEmployee {
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly departmentName: string;
  readonly levelCode: string;
  readonly jobTitle: string;
  readonly countryCode: string;
  readonly currency: CurrencyCode;
  readonly hireDate: IsoDate;
  readonly employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  readonly gender: 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';
  readonly status: 'ACTIVE' | 'TERMINATED';
  /** Index into the employees array, resolved to a real id when written. */
  readonly managerIndex: number | null;
  readonly compensations: readonly GeneratedCompensation[];
}

export interface GeneratedDataset {
  readonly bands: readonly GeneratedBand[];
  readonly employees: readonly GeneratedEmployee[];
}

// ---------------------------------------------------------------------------
// Salary bands
// ---------------------------------------------------------------------------

/** Round to the local convention — salaries are quoted in round numbers. */
function roundToLocalStep(majorAmount: number, country: CountrySpec): number {
  return Math.round(majorAmount / country.salaryRounding) * country.salaryRounding;
}

function bandFor(level: JobLevelSpec, country: CountrySpec, rates = DEFAULT_FX_RATES): GeneratedBand {
  const usdRate = rates[country.currency];
  if (usdRate === undefined) throw new Error(`No FX rate for ${country.currency}`);

  // The band is defined in USD terms, then expressed in the local currency at
  // the local cost of labour.
  const midLocalMajor = roundToLocalStep(
    (level.usMidpointUsd * country.salaryIndex) / usdRate,
    country,
  );
  const perMajor = minorUnitsPerMajor(country.currency);

  return {
    levelCode: level.code,
    countryCode: country.code,
    currency: country.currency,
    minMinor: roundHalfUp(roundToLocalStep(midLocalMajor * (1 - BAND_SPREAD), country) * perMajor),
    midMinor: roundHalfUp(midLocalMajor * perMajor),
    maxMinor: roundHalfUp(roundToLocalStep(midLocalMajor * (1 + BAND_SPREAD), country) * perMajor),
  };
}

function buildBands(): GeneratedBand[] {
  return JOB_LEVELS.flatMap((level) => COUNTRIES.map((country) => bandFor(level, country)));
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

const weightedCountries: Weighted<CountrySpec>[] = COUNTRIES.map((value) => ({
  value,
  weight: value.headcountWeight,
}));
const weightedDepartments: Weighted<DepartmentSpec>[] = DEPARTMENTS.map((value) => ({
  value,
  weight: value.headcountWeight,
}));
const weightedLevels: Weighted<JobLevelSpec>[] = JOB_LEVELS.map((value) => ({
  value,
  weight: value.headcountWeight,
}));

function pickGender(
  random: SeededRandom,
  department: DepartmentSpec,
  level: JobLevelSpec,
): GeneratedEmployee['gender'] {
  if (random.bool(PLANTED_SIGNALS.otherGenderShare)) return 'OTHER';
  if (random.bool(PLANTED_SIGNALS.undisclosedGenderShare)) return 'UNDISCLOSED';

  // The level adjustment is what creates the representation gradient: more
  // women at L1, fewer at L6. It is the dominant cause of the org-wide gap.
  const femaleShare = Math.min(
    0.95,
    Math.max(0.05, department.baseFemaleShare + level.femaleShareAdjustment),
  );
  return random.bool(femaleShare) ? 'FEMALE' : 'MALE';
}

function pickEmploymentType(random: SeededRandom): GeneratedEmployee['employmentType'] {
  if (random.bool(PLANTED_SIGNALS.contractShare)) return 'CONTRACT';
  if (random.bool(PLANTED_SIGNALS.partTimeShare)) return 'PART_TIME';
  return 'FULL_TIME';
}

/**
 * Where in (or out of) the band this person actually sits.
 *
 * Most people land near the midpoint with a log-normal spread. A planted
 * minority sits outside the band entirely — those are the people the "pay
 * outside band" screen exists to surface.
 */
function drawSalaryMajor(
  random: SeededRandom,
  band: GeneratedBand,
  department: DepartmentSpec,
  gender: GeneratedEmployee['gender'],
  country: CountrySpec,
): number {
  const perMajor = minorUnitsPerMajor(band.currency);
  const midMajor = band.midMinor / perMajor;

  let target: number;
  if (random.bool(PLANTED_SIGNALS.belowBandShare)) {
    target = (band.minMinor / perMajor) * random.float(0.82, 0.98);
  } else if (random.bool(PLANTED_SIGNALS.aboveBandShare)) {
    target = (band.maxMinor / perMajor) * random.float(1.02, 1.16);
  } else {
    target = midMajor * department.payMultiplier * random.logNormalFactor(PLANTED_SIGNALS.salarySigma);
  }

  // A small same-work penalty in two departments, so the like-for-like figure
  // is not exactly zero. Deliberately far smaller than the level gradient.
  if (gender === 'FEMALE' && PLANTED_SIGNALS.penalisedDepartments.includes(department.name)) {
    target *= 1 - PLANTED_SIGNALS.withinCohortFemalePenalty;
  }

  return roundToLocalStep(target, country);
}

/**
 * Build the salary history backwards from today's figure.
 *
 * Someone hired four years ago should have three or four salary rows behind
 * them, each a plausible raise. Generating forwards from a starting salary
 * would make current pay a consequence of the raises rather than of the band,
 * so instead the current figure is drawn first and earlier rows are derived by
 * dividing the raises back out.
 */
function buildCompensationHistory(
  random: SeededRandom,
  currentSalaryMajor: number,
  currency: CurrencyCode,
  hireDate: IsoDate,
  country: CountrySpec,
): GeneratedCompensation[] {
  const tenureYears = Math.floor(daysBetween(hireDate, AS_OF) / 365);
  const revisionCount = Math.max(0, Math.min(3, tenureYears));

  const raises = Array.from({ length: revisionCount }, () => {
    const reason = random.weighted([
      { value: 'MERIT' as const, weight: 0.68 },
      { value: 'PROMOTION' as const, weight: 0.18 },
      { value: 'MARKET_ADJUSTMENT' as const, weight: 0.14 },
    ]);
    const spread = RAISE_BANDS[reason];
    return { reason, factor: 1 + random.float(spread.min, spread.max) };
  });

  const compoundedGrowth = raises.reduce((total, raise) => total * raise.factor, 1);
  let runningMajor = roundToLocalStep(currentSalaryMajor / compoundedGrowth, country);

  const perMajor = minorUnitsPerMajor(currency);
  const rows: GeneratedCompensation[] = [];

  let effectiveFrom = hireDate;
  const push = (salaryMajor: number, reason: GeneratedCompensation['changeReason'], from: IsoDate) => {
    const minor = roundHalfUp(salaryMajor * perMajor);
    rows.push({
      baseSalaryMinor: minor,
      currency,
      effectiveFrom: from,
      effectiveTo: null,
      annualBaseUsdMinor: toUsdMinor(minor, currency, DEFAULT_FX_RATES),
      changeReason: reason,
    });
  };

  push(runningMajor, 'INITIAL', effectiveFrom);

  for (const [index, raise] of raises.entries()) {
    // Roughly the annual review cycle, jittered by a couple of months.
    const nextFrom = addDays(addYears(hireDate, index + 1), random.int(-45, 45));
    if (nextFrom >= AS_OF || nextFrom <= effectiveFrom) continue;

    runningMajor =
      index === raises.length - 1
        ? currentSalaryMajor
        : roundToLocalStep(runningMajor * raise.factor, country);

    push(runningMajor, raise.reason, nextFrom);
    effectiveFrom = nextFrom;
  }

  // The last row stays open; every earlier one closes the day before its successor.
  return rows.map((row, index) => {
    const next = rows[index + 1];
    return next ? { ...row, effectiveTo: addDays(next.effectiveFrom, -1) } : row;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateDataset(seed = SEED, total = TOTAL_EMPLOYEES): GeneratedDataset {
  const random = new SeededRandom(seed);
  const bands = buildBands();
  const bandIndex = new Map(bands.map((band) => [`${band.levelCode}|${band.countryCode}`, band]));

  const employees: GeneratedEmployee[] = [];
  const usedEmails = new Set<string>();

  for (let i = 0; i < total; i++) {
    const country = random.weighted(weightedCountries);
    const department = random.weighted(weightedDepartments);
    const level = random.weighted(weightedLevels);

    const band = bandIndex.get(`${level.code}|${country.code}`);
    if (!band) throw new Error(`No band for ${level.code} in ${country.code}`);

    const gender = pickGender(random, department, level);
    const pool = namePoolFor(country.code);
    const firstNames =
      gender === 'FEMALE' ? pool.femaleFirst
      : gender === 'MALE' ? pool.maleFirst
      : random.bool(0.5) ? pool.femaleFirst
      : pool.maleFirst;

    const firstName = random.pick(firstNames);
    const lastName = random.pick(pool.last);

    // Longer tenure is rarer — the org grew, so most people joined recently.
    const yearsAgo = random.skewedTowardsZero(1.8) * PLANTED_SIGNALS.maxTenureYears;
    const hireDate = addDays(AS_OF, -Math.round(yearsAgo * 365.25));

    const base = `${toEmailToken(firstName)}.${toEmailToken(lastName)}`;
    let email = `${base}@acme.example`;
    if (usedEmails.has(email)) email = `${base}${i + 1}@acme.example`;
    usedEmails.add(email);

    const salaryMajor = drawSalaryMajor(random, band, department, gender, country);
    const jobTitle = department.titles[level.code] ?? `${department.name} ${level.name}`;

    employees.push({
      employeeCode: `ACME-${String(i + 1).padStart(5, '0')}`,
      firstName,
      lastName,
      email,
      departmentName: department.name,
      levelCode: level.code,
      jobTitle,
      countryCode: country.code,
      currency: country.currency,
      hireDate,
      employmentType: pickEmploymentType(random),
      gender,
      status: random.bool(PLANTED_SIGNALS.terminatedShare) ? 'TERMINATED' : 'ACTIVE',
      managerIndex: null,
      compensations: buildCompensationHistory(random, salaryMajor, country.currency, hireDate, country),
    });
  }

  return { bands, employees: assignManagers(random, employees) };
}

/**
 * Wire up reporting lines after the fact, since a manager has to exist before
 * anyone can report to them. Managers are drawn from the same department one or
 * two levels up, which is what makes the org chart look like an org chart.
 */
function assignManagers(
  random: SeededRandom,
  employees: readonly GeneratedEmployee[],
): GeneratedEmployee[] {
  const rankOf = new Map(JOB_LEVELS.map((level) => [level.code, level.rank]));
  const candidates = new Map<string, number[]>();

  employees.forEach((employee, index) => {
    const key = `${employee.departmentName}|${employee.levelCode}`;
    const bucket = candidates.get(key);
    if (bucket) bucket.push(index);
    else candidates.set(key, [index]);
  });

  return employees.map((employee, index) => {
    const rank = rankOf.get(employee.levelCode) ?? 1;

    // Prefer the level directly above, fall back two levels for thin org slices.
    for (const step of [1, 2]) {
      const higher = JOB_LEVELS.find((level) => level.rank === rank + step);
      if (!higher) continue;

      const bucket = candidates.get(`${employee.departmentName}|${higher.code}`);
      if (!bucket || bucket.length === 0) continue;

      const managerIndex = random.pick(bucket);
      if (managerIndex === index) continue;

      return { ...employee, managerIndex };
    }

    // Vice Presidents, and anyone in a department with no one senior to them.
    return { ...employee, managerIndex: null };
  });
}
