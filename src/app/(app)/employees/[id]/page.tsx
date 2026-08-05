import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { formatDateLong, systemClock } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { CompensationTimeline } from '@/components/employees/compensation-timeline';
import { RaiseDialog } from '@/components/employees/raise-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { BandMeter, BandPositionLabel } from '@/components/shared/band-position';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getDb } from '@/server/db/client';
import { NotFoundError } from '@/server/http/errors';
import { getCompensationHistory } from '@/server/services/compensation.service';
import { getEmployee } from '@/server/services/employee.service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const employee = getEmployee(getDb(), Number(id));
    return { title: `${employee.name} · ACME Salary Management` };
  } catch {
    return { title: 'Employee · ACME Salary Management' };
  }
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const db = getDb();
  let employee: Awaited<ReturnType<typeof getEmployee>>;
  try {
    employee = getEmployee(db, Number(id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const history = getCompensationHistory(db, employee.id);

  return (
    <>
      <Link
        href="/employees"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All employees
      </Link>

      <PageHeader
        title={employee.name}
        description={`${employee.jobTitle} · ${employee.department} · ${employee.levelCode}`}
        actions={
          <RaiseDialog
            employeeId={employee.id}
            employeeName={employee.name}
            currency={employee.currency}
            currentSalaryMinor={employee.baseSalaryMinor}
            band={employee.band}
            today={systemClock.today()}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <h2 className="text-sm font-medium text-muted-foreground">Current annual base</h2>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Money
                    minor={employee.baseSalaryMinor}
                    currency={employee.currency}
                    className="text-3xl font-semibold"
                  />
                  {employee.currency !== 'USD' && employee.annualBaseUsdMinor !== null && (
                    <p className="tabular mt-1 text-sm text-muted-foreground">
                      {formatMoney(employee.annualBaseUsdMinor, 'USD', { compactDecimals: true })} at
                      the current FX snapshot
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <BandPositionLabel position={employee.bandPosition} className="justify-end" />
                  {employee.compaRatio !== null && (
                    <p className="tabular mt-1 text-sm text-muted-foreground">
                      compa-ratio {employee.compaRatio.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>

              {employee.band && (
                <div className="mt-5">
                  <BandMeter
                    penetration={employee.rangePenetration}
                    position={employee.bandPosition}
                  />
                  <div className="tabular mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>
                      min {formatMoney(employee.band.minMinor, employee.currency, { compactDecimals: true })}
                    </span>
                    <span>
                      mid {formatMoney(employee.band.midMinor, employee.currency, { compactDecimals: true })}
                    </span>
                    <span>
                      max {formatMoney(employee.band.maxMinor, employee.currency, { compactDecimals: true })}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Band for {employee.levelCode} in {employee.countryName}.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">Salary history</h2>
            </CardHeader>
            <CardContent>
              <CompensationTimeline history={history} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <h2 className="text-base font-semibold">Details</h2>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Detail label="Employee code" value={<span className="tabular">{employee.employeeCode}</span>} />
              <Detail label="Email" value={employee.email} />
              <Detail label="Location" value={`${employee.countryName} (${employee.currency})`} />
              <Detail label="Hire date" value={formatDateLong(employee.hireDate)} />
              <Detail
                label="Employment"
                value={
                  employee.employmentType === 'FULL_TIME' ? 'Full time'
                  : employee.employmentType === 'PART_TIME' ? 'Part time'
                  : 'Contract'
                }
              />
              <Detail
                label="Status"
                value={
                  employee.status === 'ACTIVE' ? (
                    'Active'
                  ) : (
                    <Badge variant="secondary">Left the organisation</Badge>
                  )
                }
              />
              <Detail
                label="Manager"
                value={
                  employee.manager ? (
                    <Link
                      href={`/employees/${employee.manager.id}`}
                      className="underline underline-offset-4"
                    >
                      {employee.manager.firstName} {employee.manager.lastName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No manager on record</span>
                  )
                }
              />
              <Detail
                label="Direct reports"
                value={
                  employee.directReports === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <Link
                      href={`/employees?search=${encodeURIComponent(employee.name)}`}
                      className="tabular underline underline-offset-4"
                    >
                      {employee.directReports}
                    </Link>
                  )
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
