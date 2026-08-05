import { CHANGE_REASON_LABELS } from '@/domain/compensation';
import { formatDateShort } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import type { CompensationHistoryEntry } from '@/server/services/compensation.service';
import { cn } from '@/lib/utils';

/**
 * Salary history as a timeline, newest first.
 *
 * The spreadsheet this replaces overwrote a cell and lost the previous number.
 * This is the screen that makes the difference concrete — every change, when it
 * took effect, how big it was and why.
 */
export function CompensationTimeline({
  history,
}: {
  readonly history: readonly CompensationHistoryEntry[];
}) {
  if (history.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        No salary history on record.
      </p>
    );
  }

  const newestFirst = [...history].reverse();

  return (
    <ol className="relative space-y-0">
      {newestFirst.map((entry, index) => {
        const isLast = index === newestFirst.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Rail connecting the entries, stopping at the earliest one. */}
            {!isLast && (
              <span className="absolute top-3 bottom-0 left-[5px] w-px bg-border" aria-hidden />
            )}

            <span
              className={cn(
                'relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-background',
                entry.isCurrent ? 'bg-foreground' : 'bg-border',
              )}
              aria-hidden
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Money
                  minor={entry.baseSalaryMinor}
                  currency={entry.currency}
                  className="text-base font-semibold"
                />

                {entry.percentChange !== null && entry.changeMinor !== null && (
                  <span
                    className={cn(
                      'tabular text-sm font-medium',
                      entry.changeMinor > 0 ? 'text-status-good'
                      : entry.changeMinor < 0 ? 'text-status-critical'
                      : 'text-muted-foreground',
                    )}
                  >
                    {entry.changeMinor > 0 ? '+' : ''}
                    {formatPercent(entry.percentChange)}
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({entry.changeMinor > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(entry.changeMinor), entry.currency, { compactDecimals: true })})
                    </span>
                  </span>
                )}

                {entry.isCurrent && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    Current
                  </Badge>
                )}
              </div>

              <p className="tabular mt-0.5 text-sm text-muted-foreground">
                {formatDateShort(entry.effectiveFrom)}
                {' – '}
                {entry.effectiveTo ? formatDateShort(entry.effectiveTo) : 'present'}
                <span className="mx-1.5 text-border">·</span>
                {CHANGE_REASON_LABELS[entry.changeReason]}
              </p>

              {entry.note && <p className="mt-1 text-sm text-muted-foreground italic">{entry.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
