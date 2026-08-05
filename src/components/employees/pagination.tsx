'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildQuery } from '@/lib/query-params';
import { cn } from '@/lib/utils';

interface PaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
  readonly pageSize: number;
}

export function Pagination({ page, totalPages, total, pageSize }: PaginationProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (target: number) => `${pathname}${buildQuery(params, { page: target })}`;

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="tabular text-muted-foreground">
        {total === 0
          ? 'No employees match these filters'
          : `${firstRow.toLocaleString('en-US')}–${lastRow.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}
      </p>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
          </PageLink>

          <span className="tabular px-2 text-muted-foreground">
            Page {page.toLocaleString('en-US')} of {totalPages.toLocaleString('en-US')}
          </span>

          <PageLink href={href(page + 1)} disabled={page >= totalPages} label="Next page">
            <ChevronRight className="size-4" aria-hidden />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  readonly href: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  const className = cn(
    'inline-flex size-8 items-center justify-center rounded-md border transition-colors',
    disabled ? 'pointer-events-none opacity-40' : 'hover:bg-secondary',
  );

  // At the ends the control becomes a span, not a disabled link — a link to
  // page 0 should not exist in the document at all.
  if (disabled) {
    return (
      <span className={className} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} scroll={false} className={className} aria-label={label}>
      {children}
    </Link>
  );
}
