/**
 * A single line over time.
 *
 * SVG rather than a charting library: one series, one axis, no interaction
 * beyond point tooltips. Recharts would ship ~100KB of client JavaScript to
 * draw a polyline that the server can render as markup.
 *
 * One axis, always. Headcount and cost are two different scales and would need
 * two — so headcount lives in the tooltip and the table instead of on a second
 * y-axis, which is the single most misleading thing a chart can do.
 */

export interface TrendDatum {
  readonly label: string;
  readonly value: number;
  readonly tooltip: string;
}

interface TrendLineProps {
  readonly data: readonly TrendDatum[];
  readonly formatValue: (value: number) => string;
  readonly emptyMessage?: string;
}

const WIDTH = 720;
const HEIGHT = 180;
const PADDING = { top: 12, right: 8, bottom: 4, left: 8 };

export function TrendLine({ data, formatValue, emptyMessage = 'No data' }: TrendLineProps) {
  if (data.length < 2) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const values = data.map((datum) => datum.value);
  const highest = Math.max(...values);
  // Anchored at zero, so the height of the line is proportional to the amount.
  // Starting the axis part-way up exaggerates a change into a cliff.
  const scaleTop = highest * 1.05 || 1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const pointAt = (index: number, value: number) => ({
    x: PADDING.left + (index / (data.length - 1)) * plotWidth,
    y: PADDING.top + plotHeight - (value / scaleTop) * plotHeight,
  });

  const points = data.map((datum, index) => pointAt(index, datum.value));
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${PADDING.left},${PADDING.top + plotHeight} ${line} ${PADDING.left + plotWidth},${PADDING.top + plotHeight}`;

  const last = points[points.length - 1]!;
  const lastDatum = data[data.length - 1]!;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-44 w-full"
        role="img"
        aria-label={`Payroll cost from ${data[0]!.label} to ${lastDatum.label}, ending at ${formatValue(lastDatum.value)}`}
      >
        {/* A wash, never a saturated block. */}
        <polygon points={area} className="fill-chart-1 opacity-10" />

        <polyline
          points={line}
          fill="none"
          className="stroke-chart-1"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point, index) => (
          <circle
            key={data[index]!.label}
            cx={point.x}
            cy={point.y}
            r={4}
            className="fill-chart-1 stroke-background"
            strokeWidth={2}
          >
            <title>{data[index]!.tooltip}</title>
          </circle>
        ))}

        {/* Only the endpoint is labelled. A value on every point is chaos. */}
        <circle cx={last.x} cy={last.y} r={5} className="fill-chart-1 stroke-background" strokeWidth={2} />
      </svg>

      <div className="mt-1 h-px bg-chart-grid" aria-hidden />

      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{data[0]!.label}</span>
        <span className="tabular font-medium text-foreground">
          {formatValue(lastDatum.value)} at {lastDatum.label}
        </span>
      </div>
    </div>
  );
}
