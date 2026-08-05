# ADR-0005 — FX as a dated snapshot, not a live API

**Status:** Accepted

## Context

Salaries are held in ~10 currencies. Every cross-country question — total payroll cost, "how does Berlin compare to Bangalore", the global median — requires converting them to a common currency first. Without normalisation, a "total payroll" figure is the sum of unlike things and means nothing.

The obvious implementation is to call a live FX API.

## Decision

Store rates in an **`fx_rates` table with an `as_of` date**, seeded with a fixed snapshot. No network calls at request time.

`domain/fx.ts` is a pure function taking rates as an argument: `convert(amountMinor, from, to, rates)`. It has no knowledge of where the rates came from.

## Consequences

**This is more correct, not merely simpler.** A financial report must be reproducible: running the same payroll report twice must give the same number. With live rates it would not — the total would drift minute by minute, and last month's report could never be regenerated. Real finance systems quote an explicit as-of rate for exactly this reason. The snapshot is the behaviour you would build anyway; skipping the API is a bonus.

**Good.** No network dependency, no API key, no rate limit, no outage that takes analytics down. Tests are deterministic by construction, because there is nothing non-deterministic to control — `domain/fx.ts` taking rates as a parameter means tests pass a fixed table rather than mocking a client.

**Cost.** Rates go stale. For the stated purpose — comparing pay structures and spotting equity issues — this barely matters: a few percent of currency drift does not change whether someone is below their band. It would matter for cash-flow forecasting, which is [out of scope](../requirements.md).

**Cost.** Updating rates is a manual step. Accepted, and given a defined remedy: refreshing `fx_rates` and running `scripts/recompute-usd.ts` rebuilds the denormalised USD amounts ([ADR-0003](0003-denormalised-read-paths.md)).

**Upgrade path.** Because `domain/fx.ts` is pure and rates are a table, adding a scheduled job that inserts a new dated row requires no change to any calling code. The as-of column already models rate history; nothing would need to be restructured.
