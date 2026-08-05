import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/domain/dates';
import { DEFAULT_FX_RATES, toUsdMinor } from '@/domain/fx';
import { buildCohorts, likeForLikeGap, unadjustedGap } from '@/domain/pay-equity';
import {
  generateDataset,
  type GeneratedDataset,
  type GeneratedEmployee,
} from '../../scripts/seed/generate';
import {
  COUNTRIES,
  DEPARTMENTS,
  JOB_LEVELS,
  PLANTED_SIGNALS,
  SEED,
} from '../../scripts/seed/reference';

/**
 * The seed generator is data, but it is data the analytics screens are judged
 * on — so it gets tested like code.
 *
 * Two things are asserted here. First that generation is reproducible, since
 * the deployed demo re-seeds on every cold start and must look identical each
 * time. Second that the deliberately planted structure is actually present: a
 * change that flattens the data into uniform noise would leave every screen
 * working and every insight meaningless, which is the kind of regression no
 * other test would catch.
 *
 * Assertions over all 10,000 rows collect violations and assert once at the
 * end. Calling expect() inside the loop would mean ~130,000 assertions, which
 * costs seconds — and it would stop at the first bad row rather than naming
 * every one of them.
 */

let dataset: GeneratedDataset;
let active: readonly GeneratedEmployee[];
let bandsByKey: Map<string, GeneratedDataset['bands'][number]>;

const currentOf = (employee: GeneratedEmployee) =>
  employee.compensations.find((compensation) => compensation.effectiveTo === null);

const bandFor = (employee: GeneratedEmployee) =>
  bandsByKey.get(`${employee.levelCode}|${employee.countryCode}`)!;

beforeAll(() => {
  dataset = generateDataset();
  active = dataset.employees.filter((employee) => employee.status === 'ACTIVE');
  bandsByKey = new Map(dataset.bands.map((band) => [`${band.levelCode}|${band.countryCode}`, band]));
});

describe('reproducibility', () => {
  it('produces identical data from the same seed', () => {
    expect(generateDataset(SEED, 500)).toEqual(generateDataset(SEED, 500));
  });

  it('produces different data from a different seed', () => {
    expect(generateDataset(SEED, 500)).not.toEqual(generateDataset(SEED + 1, 500));
  });

  it('never consults the system clock or Math.random', async () => {
    // Both would break the guarantee above. A source-level check is cruder than
    // a behavioural one, but it catches the mistake at the point it is made.
    const { readFile } = await import('node:fs/promises');
    for (const file of ['generate.ts', 'random.ts', 'reference.ts', 'names.ts']) {
      const source = await readFile(new URL(`../../scripts/seed/${file}`, import.meta.url), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      expect(code, `${file} must not use Math.random`).not.toMatch(/Math\.random/);
      expect(code, `${file} must not read the system clock`).not.toMatch(/new Date\(\s*\)|Date\.now/);
    }
  });
});

describe('dataset shape', () => {
  it('generates exactly 10,000 employees', () => {
    expect(dataset.employees).toHaveLength(10_000);
  });

  it('gives every employee a unique code and email', () => {
    const codes = new Set(dataset.employees.map((employee) => employee.employeeCode));
    const emails = new Set(dataset.employees.map((employee) => employee.email));
    expect(codes.size).toBe(10_000);
    expect(emails.size).toBe(10_000);
  });

  it('produces email addresses that survive the trip through ASCII', () => {
    // Names include ś, ü, ł and spaces; the address must not.
    const malformed = dataset.employees
      .filter((employee) => !/^[a-z0-9.]+@acme\.example$/.test(employee.email))
      .map((employee) => employee.email);

    expect(malformed).toEqual([]);
  });

  it('covers every country, department and level', () => {
    expect(new Set(dataset.employees.map((employee) => employee.countryCode)).size).toBe(COUNTRIES.length);
    expect(new Set(dataset.employees.map((employee) => employee.departmentName)).size).toBe(DEPARTMENTS.length);
    expect(new Set(dataset.employees.map((employee) => employee.levelCode)).size).toBe(JOB_LEVELS.length);
  });

  it('builds a band for every level and country pair, min below mid below max', () => {
    expect(dataset.bands).toHaveLength(JOB_LEVELS.length * COUNTRIES.length);

    const disordered = dataset.bands.filter(
      (band) => !(band.minMinor < band.midMinor && band.midMinor < band.maxMinor),
    );
    expect(disordered).toEqual([]);
  });

  it('has a headcount pyramid — more juniors than vice presidents', () => {
    const countAt = (code: string) =>
      dataset.employees.filter((employee) => employee.levelCode === code).length;

    expect(countAt('L2')).toBeGreaterThan(countAt('L4'));
    expect(countAt('L4')).toBeGreaterThan(countAt('L6'));
  });
});

describe('compensation history', () => {
  it('leaves exactly one open interval per employee, and it is the last one', () => {
    const broken = dataset.employees
      .filter((employee) => {
        const open = employee.compensations.filter((row) => row.effectiveTo === null);
        return open.length !== 1 || employee.compensations.at(-1)?.effectiveTo !== null;
      })
      .map((employee) => employee.employeeCode);

    expect(broken).toEqual([]);
  });

  it('keeps intervals contiguous and non-overlapping', () => {
    // The ADR-0002 invariant, checked on generated data before it ever reaches
    // the database: each interval ends the day before the next one begins.
    const broken: string[] = [];

    for (const employee of dataset.employees) {
      const rows = employee.compensations;
      for (let i = 0; i < rows.length - 1; i++) {
        const current = rows[i]!;
        const next = rows[i + 1]!;
        if (
          current.effectiveTo !== addDays(next.effectiveFrom, -1) ||
          current.effectiveFrom >= next.effectiveFrom
        ) {
          broken.push(`${employee.employeeCode}: ${current.effectiveFrom}..${current.effectiveTo} then ${next.effectiveFrom}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('starts every history on the hire date with an INITIAL row', () => {
    const broken = dataset.employees
      .filter((employee) => {
        const first = employee.compensations[0];
        return first?.effectiveFrom !== employee.hireDate || first.changeReason !== 'INITIAL';
      })
      .map((employee) => employee.employeeCode);

    expect(broken).toEqual([]);
  });

  it('keeps the denormalised USD amount consistent with the local figure', () => {
    const mismatched = dataset.employees.flatMap((employee) =>
      employee.compensations
        .filter(
          (row) =>
            row.annualBaseUsdMinor !== toUsdMinor(row.baseSalaryMinor, row.currency, DEFAULT_FX_RATES),
        )
        .map((row) => `${employee.employeeCode} @ ${row.effectiveFrom}`),
    );

    expect(mismatched).toEqual([]);
  });

  it('gives longer-tenured people more salary history', () => {
    const averageHireDate = (rowCount: number) => {
      const group = dataset.employees.filter((employee) => employee.compensations.length === rowCount);
      return group.reduce((total, employee) => total + Date.parse(employee.hireDate), 0) / group.length;
    };

    expect(averageHireDate(4)).toBeLessThan(averageHireDate(1));
  });
});

describe('planted signals', () => {
  const positionOf = (employee: GeneratedEmployee) => {
    const salary = currentOf(employee)?.baseSalaryMinor ?? 0;
    const band = bandFor(employee);
    return salary < band.minMinor ? 'BELOW' : salary > band.maxMinor ? 'ABOVE' : 'WITHIN';
  };

  it('places roughly the intended share of people below their band', () => {
    const below = active.filter((employee) => positionOf(employee) === 'BELOW').length;
    const share = below / active.length;

    expect(share).toBeGreaterThan(PLANTED_SIGNALS.belowBandShare * 0.6);
    expect(share).toBeLessThan(PLANTED_SIGNALS.belowBandShare * 1.6);
  });

  it('places some people above their band, so the outlier screen is not empty', () => {
    const above = active.filter((employee) => positionOf(employee) === 'ABOVE').length;
    expect(above).toBeGreaterThan(100);
  });

  it('leaves most people inside their band', () => {
    const within = active.filter((employee) => positionOf(employee) === 'WITHIN').length;
    expect(within / active.length).toBeGreaterThan(0.85);
  });

  it('under-represents women at every step up the ladder', () => {
    const shareFemale = (code: string) => {
      const atLevel = active.filter(
        (employee) =>
          employee.levelCode === code && (employee.gender === 'FEMALE' || employee.gender === 'MALE'),
      );
      return atLevel.filter((employee) => employee.gender === 'FEMALE').length / atLevel.length;
    };

    const byLevel = JOB_LEVELS.map((level) => shareFemale(level.code));
    const notDecreasing = byLevel
      .map((share, i) => ({ share, previous: byLevel[i - 1], level: JOB_LEVELS[i]!.code }))
      .filter((entry) => entry.previous !== undefined && entry.share >= entry.previous)
      .map((entry) => entry.level);

    expect(notDecreasing).toEqual([]);
  });

  it('produces a headline pay gap that is mostly representation, not pay setting', () => {
    // The property the analytics screen exists to demonstrate. If a change to
    // the generator ever made these two numbers similar, every screen would
    // still render — it would just no longer show anything worth knowing.
    const salaryOf = (employee: GeneratedEmployee) => currentOf(employee)!.annualBaseUsdMinor;

    const headline = unadjustedGap(
      active.filter((employee) => employee.gender === 'MALE').map(salaryOf),
      active.filter((employee) => employee.gender === 'FEMALE').map(salaryOf),
    );

    const withinCohorts = likeForLikeGap(
      buildCohorts(
        active.map((employee) => ({
          department: employee.departmentName,
          level: employee.levelCode,
          gender: employee.gender,
          salary: salaryOf(employee),
        })),
      ),
    );

    expect(headline.medianGap).toBeGreaterThan(0.05);
    expect(withinCohorts.weightedMedianGap).toBeLessThan(0.02);
    expect(headline.medianGap!).toBeGreaterThan(withinCohorts.weightedMedianGap! * 4);

    // And the like-for-like figure has to cover enough of the org to mean anything.
    expect(withinCohorts.coverage!).toBeGreaterThan(0.5);
  });

  it('includes leavers, part-timers and contractors', () => {
    expect(new Set(dataset.employees.map((employee) => employee.status))).toEqual(
      new Set(['ACTIVE', 'TERMINATED']),
    );
    expect(new Set(dataset.employees.map((employee) => employee.employmentType))).toEqual(
      new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT']),
    );
  });

  it('records genders that a binary pay-gap comparison cannot represent', () => {
    expect(new Set(dataset.employees.map((employee) => employee.gender))).toEqual(
      new Set(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']),
    );
  });
});

describe('reporting lines', () => {
  it('puts every manager in the same department, at a higher level, and never themselves', () => {
    const rankOf = new Map(JOB_LEVELS.map((level) => [level.code, level.rank]));

    const broken = dataset.employees
      .filter((employee, index) => {
        if (employee.managerIndex === null) return false;
        if (employee.managerIndex === index) return true;

        const manager = dataset.employees[employee.managerIndex]!;
        return (
          manager.departmentName !== employee.departmentName ||
          rankOf.get(manager.levelCode)! <= rankOf.get(employee.levelCode)!
        );
      })
      .map((employee) => employee.employeeCode);

    expect(broken).toEqual([]);
  });

  it('gives most people a manager', () => {
    const withManager = dataset.employees.filter((employee) => employee.managerIndex !== null);
    expect(withManager.length / dataset.employees.length).toBeGreaterThan(0.9);
  });
});
