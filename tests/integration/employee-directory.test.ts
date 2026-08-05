import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bandPosition } from '@/domain/compensation';
import { NotFoundError } from '@/server/http/errors';
import { directoryQuerySchema, toDirectoryQuery } from '@/server/http/schemas';
import {
  countDanglingCompensationPointers,
  type DirectoryQuery,
} from '@/server/repositories/employee.repository';
import { getEmployee, getFilterOptions, listEmployees } from '@/server/services/employee.service';
import { addEmployee, bandMidMajor, createTestContext, type TestContext } from '@tests/helpers/test-db';

let context: TestContext;

/** Defaults so each test names only the dimension it cares about. */
const query = (overrides: Partial<DirectoryQuery> = {}): DirectoryQuery => ({
  filters: {},
  sortKey: 'name',
  sortDirection: 'asc',
  page: 1,
  pageSize: 25,
  ...overrides,
});

const namesOf = (page: { items: readonly { name: string }[] }) =>
  page.items.map((item) => item.name);

beforeEach(() => {
  context = createTestContext();
});

afterEach(() => {
  context.connection.close();
});

describe('listEmployees — filtering', () => {
  beforeEach(() => {
    addEmployee(context, { firstName: 'Ada', lastName: 'Lovelace', department: 'Engineering', level: 'L3', country: 'US' });
    addEmployee(context, { firstName: 'Grace', lastName: 'Hopper', department: 'Engineering', level: 'L2', country: 'US' });
    addEmployee(context, { firstName: 'Alan', lastName: 'Turing', department: 'Sales', level: 'L2', country: 'IN' });
    addEmployee(context, { firstName: 'Katherine', lastName: 'Johnson', department: 'People', level: 'L1', country: 'IN', status: 'TERMINATED' });
  });

  it('returns everyone when nothing is filtered', () => {
    expect(listEmployees(context.db, query()).total).toBe(4);
  });

  it('filters by department', () => {
    const page = listEmployees(context.db, query({ filters: { departmentId: context.departmentIds.Engineering } }));
    expect(namesOf(page)).toEqual(['Grace Hopper', 'Ada Lovelace']);
  });

  it('filters by country', () => {
    const page = listEmployees(context.db, query({ filters: { countryCode: 'IN' } }));
    expect(namesOf(page).sort()).toEqual(['Alan Turing', 'Katherine Johnson']);
  });

  it('filters by level', () => {
    const page = listEmployees(context.db, query({ filters: { jobLevelId: context.levelIds.L2 } }));
    expect(page.total).toBe(2);
  });

  it('filters by status', () => {
    const page = listEmployees(context.db, query({ filters: { status: 'ACTIVE' } }));
    expect(page.total).toBe(3);
  });

  it('combines filters as AND, not OR', () => {
    const page = listEmployees(
      context.db,
      query({ filters: { departmentId: context.departmentIds.Engineering, jobLevelId: context.levelIds.L2 } }),
    );
    expect(namesOf(page)).toEqual(['Grace Hopper']);
  });

  it('finds people by full name, code, email or job title', () => {
    // Full name spans two columns, so "ada love" only matches if the search
    // concatenates them rather than testing each in isolation.
    expect(namesOf(listEmployees(context.db, query({ filters: { search: 'ada love' } })))).toEqual(['Ada Lovelace']);

    const ada = listEmployees(context.db, query({ filters: { search: 'Lovelace' } })).items[0]!;
    expect(namesOf(listEmployees(context.db, query({ filters: { search: ada.employeeCode } })))).toEqual(['Ada Lovelace']);
    expect(namesOf(listEmployees(context.db, query({ filters: { search: ada.email } })))).toEqual(['Ada Lovelace']);

    expect(listEmployees(context.db, query({ filters: { search: '@test.example' } })).total).toBe(4);
    expect(listEmployees(context.db, query({ filters: { search: 'Sales' } })).total).toBe(1);
  });

  it('searches without regard to case', () => {
    expect(namesOf(listEmployees(context.db, query({ filters: { search: 'HOPPER' } })))).toEqual(['Grace Hopper']);
  });

  it('returns nothing rather than everything for an unmatched search', () => {
    expect(listEmployees(context.db, query({ filters: { search: 'nobody at all' } })).total).toBe(0);
  });

  it('ignores a search that is only whitespace', () => {
    expect(listEmployees(context.db, query({ filters: { search: '   ' } })).total).toBe(4);
  });
});

describe('listEmployees — band position', () => {
  beforeEach(() => {
    // US L2 band is 64,000 – 80,000 – 96,000.
    addEmployee(context, { firstName: 'Under', lastName: 'Paid', level: 'L2', country: 'US', salaryMajor: 60_000 });
    addEmployee(context, { firstName: 'Fairly', lastName: 'Paid', level: 'L2', country: 'US', salaryMajor: 80_000 });
    addEmployee(context, { firstName: 'Over', lastName: 'Paid', level: 'L2', country: 'US', salaryMajor: 120_000 });
    addEmployee(context, { firstName: 'Exactly', lastName: 'Min', level: 'L2', country: 'US', salaryMajor: 64_000 });
    addEmployee(context, { firstName: 'Exactly', lastName: 'Max', level: 'L2', country: 'US', salaryMajor: 96_000 });
  });

  it('finds everyone paid below their band', () => {
    const page = listEmployees(context.db, query({ filters: { bandPosition: 'BELOW' } }));
    expect(namesOf(page)).toEqual(['Under Paid']);
  });

  it('finds everyone paid above their band', () => {
    const page = listEmployees(context.db, query({ filters: { bandPosition: 'ABOVE' } }));
    expect(namesOf(page)).toEqual(['Over Paid']);
  });

  it('counts both band bounds as inside', () => {
    const page = listEmployees(context.db, query({ filters: { bandPosition: 'WITHIN' } }));
    expect(page.total).toBe(3);
  });

  it('labels rows the same way the SQL filter classifies them', () => {
    // The filter lives in SQL and the label comes from domain/compensation.ts.
    // If they ever drift, a filtered list would show rows contradicting the
    // filter that produced it — so assert on every row that they agree.
    for (const position of ['BELOW', 'WITHIN', 'ABOVE'] as const) {
      const page = listEmployees(context.db, query({ filters: { bandPosition: position }, pageSize: 100 }));

      const disagreements = page.items.filter((item) => {
        if (!item.band || item.baseSalaryMinor === null) return true;
        return (
          item.bandPosition !== position ||
          bandPosition(item.baseSalaryMinor, item.band) !== position
        );
      });

      expect(disagreements, `rows filtered as ${position}`).toEqual([]);
    }
  });

  it('computes compa-ratio against the band midpoint', () => {
    const page = listEmployees(context.db, query({ filters: { search: 'Fairly' } }));
    expect(page.items[0]?.compaRatio).toBe(1);

    const under = listEmployees(context.db, query({ filters: { search: 'Under' } }));
    expect(under.items[0]?.compaRatio).toBeCloseTo(60_000 / 80_000, 10);
  });
});

describe('listEmployees — sorting', () => {
  beforeEach(() => {
    addEmployee(context, { firstName: 'Ada', lastName: 'Zeta', level: 'L1', country: 'US', salaryMajor: 50_000, hireDate: '2020-01-01' });
    addEmployee(context, { firstName: 'Bob', lastName: 'Alpha', level: 'L3', country: 'US', salaryMajor: 120_000, hireDate: '2023-06-01' });
    // ₹1,792,000 is $22,400 — a big local number that is a small global one.
    addEmployee(context, { firstName: 'Cy', lastName: 'Mid', level: 'L2', country: 'IN', salaryMajor: 1_792_000, hireDate: '2022-01-01' });
  });

  it('sorts by surname by default', () => {
    expect(namesOf(listEmployees(context.db, query()))).toEqual(['Bob Alpha', 'Cy Mid', 'Ada Zeta']);
  });

  it('reverses on request', () => {
    expect(namesOf(listEmployees(context.db, query({ sortDirection: 'desc' })))).toEqual([
      'Ada Zeta', 'Cy Mid', 'Bob Alpha',
    ]);
  });

  it('sorts salary by the USD figure, not the local one', () => {
    // Sorting on local amounts would rank ₹1,792,000 above $120,000.
    const page = listEmployees(context.db, query({ sortKey: 'salary', sortDirection: 'desc' }));
    expect(namesOf(page)).toEqual(['Bob Alpha', 'Ada Zeta', 'Cy Mid']);
  });

  it('sorts levels by seniority, not by the label', () => {
    const page = listEmployees(context.db, query({ sortKey: 'level', sortDirection: 'desc' }));
    expect(page.items.map((item) => item.levelCode)).toEqual(['L3', 'L2', 'L1']);
  });

  it('sorts by hire date', () => {
    const page = listEmployees(context.db, query({ sortKey: 'hireDate', sortDirection: 'asc' }));
    expect(namesOf(page)).toEqual(['Ada Zeta', 'Cy Mid', 'Bob Alpha']);
  });

  it('breaks ties deterministically, so paging never repeats or skips a row', () => {
    for (let i = 0; i < 6; i++) {
      addEmployee(context, { firstName: 'Same', lastName: 'Name', level: 'L2', country: 'US', salaryMajor: 80_000 });
    }

    const first = listEmployees(context.db, query({ sortKey: 'salary', pageSize: 4, page: 1 }));
    const second = listEmployees(context.db, query({ sortKey: 'salary', pageSize: 4, page: 2 }));

    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('listEmployees — pagination', () => {
  beforeEach(() => {
    for (let i = 0; i < 30; i++) {
      addEmployee(context, { firstName: 'Person', lastName: `N${String(i).padStart(2, '0')}` });
    }
  });

  it('returns one page at a time and reports the full total', () => {
    const page = listEmployees(context.db, query({ pageSize: 10, page: 1 }));
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(30);
    expect(page.totalPages).toBe(3);
  });

  it('walks through every row across pages without repeats', () => {
    const seen = new Set<number>();
    for (let page = 1; page <= 3; page++) {
      for (const item of listEmployees(context.db, query({ pageSize: 10, page })).items) {
        seen.add(item.id);
      }
    }
    expect(seen.size).toBe(30);
  });

  it('clamps a page beyond the end back to the last page', () => {
    // A filter change can leave the browser asking for page 9 of 3.
    const page = listEmployees(context.db, query({ pageSize: 10, page: 99 }));
    expect(page.page).toBe(3);
    expect(page.items).toHaveLength(10);
  });

  it('caps page size so one request cannot ask for all 10,000 rows', () => {
    expect(listEmployees(context.db, query({ pageSize: 5_000 })).pageSize).toBe(100);
  });

  it('reports one page, not zero, when nothing matches', () => {
    const page = listEmployees(context.db, query({ filters: { search: 'nobody' } }));
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.items).toEqual([]);
  });
});

describe('getEmployee', () => {
  it('returns the employee with band measures attached', () => {
    const id = addEmployee(context, { firstName: 'Ada', lastName: 'Lovelace', level: 'L2', country: 'US', salaryMajor: 72_000 });

    const employee = getEmployee(context.db, id);
    expect(employee.name).toBe('Ada Lovelace');
    expect(employee.band?.midMinor).toBe(bandMidMajor('L2', 'US') * 100);
    expect(employee.compaRatio).toBeCloseTo(0.9, 10);
    expect(employee.bandPosition).toBe('WITHIN');
  });

  it('resolves the reporting line in both directions', () => {
    const managerId = addEmployee(context, { firstName: 'Manager', lastName: 'Person', level: 'L3' });
    addEmployee(context, { firstName: 'Report', lastName: 'One', level: 'L2', managerId });
    addEmployee(context, { firstName: 'Report', lastName: 'Two', level: 'L2', managerId });

    expect(getEmployee(context.db, managerId).directReports).toBe(2);
    expect(getEmployee(context.db, managerId).manager).toBeNull();
  });

  it('names the manager on a report', () => {
    const managerId = addEmployee(context, { firstName: 'Grace', lastName: 'Hopper', level: 'L3' });
    const reportId = addEmployee(context, { firstName: 'Alan', lastName: 'Turing', level: 'L2', managerId });

    expect(getEmployee(context.db, reportId).manager?.lastName).toBe('Hopper');
  });

  it('raises a not-found for an id that does not exist', () => {
    expect(() => getEmployee(context.db, 999_999)).toThrow(NotFoundError);
  });
});

describe('data integrity', () => {
  it('leaves no compensation pointer dangling', () => {
    addEmployee(context);
    addEmployee(context);
    expect(countDanglingCompensationPointers(context.db)).toBe(0);
  });

  it('offers every department, level and country as a filter option', () => {
    const options = getFilterOptions(context.db);
    expect(options.departments.map((d) => d.name)).toEqual(['Engineering', 'People', 'Sales']);
    expect(options.levels.map((l) => l.code)).toEqual(['L1', 'L2', 'L3']);
    expect(options.countries.map((c) => c.code)).toEqual(['IN', 'US']);
  });
});

describe('query parsing', () => {
  const parse = (search: string) =>
    toDirectoryQuery(directoryQuerySchema.parse(Object.fromEntries(new URLSearchParams(search))));

  it('applies sensible defaults to an empty query string', () => {
    expect(parse('')).toEqual({
      filters: {
        search: undefined, departmentId: undefined, jobLevelId: undefined, countryCode: undefined,
        status: undefined, employmentType: undefined, bandPosition: undefined,
      },
      sortKey: 'name',
      sortDirection: 'asc',
      page: 1,
      pageSize: 25,
    });
  });

  it('treats a blank parameter as absent rather than as zero', () => {
    // "?departmentId=" is what a cleared <select> submits; coercing it to 0
    // would filter on a department that cannot exist and return nothing.
    expect(parse('departmentId=&search=&countryCode=').filters).toMatchObject({
      departmentId: undefined,
      search: undefined,
      countryCode: undefined,
    });
  });

  it('accepts a lowercase country code', () => {
    expect(parse('countryCode=us').filters.countryCode).toBe('US');
  });

  it('rejects a sort key that is not a real column', () => {
    expect(() => parse('sort=passwordHash')).toThrow();
  });

  it('rejects a page size above the cap', () => {
    expect(() => parse('pageSize=100000')).toThrow();
  });

  it('rejects a page below one', () => {
    expect(() => parse('page=0')).toThrow();
  });
});
