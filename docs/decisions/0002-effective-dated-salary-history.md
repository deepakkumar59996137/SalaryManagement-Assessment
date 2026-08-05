# ADR-0002 — Effective-dated salary history

**Status:** Accepted

## Context

The spreadsheet this replaces has exactly one failure that matters most: **a salary cell is overwritten and the previous value is gone.** There is no way to ask "what was this person paid in 2024?", no way to see the size of their last raise, and no way to reconstruct payroll cost as of a past date.

An HR system also has to handle raises that are agreed in one month and effective in another, and occasionally corrections that are back-dated to a date already past.

## Decision

Model compensation as **effective-dated intervals** rather than a mutable column on `employees`:

```
compensations(employee_id, base_salary_minor, currency, effective_from, effective_to, …)
```

`effective_to IS NULL` means "current". A salary is never updated in place; a change closes the open interval and opens a new one.

**Invariants**, enforced in `compensation.service.ts` inside a single transaction:

1. Every active employee has **exactly one** open interval (`effective_to IS NULL`).
2. Intervals for an employee **never overlap**.
3. Intervals are contiguous — closing a row sets `effective_to = new effective_from − 1 day`, leaving no gaps.

Back-dating is permitted and inserts into the correct position in the timeline, closing and reopening neighbours as needed. A revision effective on the same date as the current open row **replaces** it rather than creating a zero-length interval — otherwise a same-day correction would produce a row that was never true for any length of time.

## Consequences

**Good.** History is free and permanent. "What did we pay in Q3 2024?" is a `WHERE effective_from <= date AND (effective_to IS NULL OR effective_to >= date)` away. Raise sizes and dates are derivable rather than needing separate tracking. Corrections are auditable because the superseded row remains.

**Cost.** Reading "current salary" is no longer a column read — naively it becomes a correlated subquery per employee, which is exactly the wrong shape for a 10,000-row directory. [ADR-0003](0003-denormalised-read-paths.md) addresses this with a denormalised pointer.

**Cost.** The invariants are real logic that can be violated by a careless write. Mitigated by funnelling every compensation mutation through one service method, and by testing the invariant directly — including the two cases most likely to break it, same-day revision and back-dated insertion.

**Rejected alternative.** A `salary` column on `employees` plus a `salary_history` audit table. Simpler to read, but it makes history a side-effect that can drift from the truth, and it cannot represent a future-dated raise at all.
