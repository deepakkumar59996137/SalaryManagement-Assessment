import { cn } from '@/lib/utils';

/**
 * Salary distribution as columns.
 *
 * Columns rather than bars because the x-axis is a continuous quantity, and the
 * shape — where the mass sits, how long the right tail is — is the point.
 *
 * Percentile markers ride on top, because a distribution without p50 and p90
 * is a picture rather than an answer.
 */

export interface HistogramBar {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
}

export interface PercentileMarker {
  readonly label: string;
  readonly value: number;
}

interface HistogramProps {
  readonly bars: readonly HistogramBar[];
  readonly markers?: readonly PercentileMarker[];
  readonly formatValue: (value: number) => string;
  readonly emptyMessage?: string;
}

export function Histogram({
  bars,
  markers = [],
  formatValue,
  emptyMessage = 'No data',
}: HistogramProps) {
  if (bars.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const tallest = Math.max(...bars.map((bar) => bar.count), 1);
  const first = bars[0]!.lowerBound;
  const last = bars[bars.length - 1]!.upperBound;
  const span = last - first || 1;

  const positionOf = (value: number) => ((value - first) / span) * 100;

  return (
    <div>
      <div className="relative pt-4">
        {/* 2px surface gaps do the separating between adjacent columns —
            no borders, which would add ink that is not data. */}
        <div className="relative z-10 flex h-44 items-end gap-[2px]">
          {bars.map((bar) => {
            const height = (bar.count / tallest) * 100;

            return (
              <div
                key={bar.lowerBound}
                className="group flex h-full flex-1 items-end"
                title={`${formatValue(bar.lowerBound)} – ${formatValue(bar.upperBound)}: ${bar.count.toLocaleString('en-US')} employees`}
              >
                <div
                  className={cn(
                    'w-full rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80',
                    bar.count === 0 && 'bg-muted',
                  )}
                  style={{ height: `${Math.max(height, bar.count > 0 ? 1.5 : 0.5)}%` }}
                />
              </div>
            );
          })}
        </div>

        {/*
         * Percentile markers ride ABOVE the columns.
         *
         * They were behind them at first, on the reasoning that annotation
         * should never obscure data — but the median sits where the columns
         * are tallest, so the one line most worth seeing was the one always
         * hidden. A translucent rule reads over a bar without erasing it.
         */}
        {markers.map((marker) => {
          const left = positionOf(marker.value);
          if (left < 0 || left > 100) return null;

          return (
            <div
              key={marker.label}
              className="pointer-events-none absolute top-0 bottom-0 z-20 flex flex-col items-center"
              style={{ left: `${left}%` }}
            >
              <span className="rounded-sm bg-background px-1 text-[10px] leading-none font-medium text-muted-foreground">
                {marker.label}
              </span>
              <span className="w-px flex-1 bg-foreground/40" aria-hidden />
            </div>
          );
        })}
      </div>

      <div className="mt-2 h-px bg-chart-grid" aria-hidden />

      <div className="tabular mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{formatValue(first)}</span>
        <span>{formatValue(last)}</span>
      </div>
    </div>
  );
}
