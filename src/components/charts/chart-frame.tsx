import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Chart chrome: a title that names what is plotted, an optional note that
 * qualifies it, and a table view underneath.
 *
 * The table is not optional decoration. Three of the six categorical hues fall
 * below 3:1 contrast on a white surface, which obliges either visible direct
 * labels or a table view — and a table also serves anyone who cannot read the
 * chart at all. It is a <details> element, so it works with no JavaScript.
 */
export interface TableView {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly React.ReactNode[])[];
}

interface ChartFrameProps {
  readonly title: string;
  readonly description?: string;
  /** Qualifies what the numbers mean — shown under the chart, in small text. */
  readonly footnote?: string;
  readonly table?: TableView;
  readonly className?: string;
  readonly children: React.ReactNode;
}

export function ChartFrame({
  title,
  description,
  footnote,
  table,
  className,
  children,
}: ChartFrameProps) {
  return (
    <Card className={cn('gap-0', className)}>
      <CardHeader className="pb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>

      <CardContent>
        {children}

        {footnote && <p className="mt-4 text-xs text-muted-foreground">{footnote}</p>}

        {table && (
          <details className="group mt-4">
            <summary className="cursor-pointer list-none text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              <span className="group-open:hidden">Show data table</span>
              <span className="hidden group-open:inline">Hide data table</span>
            </summary>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    {table.columns.map((column, index) => (
                      <th
                        key={column}
                        scope="col"
                        className={cn('py-1.5 font-medium', index > 0 && 'text-right')}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b last:border-0">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cn('py-1.5', cellIndex > 0 && 'tabular text-right')}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
