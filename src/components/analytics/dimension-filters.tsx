'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilterOptions } from '@/server/services/employee.service';
import { ANY_VALUE, buildQuery } from '@/lib/query-params';

/**
 * Slice the analytics by country, department or level.
 *
 * Same URL-as-state approach as the directory: every view of the analytics is
 * a link, so "the German engineering picture" can be sent to someone rather
 * than described to them.
 */
export function DimensionFilters({ options }: { readonly options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = (key: string, value: string | undefined) => {
    router.push(`${pathname}${buildQuery(params, { [key]: value })}`);
  };

  const active = ['countryCode', 'departmentId', 'jobLevelId'].filter((key) => params.get(key));

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Country"
        value={params.get('countryCode')}
        onChange={(value) => setParam('countryCode', value)}
        items={options.countries.map((country) => ({ value: country.code, label: country.name }))}
      />

      <FilterSelect
        label="Department"
        value={params.get('departmentId')}
        onChange={(value) => setParam('departmentId', value)}
        items={options.departments.map((department) => ({
          value: String(department.id),
          label: department.name,
        }))}
      />

      <FilterSelect
        label="Level"
        value={params.get('jobLevelId')}
        onChange={(value) => setParam('jobLevelId', value)}
        items={options.levels.map((level) => ({
          value: String(level.id),
          label: `${level.code} · ${level.name}`,
        }))}
      />

      {active.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
          <X className="size-4" aria-hidden />
          Clear {active.length}
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
      <SelectTrigger className="w-auto min-w-36" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>{label}: all</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
