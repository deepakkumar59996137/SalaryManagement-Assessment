'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { CHANGE_REASON_LABELS } from '@/domain/compensation';
import { formatDateShort } from '@/domain/dates';
import { type CurrencyCode, formatMoney, formatPercent } from '@/domain/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ImportRow {
  line: number;
  employeeCode: string;
  status: 'OK' | 'ERROR';
  message?: string;
  employeeName?: string;
  currency?: CurrencyCode;
  currentSalaryMinor?: number;
  newSalaryMinor?: number;
  percentChange?: number | null;
  effectiveFrom?: string;
  changeReason?: keyof typeof CHANGE_REASON_LABELS;
}

interface ImportPreview {
  rows: ImportRow[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  payrollDeltaUsdMinor: number;
  canApply: boolean;
  applied?: number;
}

/**
 * Upload, look, then commit.
 *
 * The preview is not a courtesy — it is what makes a bulk salary change safe to
 * do. Before anything is written the HR Manager sees every row, every problem
 * with a line number they can find in their spreadsheet, and the total effect
 * on annual payroll. Applying is all or nothing, so a file with one bad row
 * changes nothing at all.
 */
export function SalaryImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setApplied(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function send(chosen: File, apply: boolean) {
    setBusy(true);
    setError(null);

    try {
      const body = new FormData();
      body.append('file', chosen);

      const response = await fetch(`/api/data/import${apply ? '?apply=1' : ''}`, {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not read that file.');
        // A rejected apply still carries the per-row detail worth showing.
        if (Array.isArray(payload?.error?.details)) {
          setPreview({
            rows: payload.error.details,
            totalRows: payload.error.details.length,
            validRows: 0,
            errorRows: payload.error.details.length,
            payrollDeltaUsdMinor: 0,
            canApply: false,
          });
        }
        return;
      }

      if (apply) {
        setApplied(payload);
        setPreview(null);
        // The dashboard, the directory and the audit log all move together.
        router.refresh();
      } else {
        setPreview(payload);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function onChoose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setApplied(null);
    setPreview(null);
    setError(null);
    if (chosen) void send(chosen, false);
  }

  if (applied) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CheckCircle2 className="mx-auto size-8 text-status-good" aria-hidden />
          <p className="mt-3 font-medium">
            {applied.applied} salary {applied.applied === 1 ? 'change' : 'changes'} applied
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual payroll {applied.payrollDeltaUsdMinor >= 0 ? 'up' : 'down'}{' '}
            {formatMoney(Math.abs(applied.payrollDeltaUsdMinor), 'USD', { compactDecimals: true })}.
            Every change is in the audit log.
          </p>
          <Button variant="outline" className="mt-4" onClick={reset}>
            Import another file
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <h2 className="text-base font-semibold">Import salary changes</h2>
        <p className="text-sm text-muted-foreground">
          Upload a CSV to review it. Nothing is written until you confirm, and a file with any
          problem is not applied at all.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-muted/40',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onChoose}
            className="sr-only"
            disabled={busy}
          />
          {busy && !preview ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <FileUp className="size-6 text-muted-foreground" aria-hidden />
          )}
          <span className="mt-2 text-sm font-medium">
            {file ? file.name : 'Choose a CSV file'}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            employee_code, new_salary, effective_from, change_reason, note
          </span>
        </label>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {preview && preview.totalRows > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-center">
              <Figure label="Rows" value={preview.totalRows.toLocaleString('en-US')} />
              <Figure
                label="Problems"
                value={preview.errorRows.toLocaleString('en-US')}
                tone={preview.errorRows > 0 ? 'serious' : 'neutral'}
              />
              <Figure
                label="Payroll change"
                value={`${preview.payrollDeltaUsdMinor >= 0 ? '+' : '−'}${formatMoney(Math.abs(preview.payrollDeltaUsdMinor), 'USD', { compactDecimals: true })}`}
              />
            </div>

            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Line</th>
                    <th scope="col" className="px-3 py-2 font-medium">Employee</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
                    <th scope="col" className="px-3 py-2 font-medium">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line} className="border-b last:border-0">
                      <td className="tabular px-3 py-2 text-muted-foreground">{row.line}</td>

                      <td className="px-3 py-2">
                        <span className="font-medium">{row.employeeName ?? row.employeeCode}</span>
                        {row.status === 'ERROR' && (
                          <span className="flex items-start gap-1.5 text-xs text-status-serious">
                            <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {row.message}
                          </span>
                        )}
                      </td>

                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {row.status === 'OK' && row.currency && row.newSalaryMinor !== undefined ? (
                          <>
                            {formatMoney(row.currentSalaryMinor ?? 0, row.currency, { compactDecimals: true })}
                            {' → '}
                            {formatMoney(row.newSalaryMinor, row.currency, { compactDecimals: true })}
                            {row.percentChange !== null && row.percentChange !== undefined && (
                              <span
                                className={cn(
                                  'ml-1.5',
                                  row.percentChange > 0 ? 'text-status-good'
                                  : row.percentChange < 0 ? 'text-status-critical'
                                  : 'text-muted-foreground',
                                )}
                              >
                                {row.percentChange > 0 ? '+' : ''}
                                {formatPercent(row.percentChange)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="tabular px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {row.effectiveFrom ? formatDateShort(row.effectiveFrom) : '—'}
                        {row.changeReason && (
                          <span className="block text-xs">{CHANGE_REASON_LABELS[row.changeReason]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => file && send(file, true)}
                disabled={!preview.canApply || busy || !file}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {busy ? 'Applying…' : `Apply ${preview.validRows} ${preview.validRows === 1 ? 'change' : 'changes'}`}
              </Button>
            </div>

            {!preview.canApply && preview.errorRows > 0 && (
              <p className="text-right text-xs text-muted-foreground">
                Fix the {preview.errorRows} highlighted {preview.errorRows === 1 ? 'row' : 'rows'} and
                upload again. Nothing has been changed.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'neutral' | 'serious';
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold', tone === 'serious' && 'text-status-serious')}>
        {value}
      </p>
    </div>
  );
}
