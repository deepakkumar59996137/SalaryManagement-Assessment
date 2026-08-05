import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A single figure with a label, and optionally a qualifier under it.
 *
 * Large standalone numbers use proportional figures, not tabular — tabular
 * gives every digit the width of a zero, which makes a value like 121 look
 * loose at display sizes. Tabular is for columns that have to align.
 */
interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly detail?: React.ReactNode;
  /** Draws the eye to a figure that needs attention. Used sparingly. */
  readonly tone?: 'neutral' | 'good' | 'warning' | 'serious';
  readonly hero?: boolean;
}

const TONES = {
  neutral: '',
  good: 'text-status-good',
  warning: 'text-status-warning',
  serious: 'text-status-serious',
} as const;

export function StatTile({ label, value, detail, tone = 'neutral', hero = false }: StatTileProps) {
  return (
    <Card>
      <CardContent className={cn(hero && 'py-1')}>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 font-semibold tracking-tight',
            hero ? 'text-4xl sm:text-5xl' : 'text-2xl',
            TONES[tone],
          )}
        >
          {value}
        </p>
        {detail && <div className="mt-1 text-sm text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}
