/**
 * Calendar dates as ISO `YYYY-MM-DD` strings.
 *
 * Effective dating is central to this system (see ADR-0002), and effective
 * dates are calendar dates, not instants — a raise effective 1 March is
 * effective on 1 March everywhere, not at midnight in one particular city.
 * Using `Date` for these invites a whole class of off-by-one-day bugs where a
 * date shifts backwards for anyone west of UTC.
 *
 * So dates are strings, all arithmetic happens in UTC internally, and the
 * lexicographic order of `YYYY-MM-DD` is also its chronological order — which
 * means SQL can compare and sort them directly with no conversion.
 */

export type IsoDate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  // Rejects 2025-02-30, which matches the pattern but is not a date.
  return toUtcMillis(value) !== null;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new Error(`Not a valid ISO date (YYYY-MM-DD): ${value}`);
  return value;
}

function toUtcMillis(value: IsoDate): number | null {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);

  // Date.UTC rolls overflow forward (Feb 30 becomes Mar 2), so round-trip the
  // components to detect a date that never existed.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return millis;
}

function fromUtcMillis(millis: number): IsoDate {
  return new Date(millis).toISOString().slice(0, 10);
}

const MILLIS_PER_DAY = 86_400_000;

export function addDays(date: IsoDate, days: number): IsoDate {
  const millis = toUtcMillis(assertIsoDate(date));
  if (millis === null) throw new Error(`Not a valid ISO date: ${date}`);
  return fromUtcMillis(millis + days * MILLIS_PER_DAY);
}

export function addYears(date: IsoDate, years: number): IsoDate {
  const millis = toUtcMillis(assertIsoDate(date));
  if (millis === null) throw new Error(`Not a valid ISO date: ${date}`);

  const source = new Date(millis);
  const shifted = new Date(
    Date.UTC(source.getUTCFullYear() + years, source.getUTCMonth(), source.getUTCDate()),
  );

  // 29 February plus one year is 1 March by this arithmetic; clamp it back to
  // 28 February, which is what a person means by "a year later".
  if (shifted.getUTCMonth() !== source.getUTCMonth()) shifted.setUTCDate(0);

  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = toUtcMillis(assertIsoDate(from));
  const end = toUtcMillis(assertIsoDate(to));
  if (start === null || end === null) throw new Error('Not a valid ISO date');
  return Math.round((end - start) / MILLIS_PER_DAY);
}

/** Negative, zero or positive — same contract as an Array#sort comparator. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/**
 * Human-readable form: `2026-03-01` becomes `1 March 2026`.
 *
 * Formatted in UTC and with a pinned locale, so server-rendered and
 * client-rendered output agree and audit summaries do not read differently
 * depending on where the reader is.
 */
export function formatDateLong(date: IsoDate, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${assertIsoDate(date)}T00:00:00Z`));
}

/** Compact form for dense tables: `1 Mar 2026`. */
export function formatDateShort(date: IsoDate, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${assertIsoDate(date)}T00:00:00Z`));
}

/** `YYYY-MM` — the grouping key for monthly trend charts. */
export function monthOf(date: IsoDate): string {
  return assertIsoDate(date).slice(0, 7);
}

/** Start of the calendar year containing `date`. */
export function startOfYear(date: IsoDate): IsoDate {
  return `${assertIsoDate(date).slice(0, 4)}-01-01`;
}

/**
 * A source of "now", injected rather than read from the system clock.
 *
 * Every service that needs the current time takes one of these, so tests pin
 * time to a constant instead of tolerating whatever day they happen to run on.
 *
 * `today` is a calendar date, for effective dating. `now` is an instant, for
 * things where the moment genuinely matters — audit timestamps and session
 * expiry. Keeping both on one interface means a service declares that it
 * depends on the clock at all, whichever kind of time it needs.
 */
export interface Clock {
  today(): IsoDate;
  /** ISO 8601 instant in UTC, e.g. `2026-03-01T09:30:00.000Z`. */
  now(): string;
}

export function fixedClock(date: IsoDate, timeOfDay = '00:00:00.000'): Clock {
  const pinned = assertIsoDate(date);
  return {
    today: () => pinned,
    now: () => `${pinned}T${timeOfDay}Z`,
  };
}

export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString(),
};

/** Add seconds to an ISO 8601 instant. Used for session expiry. */
export function addSeconds(instant: string, seconds: number): string {
  const millis = Date.parse(instant);
  if (Number.isNaN(millis)) throw new Error(`Not a valid ISO instant: ${instant}`);
  return new Date(millis + seconds * 1000).toISOString();
}

/** Whether an effective-dated interval covers a given date. `null` end means open. */
export function intervalCovers(
  from: IsoDate,
  to: IsoDate | null,
  date: IsoDate,
): boolean {
  if (date < from) return false;
  return to === null || date <= to;
}

/** Whether two effective-dated intervals overlap. Used to enforce the ADR-0002 invariant. */
export function intervalsOverlap(
  aFrom: IsoDate,
  aTo: IsoDate | null,
  bFrom: IsoDate,
  bTo: IsoDate | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}
