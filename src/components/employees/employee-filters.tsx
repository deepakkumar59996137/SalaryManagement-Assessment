'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilterOptions } from '@/server/services/employee.service';
import { ANY_VALUE, buildQuery } from '@/lib/query-params';

interface EmployeeFiltersProps {
  readonly options: FilterOptions;
}

/**
 * The filter bar writes to the URL rather than to component state.
 *
 * That makes every view of the directory a link: "everyone in Germany paid
 * below band" is something the HR Manager can bookmark, share, and reach with
 * the back button. It also means the page stays a server component — the table
 * is rendered from the URL, not hydrated from a client fetch.
 */
export function EmployeeFilters({ options }: EmployeeFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlSearch = params.get('search') ?? '';

  // Local state so typing feels immediate; the URL is the source of truth.
  const [search, setSearch] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);

  // When the URL changes from somewhere else — "Clear all", the back button, a
  // pasted link — the input has to follow. Adjusting state during render is
  // React's documented alternative to a syncing effect, which would cost an
  // extra render pass and flash the stale value.
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearch(urlSearch);
  }

  const setParam = (key: string, value: string | undefined) => {
    router.push(`${pathname}${buildQuery(params, { [key]: value })}`);
  };

  // Debounce the search so typing "Lovelace" is one query rather than eight.
  useEffect(() => {
    if (search === urlSearch) return;

    const timer = setTimeout(() => {
      router.push(`${pathname}${buildQuery(params, { search: search || undefined })}`);
    }, 250);

    return () => clearTimeout(timer);
  }, [search, urlSearch, params, pathname, router]);

  const activeCount = ['departmentId', 'jobLevelId', 'countryCode', 'status', 'employmentType', 'bandPosition', 'search']
    .filter((key) => params.get(key))
    .length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, code, email or title"
          aria-label="Search employees"
          className="pl-8"
        />
      </div>

      <FilterSelect
        label="Department"
        value={params.get('departmentId')}
        onChange={(value) => setParam('departmentId', value)}
        items={options.departments.map((d) => ({ value: String(d.id), label: d.name }))}
      />

      <FilterSelect
        label="Level"
        value={params.get('jobLevelId')}
        onChange={(value) => setParam('jobLevelId', value)}
        items={options.levels.map((l) => ({ value: String(l.id), label: `${l.code} · ${l.name}` }))}
      />

      <FilterSelect
        label="Country"
        value={params.get('countryCode')}
        onChange={(value) => setParam('countryCode', value)}
        items={options.countries.map((c) => ({ value: c.code, label: c.name }))}
      />

      <FilterSelect
        label="Pay vs band"
        value={params.get('bandPosition')}
        onChange={(value) => setParam('bandPosition', value)}
        items={[
          { value: 'BELOW', label: 'Below band' },
          { value: 'WITHIN', label: 'In band' },
          { value: 'ABOVE', label: 'Above band' },
        ]}
      />

      <FilterSelect
        label="Status"
        value={params.get('status')}
        onChange={(value) => setParam('status', value)}
        items={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'TERMINATED', label: 'Left' },
        ]}
      />

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
          <X className="size-4" aria-hidden />
          Clear {activeCount}
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  items,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (value: string | undefined) => void;
  readonly items: readonly { value: string; label: string }[];
}) {
  return (
    <Select
      value={value ?? ANY_VALUE}
      onValueChange={(next) => onChange(next === ANY_VALUE ? undefined : next)}
    >
      <SelectTrigger className="w-auto min-w-32" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>{label}: any</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
