import type { Metadata } from 'next';
import { Download, FileSpreadsheet } from 'lucide-react';
import { SalaryImport } from '@/components/data/salary-import';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Import & export · ACME Salary Management' };

export default function DataPage() {
  return (
    <>
      <PageHeader
        title="Import & export"
        description="Move data in and out as CSV — the format every spreadsheet already speaks."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SalaryImport />

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <h2 className="text-base font-semibold">Export</h2>
              <p className="text-sm text-muted-foreground">
                Every employee with their current salary, band, compa-ratio and band position —
                already worked out, so nothing has to be recalculated in the spreadsheet.
              </p>
            </CardHeader>

            <CardContent className="space-y-3">
              <Button asChild variant="outline" className="w-full justify-start">
                <a href="/api/data/export" download>
                  <Download className="size-4" aria-hidden />
                  Download all employees
                </a>
              </Button>

              <Button asChild variant="ghost" className="w-full justify-start">
                <a href="/api/data/export?template=1" download>
                  <FileSpreadsheet className="size-4" aria-hidden />
                  Download an import template
                </a>
              </Button>

              <p className="text-xs text-muted-foreground">
                Salaries are written in whole currency units, not cents, and the file carries a
                byte-order mark so Excel reads accented names correctly.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <h2 className="text-base font-semibold">How the import works</h2>
            </CardHeader>

            <CardContent>
              <ol className="space-y-3 text-sm text-muted-foreground">
                <Step number={1}>
                  <span className="text-foreground">Upload and review.</span> Every row is checked
                  before anything is written, and problems are reported with the line number you
                  will see in your spreadsheet.
                </Step>
                <Step number={2}>
                  <span className="text-foreground">See the effect.</span> Each row shows the change
                  in that employee&rsquo;s own currency, and the total shows the effect on annual
                  payroll in USD.
                </Step>
                <Step number={3}>
                  <span className="text-foreground">Confirm.</span> Applying is all or nothing. A
                  file with one bad row changes nothing — a payroll file applied halfway is worse
                  than one that was rejected.
                </Step>
              </ol>

              <div className="mt-5 rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">Columns</p>
                <p className="mt-1">
                  <code>employee_code</code>, <code>new_salary</code> and{' '}
                  <code>effective_from</code> are required. <code>change_reason</code> and{' '}
                  <code>note</code> are optional; a blank reason is recorded as a merit increase.
                  Column names are matched loosely, so &ldquo;Employee Code&rdquo; and{' '}
                  <code>employee_code</code> both work.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Step({ number, children }: { readonly number: number; readonly children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
        {number}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
