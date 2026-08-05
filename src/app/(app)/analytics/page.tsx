import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';
import { formatMoney, formatPercent } from '@/domain/money';
import { DimensionFilters } from '@/components/analytics/dimension-filters';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartFrame } from '@/components/charts/chart-frame';
import { Histogram } from '@/components/charts/histogram';
import { StatTile } from '@/components/charts/stat-tile';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getRawDb, getDb } from '@/server/db/client';
import { parse } from '@/server/http/handler';
import {
  type AnalyticsFilters,
  getBreakdowns,
  getDistribution,
  getHeadlineFigures,
  getOutliers,
  getPayEquity,
} from '@/server/services/analytics.service';
import { getFilterOptions } from '@/server/services/employee.service';

export const metadata: Metadata = { title: 'Analytics · ACME Salary Management' };
export const dynamic = 'force-dynamic';

const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const filterSchema = z.object({
  countryCode: z.preprocess(blankToUndefined, z.string().length(2).toUpperCase().optional()),
  departmentId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  jobLevelId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
});

const usd = (minor: number | null, abbreviate = false) =>
  minor === null ? '—' : formatMoney(minor, 'USD', { compactDecimals: true, abbreviate });

const percent = (fraction: number | null) => (fraction === null ? '—' : formatPercent(fraction));

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters: AnalyticsFilters = parse(
    Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
        .filter(([, value]) => typeof value === 'string'),
    ),
    filterSchema,
  );

  const db = getRawDb();
  const headline = getHeadlineFigures(db, filters);
  const distribution = getDistribution(db, filters);
  const breakdowns = getBreakdowns(db, filters);
  const equity = getPayEquity(db, filters);
  const outliers = getOutliers(db, filters, 10);

  const options = getFilterOptions(getDb());

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How the organisation pays people. Every figure is annual base salary, normalised to USD at the current FX snapshot."
      />

      <Suspense fallback={<Skeleton className="mb-6 h-9 w-96" />}>
        <DimensionFilters options={options} />
      </Suspense>

      {headline.headcount === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          No employees match these filters.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Headcount" value={headline.headcount.toLocaleString('en-US')} />
            <StatTile label="Annual payroll" value={usd(headline.totalAnnualUsdMinor, true)} />
            <StatTile label="Median salary" value={usd(headline.medianUsdMinor)} />
            <StatTile
              label="Outside band"
              value={(headline.bands.below + headline.bands.above).toLocaleString('en-US')}
              tone={headline.bands.below > 0 ? 'serious' : 'neutral'}
              detail={`${headline.bands.below} below, ${headline.bands.above} above`}
            />
          </div>

          <ChartFrame
            title="Salary distribution"
            description={`${headline.headcount.toLocaleString('en-US')} employees, from ${usd(distribution.minUsdMinor)} to ${usd(distribution.maxUsdMinor)}.`}
            footnote="Percentiles use linear interpolation, the same method as Excel's PERCENTILE.INC, so these figures match a spreadsheet computed from the same data."
            table={{
              columns: ['Measure', 'Annual base (USD)'],
              rows: [
                ['Lowest', usd(distribution.minUsdMinor)],
                ['25th percentile', usd(distribution.p25UsdMinor)],
                ['Median', usd(distribution.p50UsdMinor)],
                ['Mean', usd(distribution.meanUsdMinor)],
                ['75th percentile', usd(distribution.p75UsdMinor)],
                ['90th percentile', usd(distribution.p90UsdMinor)],
                ['Highest', usd(distribution.maxUsdMinor)],
              ],
            }}
          >
            <Histogram
              bars={distribution.buckets}
              markers={[
                ...(distribution.p25UsdMinor === null ? [] : [{ label: 'p25', value: distribution.p25UsdMinor }]),
                ...(distribution.p50UsdMinor === null ? [] : [{ label: 'p50', value: distribution.p50UsdMinor }]),
                ...(distribution.p90UsdMinor === null ? [] : [{ label: 'p90', value: distribution.p90UsdMinor }]),
              ]}
              formatValue={(value) => usd(value, true)}
            />
          </ChartFrame>

          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownCard
              title="By department"
              rows={breakdowns.department}
              series={1}
            />
            <BreakdownCard title="By level" rows={breakdowns.level} series={2} />
          </div>

          <BreakdownCard title="By country" rows={breakdowns.country} series={3} />

          {/* ---- Pay equity ---- */}
          <section id="pay-equity" className="scroll-mt-20 space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <h2 className="text-base font-semibold">Gender pay gap</h2>
                <p className="text-sm text-muted-foreground">
                  Reported two ways, because the two numbers call for different responses.
                </p>
              </CardHeader>

              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium">Unadjusted</p>
                    <p className="mt-1 text-3xl font-semibold">{percent(equity.unadjusted.medianGap)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Median across everyone. Mean {percent(equity.unadjusted.meanGap)}.
                    </p>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium">Like for like</p>
                    <p className="mt-1 text-3xl font-semibold">
                      {percent(equity.likeForLike.weightedMedianGap)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Within {equity.likeForLike.cohorts.length} department-and-level cohorts,
                      weighted by headcount.
                    </p>
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  A positive figure means men are paid more, following the convention used in
                  statutory reporting. The distance between the two numbers is the finding: an
                  unadjusted gap that narrows sharply under like-for-like comparison is caused by
                  who holds which roles, not by how individual salaries are set — and those two
                  problems have entirely different remedies.
                </p>

                <p className="text-xs text-muted-foreground">
                  Cohorts with fewer than three of either gender are excluded — a gap computed
                  from two people is noise, and publishing one would identify their salaries.
                  This comparison covers {percent(equity.likeForLike.coverage)} of the filtered
                  population.{' '}
                  {equity.notComparedHeadcount > 0 &&
                    `${equity.notComparedHeadcount.toLocaleString('en-US')} employees recorded as another or undisclosed gender are counted in headcount but cannot appear on either side of a binary comparison.`}
                </p>
              </CardContent>
            </Card>

            <ChartFrame
              title="Representation by level"
              description="The share of women at each level — the usual explanation for a wide unadjusted gap."
              table={{
                columns: ['Level', 'Women', 'Men', 'Share women'],
                rows: equity.representation.map((row) => {
                  const total = row.femaleCount + row.maleCount;
                  return [
                    row.levelCode,
                    row.femaleCount.toLocaleString('en-US'),
                    row.maleCount.toLocaleString('en-US'),
                    total === 0 ? '—' : formatPercent(row.femaleCount / total),
                  ];
                }),
              }}
            >
              <BarChart
                series={5}
                data={equity.representation.map((row) => {
                  const total = row.femaleCount + row.maleCount;
                  const share = total === 0 ? 0 : row.femaleCount / total;
                  return {
                    key: row.levelCode,
                    label: row.levelCode,
                    value: share,
                    formattedValue: total === 0 ? '—' : formatPercent(share),
                    detail: `${row.femaleCount} women of ${total}`,
                  };
                })}
              />
            </ChartFrame>

            {equity.likeForLike.cohorts.length > 0 && (
              <Card>
                <CardHeader className="pb-4">
                  <h2 className="text-base font-semibold">Cohorts furthest from parity</h2>
                  <p className="text-sm text-muted-foreground">
                    Where a like-for-like difference actually exists, largest first.
                  </p>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="py-1.5 font-medium">Cohort</th>
                        <th scope="col" className="py-1.5 text-right font-medium">People</th>
                        <th scope="col" className="py-1.5 text-right font-medium">Median gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equity.likeForLike.cohorts.slice(0, 8).map((cohort) => (
                        <tr key={cohort.key} className="border-b last:border-0">
                          <td className="py-1.5">{cohort.key}</td>
                          <td className="tabular py-1.5 text-right">
                            {cohort.headcount.toLocaleString('en-US')}
                          </td>
                          <td className="tabular py-1.5 text-right">{percent(cohort.medianGap)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </section>

          {/* ---- Bands ---- */}
          <section id="bands" className="scroll-mt-20">
            <Card>
              <CardHeader className="pb-4">
                <h2 className="text-base font-semibold">Pay against salary bands</h2>
                <p className="text-sm text-muted-foreground">
                  {headline.bands.within.toLocaleString('en-US')} in band,{' '}
                  {headline.bands.below.toLocaleString('en-US')} below,{' '}
                  {headline.bands.above.toLocaleString('en-US')} above. Lifting everyone below to
                  their band minimum would cost {usd(headline.bands.costToMinimumUsdMinor)} a year.
                </p>
              </CardHeader>

              <CardContent className="grid gap-8 lg:grid-cols-2">
                <OutlierList
                  title="Furthest below band"
                  emptyMessage="Nobody is paid below their band."
                  rows={outliers.below}
                  tone="serious"
                />
                <OutlierList
                  title="Furthest above band"
                  emptyMessage="Nobody is paid above their band."
                  rows={outliers.above}
                  tone="warning"
                />
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}

function BreakdownCard({
  title,
  rows,
  series,
}: {
  readonly title: string;
  readonly rows: readonly {
    key: string;
    label: string;
    headcount: number;
    totalAnnualUsdMinor: number;
    medianUsdMinor: number | null;
  }[];
  readonly series: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <ChartFrame
      title={title}
      description="Total annual cost. Hover a bar for headcount and median."
      table={{
        columns: ['Group', 'Headcount', 'Total cost', 'Median'],
        rows: rows.map((row) => [
          row.label,
          row.headcount.toLocaleString('en-US'),
          usd(row.totalAnnualUsdMinor),
          usd(row.medianUsdMinor),
        ]),
      }}
    >
      <BarChart
        series={series}
        data={rows.map((row) => ({
          key: row.key,
          label: row.label,
          value: row.totalAnnualUsdMinor,
          formattedValue: usd(row.totalAnnualUsdMinor, true),
          detail: `${row.headcount.toLocaleString('en-US')} people, median ${usd(row.medianUsdMinor)}`,
        }))}
      />
    </ChartFrame>
  );
}

function OutlierList({
  title,
  rows,
  tone,
  emptyMessage,
}: {
  readonly title: string;
  readonly rows: readonly {
    id: number;
    name: string;
    jobTitle: string;
    levelCode: string;
    countryName: string;
    compaRatio: number;
  }[];
  readonly tone: 'serious' | 'warning';
  readonly emptyMessage: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>

      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 py-2 first:pt-0">
              <div className="min-w-0">
                <Link
                  href={`/employees/${row.id}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {row.jobTitle} · {row.levelCode} · {row.countryName}
                </p>
              </div>
              <span
                className={`tabular shrink-0 text-sm ${tone === 'serious' ? 'text-status-serious' : 'text-status-warning'}`}
              >
                {row.compaRatio.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
