import { type CurrencyCode, formatMoney, formatPercent } from '@/domain/money';
import { cn } from '@/lib/utils';

interface MoneyProps {
  readonly minor: number | null;
  readonly currency: CurrencyCode;
  readonly compactDecimals?: boolean;
  readonly abbreviate?: boolean;
  readonly className?: string;
}

/**
 * A formatted monetary amount.
 *
 * `tabular` is not decoration: salaries are read down a column, and
 * proportional digits make 100,000 and 199,999 different widths, so the eye
 * cannot compare magnitudes without reading every character.
 */
export function Money({ minor, currency, compactDecimals = true, abbreviate, className }: MoneyProps) {
  if (minor === null) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  return (
    <span className={cn('tabular', className)}>
      {formatMoney(minor, currency, { compactDecimals, abbreviate })}
    </span>
  );
}

/**
 * A local salary with its USD equivalent underneath.
 *
 * Both are shown because both answer a different question: the local figure is
 * what the employee is actually paid and what a country manager recognises;
 * the USD figure is the only one that can be compared across the org.
 */
export function SalaryWithUsd({
  minor,
  currency,
  usdMinor,
}: {
  readonly minor: number | null;
  readonly currency: CurrencyCode;
  readonly usdMinor: number | null;
}) {
  if (minor === null) return <span className="text-muted-foreground">No salary on record</span>;

  return (
    <div className="leading-tight">
      <Money minor={minor} currency={currency} />
      {currency !== 'USD' && usdMinor !== null && (
        <div className="tabular text-xs text-muted-foreground">
          {formatMoney(usdMinor, 'USD', { compactDecimals: true })}
        </div>
      )}
    </div>
  );
}

export function Percent({ fraction, decimals = 1 }: { readonly fraction: number | null; readonly decimals?: number }) {
  if (fraction === null) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular">{formatPercent(fraction, decimals)}</span>;
}
