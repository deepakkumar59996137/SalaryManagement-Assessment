import { describe, expect, it } from 'vitest';
import {
  addDays,
  addYears,
  compareDates,
  daysBetween,
  fixedClock,
  intervalCovers,
  intervalsOverlap,
  isIsoDate,
  maxDate,
  minDate,
  monthOf,
  startOfQuarter,
  startOfYear,
} from '@/domain/dates';

describe('isIsoDate', () => {
  it('accepts a well-formed calendar date', () => {
    expect(isIsoDate('2026-03-01')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects a date that matches the shape but never existed', () => {
    expect(isIsoDate('2025-02-30')).toBe(false);
    expect(isIsoDate('2025-13-01')).toBe(false);
    expect(isIsoDate('2023-02-29')).toBe(false);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(isIsoDate('1 March 2026')).toBe(false);
    expect(isIsoDate('2026-3-1')).toBe(false);
    expect(isIsoDate('2026-03-01T00:00:00Z')).toBe(false);
  });
});

describe('addDays', () => {
  it('steps across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('steps backwards', () => {
    // The exact operation used to close an effective-dated interval.
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows which years are leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('does not drift for a machine in a timezone behind UTC', () => {
    // The bug this module exists to prevent: a date shifting back a day.
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
    expect(addDays('2026-06-15', 365)).toBe('2027-06-15');
  });
});

describe('addYears', () => {
  it('keeps the same day of the year', () => {
    expect(addYears('2026-06-15', 2)).toBe('2028-06-15');
    expect(addYears('2026-06-15', -1)).toBe('2025-06-15');
  });

  it('clamps 29 February back to 28 February in a non-leap year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed by direction', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('spans a leap day correctly', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });
});

describe('ordering helpers', () => {
  it('sorts lexicographically, which is also chronologically', () => {
    const dates = ['2026-03-01', '2025-12-31', '2026-01-15'];
    expect([...dates].sort(compareDates)).toEqual(['2025-12-31', '2026-01-15', '2026-03-01']);
  });

  it('picks the earlier and later of two dates', () => {
    expect(minDate('2026-03-01', '2025-12-31')).toBe('2025-12-31');
    expect(maxDate('2026-03-01', '2025-12-31')).toBe('2026-03-01');
  });
});

describe('grouping helpers', () => {
  it('derives the month key used by trend charts', () => {
    expect(monthOf('2026-03-17')).toBe('2026-03');
  });

  it('derives the start of the year', () => {
    expect(startOfYear('2026-03-17')).toBe('2026-01-01');
  });
});

describe('fixedClock', () => {
  it('pins today, so tests do not depend on the day they run', () => {
    expect(fixedClock('2026-06-01').today()).toBe('2026-06-01');
  });
});

describe('intervalCovers', () => {
  it('includes both endpoints of a closed interval', () => {
    expect(intervalCovers('2026-01-01', '2026-06-30', '2026-01-01')).toBe(true);
    expect(intervalCovers('2026-01-01', '2026-06-30', '2026-06-30')).toBe(true);
    expect(intervalCovers('2026-01-01', '2026-06-30', '2026-07-01')).toBe(false);
  });

  it('treats a null end as still current', () => {
    expect(intervalCovers('2026-01-01', null, '2099-01-01')).toBe(true);
    expect(intervalCovers('2026-01-01', null, '2025-12-31')).toBe(false);
  });
});

describe('intervalsOverlap', () => {
  it('sees no overlap between adjacent intervals', () => {
    // Exactly how a salary revision closes the previous row.
    expect(intervalsOverlap('2026-01-01', '2026-02-28', '2026-03-01', null)).toBe(false);
  });

  it('sees an overlap when they share even one day', () => {
    expect(intervalsOverlap('2026-01-01', '2026-03-01', '2026-03-01', null)).toBe(true);
  });

  it('sees an overlap when an open interval swallows a later one', () => {
    expect(intervalsOverlap('2026-01-01', null, '2027-01-01', '2027-06-30')).toBe(true);
  });
});

describe('startOfQuarter', () => {
  it('snaps back to the first day of the containing quarter', () => {
    expect(startOfQuarter('2026-01-01')).toBe('2026-01-01');
    expect(startOfQuarter('2026-02-14')).toBe('2026-01-01');
    expect(startOfQuarter('2026-06-01')).toBe('2026-04-01');
    expect(startOfQuarter('2026-09-30')).toBe('2026-07-01');
    expect(startOfQuarter('2026-12-31')).toBe('2026-10-01');
  });
});
