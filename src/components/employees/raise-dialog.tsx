'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Loader2, TrendingUp } from 'lucide-react';
import {
  bandPosition,
  compaRatio,
  CHANGE_REASON_LABELS,
  type ChangeReasonCode,
  rangePenetration,
  SELECTABLE_CHANGE_REASONS,
  type SalaryBand,
} from '@/domain/compensation';
import { type CurrencyCode, formatMoney, formatPercent, minorUnitsPerMajor, percentChange, toMinor } from '@/domain/money';
import { BandMeter, BandPositionLabel } from '@/components/shared/band-position';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface RaiseDialogProps {
  readonly employeeId: number;
  readonly employeeName: string;
  readonly currency: CurrencyCode;
  readonly currentSalaryMinor: number | null;
  readonly band: SalaryBand | null;
  readonly today: string;
}

const QUICK_RAISES = [0.03, 0.05, 0.1] as const;

/**
 * Record a salary change.
 *
 * The preview is the point of the dialog. "Is 92,000 right for this role?" is a
 * question worth answering while the number is being typed, not after it is
 * committed — so the compa-ratio, the band position and the size of the change
 * all update live, using the same pure functions the server will use.
 */
export function RaiseDialog({
  employeeId,
  employeeName,
  currency,
  currentSalaryMinor,
  band,
  today,
}: RaiseDialogProps) {
  const router = useRouter();
  const perMajor = minorUnitsPerMajor(currency);

  const currentMajor = currentSalaryMinor === null ? 0 : currentSalaryMinor / perMajor;

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(currentMajor));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState<ChangeReasonCode>('MERIT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = Number(amount.replace(/,/g, ''));
  const valid = Number.isFinite(parsed) && parsed > 0;
  const proposedMinor = valid ? toMinor(parsed, currency) : null;

  const change =
    proposedMinor !== null && currentSalaryMinor !== null
      ? percentChange(currentSalaryMinor, proposedMinor)
      : null;

  const ratio = proposedMinor !== null && band ? compaRatio(proposedMinor, band) : null;
  const penetration = proposedMinor !== null && band ? rangePenetration(proposedMinor, band) : null;
  const position = proposedMinor !== null && band ? bandPosition(proposedMinor, band) : 'UNKNOWN';

  function applyQuickRaise(fraction: number) {
    if (currentSalaryMinor === null) return;
    // Round to a whole major unit — salaries are quoted in round numbers.
    setAmount(String(Math.round((currentSalaryMinor * (1 + fraction)) / perMajor)));
  }

  function reset() {
    setAmount(String(currentMajor));
    setEffectiveFrom(today);
    setReason('MERIT');
    setNote('');
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/employees/${employeeId}/compensation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseSalaryMajor: parsed,
          effectiveFrom,
          changeReason: reason,
          note: note.trim() || null,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save this change. Please try again.');
        return;
      }

      setOpen(false);
      reset();
      // The timeline, the band figures and the audit log all move together.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={currentSalaryMinor === null}>
          <TrendingUp className="size-4" aria-hidden />
          Change salary
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Change salary</DialogTitle>
            <DialogDescription>
              {employeeName} — currently{' '}
              {currentSalaryMinor === null
                ? 'no salary on record'
                : formatMoney(currentSalaryMinor, currency, { compactDecimals: true })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="amount">New annual base ({currency})</Label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular"
                autoFocus
              />
              <div className="flex gap-1.5">
                {QUICK_RAISES.map((fraction) => (
                  <Button
                    key={fraction}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyQuickRaise(fraction)}
                  >
                    +{Math.round(fraction * 100)}%
                  </Button>
                ))}
              </div>
            </div>

            {band && proposedMinor !== null && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <BandPositionLabel position={position} />
                  {change !== null && (
                    <span
                      className={cn(
                        'tabular font-medium',
                        change > 0 ? 'text-status-good' : change < 0 ? 'text-status-critical' : 'text-muted-foreground',
                      )}
                    >
                      {change > 0 ? '+' : ''}
                      {formatPercent(change)}
                    </span>
                  )}
                </div>

                <BandMeter penetration={penetration} position={position} />

                <div className="tabular mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>{formatMoney(band.minMinor, currency, { compactDecimals: true })}</span>
                  <span>
                    {ratio !== null && `compa-ratio ${ratio.toFixed(2)}`}
                  </span>
                  <span>{formatMoney(band.maxMinor, currency, { compactDecimals: true })}</span>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="effectiveFrom">Effective from</Label>
                <Input
                  id="effectiveFrom"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason</Label>
                <Select value={reason} onValueChange={(value) => setReason(value as ChangeReasonCode)}>
                  <SelectTrigger id="reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTABLE_CHANGE_REASONS.map((code) => (
                      <SelectItem key={code} value={code}>
                        {CHANGE_REASON_LABELS[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <textarea
                id="note"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Context for whoever reads the audit log later"
                className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? 'Saving…' : 'Save change'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
