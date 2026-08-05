import { z } from 'zod';
import type { DirectoryQuery } from '../repositories/employee.repository';

/**
 * Request schemas, shared by the route handlers and the pages.
 *
 * Both entry points parse the same object, so a URL typed by hand, a link
 * pasted from a colleague and a fetch from the table all go through identical
 * validation — and the directory page can be bookmarked.
 */

/**
 * Query strings carry `?departmentId=` for "no filter selected", and
 * `z.coerce.number()` would turn that empty string into 0. Treat blank as absent.
 */
const blankToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const optionalId = z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional());
const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

export const EMPLOYEE_SORT_KEYS = [
  'name',
  'salary',
  'level',
  'department',
  'country',
  'hireDate',
  'compaRatio',
] as const;

export const directoryQuerySchema = z.object({
  search: optionalText,
  departmentId: optionalId,
  jobLevelId: optionalId,
  countryCode: z.preprocess(blankToUndefined, z.string().length(2).toUpperCase().optional()),
  status: z.preprocess(blankToUndefined, z.enum(['ACTIVE', 'TERMINATED']).optional()),
  employmentType: z.preprocess(
    blankToUndefined,
    z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).optional(),
  ),
  bandPosition: z.preprocess(blankToUndefined, z.enum(['BELOW', 'WITHIN', 'ABOVE']).optional()),

  sort: z.preprocess(blankToUndefined, z.enum(EMPLOYEE_SORT_KEYS).default('name')),
  direction: z.preprocess(blankToUndefined, z.enum(['asc', 'desc']).default('asc')),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).default(25)),
});

export type DirectoryQueryInput = z.infer<typeof directoryQuerySchema>;

/** Flatten the parsed query into the shape the repository expects. */
export function toDirectoryQuery(input: DirectoryQueryInput): DirectoryQuery {
  return {
    filters: {
      search: input.search,
      departmentId: input.departmentId,
      jobLevelId: input.jobLevelId,
      countryCode: input.countryCode,
      status: input.status,
      employmentType: input.employmentType,
      bandPosition: input.bandPosition,
    },
    sortKey: input.sort,
    sortDirection: input.direction,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export const employeeIdSchema = z.coerce.number().int().positive();
