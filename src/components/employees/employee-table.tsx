import Link from 'next/link';
import { BandMeter, BandPositionLabel } from '@/components/shared/band-position';
import { SalaryWithUsd } from '@/components/shared/money';
import { SortableHeader } from '@/components/employees/sortable-header';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EmployeeListItem } from '@/server/services/employee.service';

export function EmployeeTable({ items }: { readonly items: readonly EmployeeListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">No employees match these filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try widening the search, or clearing a filter.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><SortableHeader sortKey="name" label="Employee" /></TableHead>
            <TableHead><SortableHeader sortKey="department" label="Role" /></TableHead>
            <TableHead><SortableHeader sortKey="level" label="Level" /></TableHead>
            <TableHead><SortableHeader sortKey="country" label="Location" /></TableHead>
            <TableHead className="text-right">
              <SortableHeader sortKey="salary" label="Base salary" defaultDirection="desc" align="right" />
            </TableHead>
            <TableHead className="w-44">
              <SortableHeader sortKey="compaRatio" label="Vs band" defaultDirection="asc" />
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {items.map((employee) => (
            <TableRow key={employee.id} className="group">
              <TableCell>
                <Link
                  href={`/employees/${employee.id}`}
                  className="font-medium underline-offset-4 group-hover:underline"
                >
                  {employee.name}
                </Link>
                <div className="tabular text-xs text-muted-foreground">
                  {employee.employeeCode}
                  {employee.status === 'TERMINATED' && (
                    <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">Left</Badge>
                  )}
                  {employee.employmentType !== 'FULL_TIME' && (
                    <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                      {employee.employmentType === 'PART_TIME' ? 'Part time' : 'Contract'}
                    </Badge>
                  )}
                </div>
              </TableCell>

              <TableCell>
                <div className="leading-tight">
                  {employee.jobTitle}
                  <div className="text-xs text-muted-foreground">{employee.department}</div>
                </div>
              </TableCell>

              <TableCell className="text-muted-foreground">{employee.levelCode}</TableCell>

              <TableCell>
                <div className="leading-tight">
                  {employee.countryName}
                  <div className="text-xs text-muted-foreground">{employee.currency}</div>
                </div>
              </TableCell>

              <TableCell className="text-right">
                <SalaryWithUsd
                  minor={employee.baseSalaryMinor}
                  currency={employee.currency}
                  usdMinor={employee.annualBaseUsdMinor}
                />
              </TableCell>

              <TableCell>
                <div className="flex items-center justify-between gap-2">
                  <BandPositionLabel position={employee.bandPosition} />
                  {employee.compaRatio !== null && (
                    <span className="tabular text-xs text-muted-foreground">
                      {employee.compaRatio.toFixed(2)}
                    </span>
                  )}
                </div>
                <BandMeter
                  penetration={employee.rangePenetration}
                  position={employee.bandPosition}
                  className="mt-1.5"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
