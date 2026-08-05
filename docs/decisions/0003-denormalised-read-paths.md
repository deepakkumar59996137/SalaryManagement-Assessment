# ADR-0003 — Two deliberate denormalisations

**Status:** Accepted

## Context

[ADR-0002](0002-effective-dated-salary-history.md) makes current salary a derived value, and [ADR-0005](0005-fx-snapshot-not-live-api.md) makes USD comparison require an FX join. Both are correct models, and both put work on the hottest read paths in the application.

The employee directory — the screen the HR Manager lives on — needs current salary for 10,000 employees, filtered, sorted and paginated. Expressed naively that is a correlated subquery per row. Every analytics aggregate needs FX-normalised amounts, which naively is a join to `fx_rates` plus a multiplication inside every `SUM`.

Normalisation is right for the write model. It is wrong for these two reads.

## Decision

Two denormalised values, both maintained **inside the same transaction as the write that invalidates them**:

**1. `employees.current_compensation_id`** — a pointer to the open compensation row. Turns the directory query from a correlated subquery into a plain join.

**2. `compensations.annual_base_usd_minor`** — the annualised USD amount, computed at write time from the FX snapshot. Analytics become pure `SUM()` and window functions over one column, with no join and no per-row arithmetic.

## Consequences

**Good.** The directory query becomes a single indexed join. Analytics aggregates read one integer column, so grouping by country, department or level is a plain `GROUP BY` and percentile selection is a single window function.

**Cost — staleness.** Both values are wrong if something writes to `compensations` without maintaining them. Three mitigations:

1. **One writer.** Every compensation mutation goes through `compensation.service.ts`. Repositories expose no bare insert for this table.
2. **Same transaction.** The pointer update is not an event handler or a trigger; it is a statement in the same transaction, so partial application is impossible.
3. **A recompute path.** `scripts/recompute-usd.ts` rebuilds `annual_base_usd_minor` for every row from the current FX snapshot, so an FX table update has a defined, one-command remedy.

**Cost — a second source of truth for FX.** A historical compensation row keeps the USD value computed at the rate current when it was written. This is deliberate and arguably more correct than recomputing: a 2023 payroll report should use 2023 rates, not today's. The recompute script exists for the case where the snapshot itself was wrong, not for routine rate drift.

**Explicitly not done.** No triggers, no materialised views, no caching layer. Two integer columns maintained by one service is the smallest thing that solves the problem, and it is the kind that stays understandable.
