import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatDateShort } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartFrame } from '@/components/charts/chart-frame';
import { Histogram } from '@/components/charts/histogram';
import { StatTile } from '@/components/charts/stat-tile';
import { TrendLine } from '@/components/charts/trend-line';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getRawDb } from '@/server/db/client';
import {
  getBreakdowns,
  getDistribution,
  getHeadlineFigures,
  getOutliers,
  getPayEquity,
  getTrend,
} from '@/server/services/analytics.service';

export const metadata: Metadata = { title: 'Dashboard · ACME Salary Management' };
export const dynamic = 'force-dynamic';

const usd = (minor: number | null, abbreviate = false) =>
  minor === null ? '—' : formatMoney(minor, 'USD', { compactDecimals: true, abbreviate });

export default function DashboardPage() {
  const db = getRawDb();

  const headline = getHeadlineFigures(db);
  const distribution = getDistribution(db);
  const breakdowns = getBreakdowns(db);
  const equity = getPayEquity(db);
  const outliers = getOutliers(db, {}, 5);
  const trend = getTrend(db);

  const gapNarrowsUnderCohorts =
    equity.unadjusted.medianGap !== null &&
    equity.likeForLike.weightedMedianGap !== null &&
    equity.unadjusted.medianGap > equity.likeForLike.weightedMedianGap * 2;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${headline.headcount.toLocaleString('en-US')} employees across ${headline.countryCount} countries. All figures are annual base salary, normalised to USD.`}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="md:col-span-2">
          <StatTile
            hero
            label="Annual payroll"
            value={usd(headline.totalAnnualUsdMinor, true)}
            detail={`${usd(headline.totalAnnualUsdMinor)} in total base salary`}
          />
        </div>

        <StatTile
          label="Median salary"
          value={usd(headline.medianUsdMinor)}
          detail={`Mean ${usd(headline.meanUsdMinor)}`}
        />

        <StatTile
          label="Paid below band"
          value={headline.bands.below.toLocaleString('en-US')}
          tone={headline.bands.below > 0 ? 'serious' : 'neutral'}
          detail={`${usd(headline.bands.costToMinimumUsdMinor)} a year to fix`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Payroll cost by country"
          description="Total annual base salary, converted to USD at the current snapshot."
          table={{
            columns: ['Country', 'Headcount', 'Total cost', 'Median'],
            rows: breakdowns.country.map((row) => [
              row.label,
              row.headcount.toLocaleString('en-US'),
              usd(row.totalAnnualUsdMinor),
              usd(row.medianUsdMinor),
            ]),
          }}
        >
          <BarChart
            data={breakdowns.country.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.totalAnnualUsdMinor,
              formattedValue: usd(row.totalAnnualUsdMinor, true),
              detail: `${row.headcount.toLocaleString('en-US')} people, median ${usd(row.medianUsdMinor)}`,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Salary distribution"
          description="Where the organisation's pay actually sits."
          footnote="Percentiles use linear interpolation, matching Excel's PERCENTILE.INC."
          table={{
            columns: ['Measure', 'Annual base (USD)'],
            rows: [
              ['25th percentile', usd(distribution.p25UsdMinor)],
              ['Median', usd(distribution.p50UsdMinor)],
              ['75th percentile', usd(distribution.p75UsdMinor)],
              ['90th percentile', usd(distribution.p90UsdMinor)],
              ['Lowest', usd(distribution.minUsdMinor)],
              ['Highest', usd(distribution.maxUsdMinor)],
            ],
          }}
        >
          <Histogram
            bars={distribution.buckets}
            markers={[
              ...(distribution.p50UsdMinor === null ? [] : [{ label: 'p50', value: distribution.p50UsdMinor }]),
              ...(distribution.p90UsdMinor === null ? [] : [{ label: 'p90', value: distribution.p90UsdMinor }]),
            ]}
            formatValue={(value) => usd(value, true)}
          />
        </ChartFrame>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartFrame
          title="Payroll cost over time"
          description="Annualised base salary of the current workforce, evaluated at each quarter."
          footnote="The population is held fixed at today's employees and only their salaries move, so joiners and leavers do not distort the line. This system records no termination date, so it cannot reconstruct historical headcount."
          table={{
            columns: ['Quarter', 'People', 'Annual cost'],
            rows: trend.map((point) => [
              formatDateShort(point.asOf),
              point.headcount.toLocaleString('en-US'),
              usd(point.totalAnnualUsdMinor),
            ]),
          }}
        >
          <TrendLine
            data={trend.map((point) => ({
              label: formatDateShort(point.asOf),
              value: point.totalAnnualUsdMinor,
              tooltip: `${formatDateShort(point.asOf)}: ${usd(point.totalAnnualUsdMinor)} across ${point.headcount.toLocaleString('en-US')} people`,
            }))}
            formatValue={(value) => usd(value, true)}
          />
        </ChartFrame>

        <Card>
          <CardHeader className="pb-4">
            <h2 className="text-base font-semibold">Pay equity</h2>
            <p className="text-sm text-muted-foreground">
              The headline gap, and the gap that remains once like is compared with like.
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Unadjusted</p>
                <p className="mt-0.5 text-2xl font-semibold">
                  {equity.unadjusted.medianGap === null ? '—' : formatPercent(equity.unadjusted.medianGap)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Like for like</p>
                <p className="mt-0.5 text-2xl font-semibold">
                  {equity.likeForLike.weightedMedianGap === null
                    ? '—'
                    : formatPercent(equity.likeForLike.weightedMedianGap)}
                </p>
              </div>
            </div>

            {gapNarrowsUnderCohorts && (
              <p className="rounded-md bg-muted/60 p-3 text-sm leading-relaxed">
                The headline gap largely disappears when people at the same level in the same
                department are compared. That points at representation — who holds the senior
                roles — rather than at how individual salaries are set.
              </p>
            )}

            <Link
              href="/analytics#pay-equity"
              className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              See the breakdown by level
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      </div>

      {outliers.below.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="pb-4">
            <h2 className="text-base font-semibold">Furthest below band</h2>
            <p className="text-sm text-muted-foreground">
              {headline.bands.below.toLocaleString('en-US')} people are paid under the minimum for
              their level and country.
            </p>
          </CardHeader>

          <CardContent>
            <ul className="divide-y">
              {outliers.below.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-2 first:pt-0">
                  <div className="min-w-0">
                    <Link
                      href={`/employees/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.jobTitle} · {row.levelCode} · {row.countryName}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm text-status-serious">
                    compa {row.compaRatio.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href="/employees?bandPosition=BELOW&sort=compaRatio"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              See all {headline.bands.below.toLocaleString('en-US')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      )}
    </>
  );
}
