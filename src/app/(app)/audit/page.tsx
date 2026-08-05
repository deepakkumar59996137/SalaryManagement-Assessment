import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { Pagination } from '@/components/employees/pagination';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getDb } from '@/server/db/client';
import { parse } from '@/server/http/handler';
import { listAuditEntries } from '@/server/services/audit.service';

export const metadata: Metadata = { title: 'Audit log · ACME Salary Management' };
export const dynamic = 'force-dynamic';

const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const querySchema = z.object({
  action: z.preprocess(
    blankToUndefined,
    z.enum(['CREATE', 'UPDATE', 'SALARY_REVISION', 'IMPORT']).optional(),
  ),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(1)),
});

const ACTION_LABELS = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  SALARY_REVISION: 'Salary change',
  IMPORT: 'Bulk import',
} as const;

/** UTC, spelled out — an audit timestamp that is ambiguous about zone is useless. */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = parse(
    Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
        .filter(([, value]) => typeof value === 'string'),
    ),
    querySchema,
  );

  const result = listAuditEntries(getDb(), { action: query.action }, query.page);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to compensation, who made it and when. Append-only — nothing here can be edited or removed."
      />

      {result.total === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <ShieldCheck className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">No changes recorded yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Salary changes made through the app appear here. Seeded history is written directly and
            is not audited.
          </p>
        </div>
      ) : (
        <>
          <ol className="divide-y rounded-lg border">
            {result.entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {entry.entity === 'COMPENSATION' && entry.entityId > 0 ? (
                      <span>{entry.summary}</span>
                    ) : (
                      entry.summary
                    )}
                  </p>
                  <p className="tabular mt-1 text-xs text-muted-foreground">
                    {TIMESTAMP_FORMAT.format(new Date(entry.at))} UTC
                    <span className="mx-1.5 text-border">·</span>
                    {entry.actorName ?? 'System'}
                  </p>
                </div>

                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {ACTION_LABELS[entry.action]}
                </Badge>
              </li>
            ))}
          </ol>

          <Suspense fallback={<Skeleton className="mt-4 h-8 w-64" />}>
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              pageSize={result.pageSize}
            />
          </Suspense>
        </>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Looking for one person&rsquo;s history? Their full salary timeline is on their{' '}
        <Link href="/employees" className="underline underline-offset-4">
          employee page
        </Link>
        .
      </p>
    </>
  );
}
