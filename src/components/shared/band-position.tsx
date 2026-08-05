import { ArrowDown, ArrowUp, Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BandPositionValue = 'BELOW' | 'WITHIN' | 'ABOVE' | 'UNKNOWN';

/**
 * Band position, always as icon + label + colour.
 *
 * Status colours are reserved and never carry meaning alone, so each state
 * ships its own glyph and word. "Within band" is intentionally uncoloured —
 * if the normal case were green, the whole table would be green and the
 * exceptions would stop standing out.
 */
const PRESENTATION = {
  BELOW: {
    label: 'Below band',
    Icon: ArrowDown,
    className: 'text-status-serious',
    // Underpaid is the more urgent finding: it carries retention and, in some
    // jurisdictions, compliance risk. Overpaid is a budgeting question.
    tone: 'serious',
  },
  ABOVE: {
    label: 'Above band',
    Icon: ArrowUp,
    className: 'text-status-warning',
    tone: 'warning',
  },
  WITHIN: {
    label: 'In band',
    Icon: Check,
    className: 'text-muted-foreground',
    tone: 'neutral',
  },
  UNKNOWN: {
    label: 'No band set',
    Icon: Minus,
    className: 'text-muted-foreground',
    tone: 'neutral',
  },
} as const;

export function BandPositionLabel({
  position,
  className,
  iconOnly = false,
}: {
  readonly position: BandPositionValue;
  readonly className?: string;
  readonly iconOnly?: boolean;
}) {
  const { label, Icon, className: tone } = PRESENTATION[position];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', tone, className)}
      title={iconOnly ? label : undefined}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/**
 * Where a salary sits inside its band, as a compact meter.
 *
 * The track is the full band, min to max. The marker is the person. Values
 * outside 0..1 are clamped for drawing only — the label beside it still shows
 * the true compa-ratio, so an extreme outlier is never silently flattened into
 * "at the edge of the band".
 */
export function BandMeter({
  penetration,
  position,
  className,
}: {
  readonly penetration: number | null;
  readonly position: BandPositionValue;
  readonly className?: string;
}) {
  if (penetration === null) {
    return <div className={cn('h-1.5 w-full rounded-full bg-muted', className)} aria-hidden />;
  }

  const clamped = Math.min(1, Math.max(0, penetration));
  const markerColour =
    position === 'BELOW' ? 'bg-status-serious'
    : position === 'ABOVE' ? 'bg-status-warning'
    : 'bg-foreground';

  return (
    <div className={cn('relative h-1.5 w-full rounded-full bg-muted', className)} aria-hidden>
      {/* Midpoint tick — the reference the compa-ratio is measured against. */}
      <span className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-chart-axis" />
      <span
        className={cn('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background', markerColour)}
        style={{ left: `${clamped * 100}%` }}
      />
    </div>
  );
}
