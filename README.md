# ACME Salary Management

Salary management software for a 10,000-employee, multi-country organisation. Built for an **HR Manager** persona to replace spreadsheet-based salary tracking — and, more to the point, to answer questions about how the organisation pays people.

> **Status:** in progress. This README grows with the implementation.

## Documents

Read these in order — they were written before the code, and they explain it.

| Document | What it covers |
|---|---|
| [Requirements](docs/requirements.md) | Goal, scope, features, and what is deliberately excluded and why |
| [Architecture](docs/architecture.md) | System shape, layering rule, data model, diagrams |
| [Decisions](docs/decisions/) | ADRs for the choices that were not obvious |

## Stack

Next.js 16 (App Router, Node runtime) · React 19 · TypeScript · SQLite via `better-sqlite3` · Drizzle ORM · Tailwind 4 + shadcn/ui · Recharts · Vitest · Zod

## Getting started

```bash
npm install
```

```bash
npm run db:migrate && npm run seed
```

```bash
npm run dev
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run seed` | Generate the deterministic 10,000-employee dataset |
| `npm test` | Unit + integration tests |
| `npm run benchmark` | Measure the query timings reported in `docs/performance.md` |

## Repository layout

```
docs/        requirements, architecture, ADRs, tradeoffs, performance, AI usage
src/app/     Next.js routes — UI pages and API route handlers
src/server/  the backend: db · repositories · services · http
src/domain/  pure functions — money, FX, compensation maths, statistics, pay equity
scripts/     seed · boot · benchmark
tests/       unit · integration · e2e
```

The one architectural rule: **no SQL above a repository, no HTTP below a route handler, no I/O inside `domain/`.** [Why](docs/architecture.md#the-layering-rule).
