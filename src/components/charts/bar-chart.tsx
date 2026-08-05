import { cn } from '@/lib/utils';

/**
 * Horizontal bars for comparing magnitude across a named set — cost by country,
 * headcount by department.
 *
 * Horizontal rather than vertical because the categories are words: country and
 * department names read straight across, where a column chart would need them
 * rotated or truncated.
 *
 * One series, so no legend — the chart's title says what is plotted. Every bar
 * carries its value at the tip, which is also what satisfies the relief rule
 * for the lighter hues in the palette.
 */

export interface BarDatum {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Rendered at the bar's tip. */
  readonly formattedValue: string;
  /** Extra context in the hover tooltip. */
  readonly detail?: string;
}

interface BarChartProps {
  readonly data: readonly BarDatum[];
  /** Which categorical slot to paint. Assigned in fixed order, never cycled. */
  readonly series?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly emptyMessage?: string;
}

const SERIES_BACKGROUND = {
  1: 'bg-chart-1',
  2: 'bg-chart-2',
  3: 'bg-chart-3',
  4: 'bg-chart-4',
  5: 'bg-chart-5',
  6: 'bg-chart-6',
} as const;

export function BarChart({ data, series = 1, emptyMessage = 'No data' }: BarChartProps) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  // Scale to the largest bar rather than to the sum: the question is "how do
  // these compare", and a shared maximum makes the comparison direct.
  const largest = Math.max(...data.map((datum) => datum.value), 1);

  return (
    <div className="space-y-2">
      {data.map((datum) => {
        const share = Math.max(0, datum.value / largest);

        return (
          <div key={datum.key} className="grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-3">
            <span className="truncate text-sm text-muted-foreground" title={datum.label}>
              {datum.label}
            </span>

            <div
              className="flex items-center gap-2"
              title={datum.detail ? `${datum.label}: ${datum.formattedValue} — ${datum.detail}` : `${datum.label}: ${datum.formattedValue}`}
            >
              {/* Bars are capped in thickness and rounded only at the data end;
                  the baseline stays square so every bar starts from one line. */}
              <div className="h-4 min-w-0 flex-1">
                <div
                  className={cn('h-full rounded-r-[4px] transition-all', SERIES_BACKGROUND[series])}
                  style={{ width: `${Math.max(share * 100, share > 0 ? 0.5 : 0)}%` }}
                />
              </div>

              <span className="tabular w-24 shrink-0 text-right text-sm">{datum.formattedValue}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
