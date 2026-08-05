import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployeeFilters } from '@/components/employees/employee-filters';
import { EmployeeTable } from '@/components/employees/employee-table';
import { Pagination } from '@/components/employees/pagination';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getDb } from '@/server/db/client';
import { parse } from '@/server/http/handler';
import { directoryQuerySchema, toDirectoryQuery } from '@/server/http/schemas';
import { getFilterOptions, listEmployees } from '@/server/services/employee.service';

export const metadata: Metadata = { title: 'Employees · ACME Salary Management' };
export const dynamic = 'force-dynamic';

/**
 * The directory reads its state from the URL and calls the service directly.
 *
 * Calling the service rather than fetching /api/employees avoids the server
 * making an HTTP request to itself. The REST route still exists and is covered
 * by tests — both go through the same schema and the same service, so they
 * cannot diverge.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = toDirectoryQuery(parse(flatten(raw), directoryQuerySchema));

  const db = getDb();
  const page = listEmployees(db, query);
  const options = getFilterOptions(db);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Search, filter and compare compensation across the organisation."
      />

      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full" />}>
        <EmployeeFilters options={options} />
      </Suspense>

      <EmployeeTable items={page.items} />

      <Suspense fallback={null}>
        <Pagination
          page={page.page}
          totalPages={page.totalPages}
          total={page.total}
          pageSize={page.pageSize}
        />
      </Suspense>
    </>
  );
}

/** Repeated query keys collapse to the first value; no filter here is a list. */
function flatten(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}
