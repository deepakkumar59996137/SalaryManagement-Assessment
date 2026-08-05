# ADR-0004 — SQLite with Drizzle ORM

**Status:** Accepted

## Context

The system needs a relational database (specified), holds ~10,000 employees and ~25,000 compensation rows for a single organisation with a handful of concurrent users, and must deploy to a free host. Its most demanding queries are analytical, not transactional: percentiles, histograms, grouped aggregates and pay-gap comparisons.

## Decision

**SQLite** via `better-sqlite3`, with **Drizzle ORM** for schema, migrations and typed queries.

### Why SQLite

At this size the entire database is a few tens of megabytes — smaller than the working set of most caches. `better-sqlite3` runs in-process and synchronously, so there is no network hop, no connection pool and no serialisation cost on any query. The write load is one HR Manager making occasional salary changes, which is nowhere near SQLite's single-writer limit.

It also makes the test suite genuinely fast. An in-memory database with migrations applied is created in a millisecond, so integration tests use a **real** database rather than a mock — which means they test the SQL, which is where the interesting logic lives.

The honest constraint: SQLite means a single node with a local file. That is acceptable precisely because [the requirements state](../requirements.md) this is one organisation, not multi-tenant SaaS. If that assumption changes, this is the decision that gets revisited first.

### Why Drizzle rather than Prisma

Prisma is the more common default and has better-known ergonomics. Drizzle wins here on three specific points:

1. **The analytics need real SQL.** Window functions for percentiles, `FILTER`-style conditional aggregates, grouped statistics. Drizzle's query builder covers most of it and its `sql` template escape hatch covers the rest without leaving type safety behind. Prisma pushes this work into `$queryRaw`, which is a string with no schema awareness.
2. **Synchronous in-process access.** Drizzle wraps `better-sqlite3` directly. Prisma's query engine is a separate binary with an async boundary — which adds deployment weight and removes the fast synchronous test setup that makes the suite quick.
3. **Schema as TypeScript.** The schema is a `.ts` file, so table definitions are importable values. Test fixtures and the seed script reference the same objects the application does, with no codegen step between them.

## Consequences

**Good.** No database server to run locally, in CI, or in production. Integration tests hit a real engine. Analytics are written as the SQL they are, and stay readable.

**Cost.** `better-sqlite3` is a native module, so it needs a build toolchain on the host and must be listed in `serverExternalPackages` so Next.js does not try to bundle it.

**Cost.** No `percentile_cont`. Percentiles are computed with `ROW_NUMBER() OVER (ORDER BY …)` and index selection — slightly more SQL, and worth a comment where it appears.

**Cost.** Drizzle is less widely known than Prisma, so the code carries a small ramp-up cost for a new reader. The query builder reads close enough to SQL that this is mostly offset.

**Migration path.** Drizzle supports PostgreSQL with the same query-builder API. Moving would mean a new schema dialect file and a driver swap, not an application rewrite. The `_minor` integer columns and the window-function SQL both port directly.
