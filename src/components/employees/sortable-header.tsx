'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { buildQuery } from '@/lib/query-params';
import { cn } from '@/lib/utils';

interface SortableHeaderProps {
  readonly sortKey: string;
  readonly label: string;
  /** Numeric columns sort high-to-low first — that is the interesting end. */
  readonly defaultDirection?: 'asc' | 'desc';
  readonly align?: 'left' | 'right';
}

/**
 * A column header that sorts by navigating.
 *
 * A link rather than a button, so sorted views are shareable, the back button
 * undoes a sort, and the column works with JavaScript disabled.
 */
export function SortableHeader({
  sortKey,
  label,
  defaultDirection = 'asc',
  align = 'left',
}: SortableHeaderProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  const activeKey = params.get('sort') ?? 'name';
  const activeDirection = params.get('direction') === 'desc' ? 'desc' : 'asc';
  const isActive = activeKey === sortKey;

  const nextDirection = isActive ? (activeDirection === 'asc' ? 'desc' : 'asc') : defaultDirection;
  const href = `${pathname}${buildQuery(params, { sort: sortKey, direction: nextDirection })}`;

  const Icon = !isActive ? ChevronsUpDown : activeDirection === 'asc' ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href}
      scroll={false}
      aria-sort={isActive ? (activeDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'group inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground',
        isActive ? 'text-foreground' : 'text-muted-foreground',
        align === 'right' && 'flex-row-reverse',
      )}
    >
      {label}
      <Icon
        className={cn('size-3.5 shrink-0', isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')}
        aria-hidden
      />
    </Link>
  );
}
