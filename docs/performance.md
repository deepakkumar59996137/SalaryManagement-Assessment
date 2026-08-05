# Performance

Everything below is measured, not estimated. `npm run benchmark` produces these
numbers; it warms each case five times and then takes thirty samples, because
the first execution of a statement includes SQLite's query planning and Node's
JIT — one-off costs a running server pays once and a benchmark should not
attribute to the query.

Measurements are of the **database work only** — no HTTP, no React rendering —
because that is the part that grows with the number of employees.

## What it does today

Against the seeded dataset: **9,620 active employees, 27,183 compensation rows**,
on a Windows desktop with the dev server stopped.

| Operation | Median | p95 | Budget |
|---|---:|---:|---:|
| Directory page, unfiltered | 18 ms | 24 ms | 60 ms |
| Directory page, filtered by country | 19 ms | 33 ms | 60 ms |
| Directory page, free-text search | 34 ms | 40 ms | 100 ms |
| Directory page, below band by compa-ratio | 42 ms | 112 ms | 120 ms |
| Directory page 350 of 400 | 58 ms | 70 ms | 150 ms |
| Employee detail | 0.9 ms | 4.6 ms | 20 ms |
| Compensation history | 0.3 ms | 1.3 ms | 20 ms |
| Headline figures | 105 ms | 116 ms | 200 ms |
| Distribution + histogram | 49 ms | 58 ms | 120 ms |
| Breakdowns (country, department, level) | 200 ms | 234 ms | 600 ms |
| Pay equity (48 cohorts) | 156 ms | 183 ms | 400 ms |
| Band outliers | 42 ms | 50 ms | 120 ms |
| Payroll trend (17 quarters) | 319 ms | 407 ms | 700 ms |
| **Whole analytics page** | **551 ms** | **586 ms** | 1500 ms |
| Full CSV export (10,000 rows) | 224 ms | 339 ms | 2000 ms |

Also measured: the full seed writes 10,000 employees and 27,183 compensation
rows in **4.3 s**, and the test suite — 232 tests including integration tests
against real in-memory SQLite databases — runs in **~8 s**.

## The budgets are set from measurement

The first version of the benchmark guessed 100 ms for every analytics aggregate
and 300 ms for the page. Measuring showed the aggregates cost two to three times
that. Rather than quietly widen the numbers, the investigation is recorded below.

Budgets now sit at roughly twice the observed median. That headroom is
deliberate: p95 over thirty runs on a desktop swings by a factor of two between
runs, and a budget that changes colour on an idle machine is noise, not a signal.

The directory budgets are the strict ones **because the directory is typed
into**. The analytics budgets are looser because that page is opened, read and
left. A 550 ms server render for a page with eight aggregate views over ten
thousand employees is a reasonable trade; 550 ms between keystrokes would not be.

## What makes the fast paths fast

- **The denormalised current-compensation pointer** ([ADR-0003](decisions/0003-denormalised-read-paths.md)).
  Without it, listing employees with their current salary is a correlated
  subquery per row. With it, the directory is a plain indexed join — 18 ms for
  the unfiltered page.
- **The denormalised USD amount.** Analytics sum and rank one integer column, so
  no aggregate joins to `fx_rates` or multiplies per row.
- **Aggregation in SQL.** No endpoint pulls rows into JavaScript to reduce them.
  The largest result any analytics query returns is one row per country.
- **Server-side pagination** over indexed sorts, always with `employees.id` as
  the final tiebreak so paging cannot repeat or skip a row.
- **A 64 MB page cache** (`PRAGMA cache_size = -64000`). The whole database is
  ~7 MB, so this holds all of it after the first read. Measured below.

## What was tried on the analytics, and what it bought

The analytics aggregates were the only cases meaningfully over the original
guesses. Four changes were measured against a representative breakdown query
(median and total pay per country, ~57 ms before any change):

| Change | Result | Taken? |
|---|---|---|
| Raise page cache from 2 MB to 64 MB | 73 ms → 52 ms (~25%) | **Yes** — one line, no cost |
| Memory-mapped I/O (`mmap_size`) | no consistent improvement | No |
| `MATERIALIZED` hint on the trend CTE | 204 ms → 212 ms | No |
| Covering index on `(effective_from, effective_to, employee_id, usd)` | 225 ms → 233 ms | No |
| Prune trend intervals to the reporting window | 228 ms → 230 ms (kept 19,758 of 27,183 rows) | No |
| Carry current salary on `employees`, removing the join entirely | 57 ms → 32 ms (~1.8×) | **No** — see below |

The last one is the interesting rejection. It works, and it is the same kind of
change ADR-0003 already justifies twice. It was not taken because:

- It buys 1.8× on the *lookup* half of the cost. The remaining time is the
  window-function sort over 9,620 rows, which it does not touch at all.
- It does nothing for the payroll trend — by far the slowest query — because
  that cost is a cross-join between periods and salary intervals, not a lookup.
- The whole analytics page would go from ~550 ms to perhaps ~450 ms.
- It adds a third denormalised column that the seed, the revision service and
  the CSV import must all maintain in step. That is a permanent correctness
  obligation in exchange for a change nobody would notice.

Two denormalisations that remove an algorithmic problem are worth their upkeep.
A third that shaves a fifth off a page nobody types into is not.

## The slowest query, and what would actually fix it

The payroll trend (319 ms) is the single worst case. Its plan is:

```
MATERIALIZE hist
SCAN p
SCAN hist LEFT-JOIN
```

— a cross-join between 17 quarterly periods and ~27,000 salary intervals, about
460,000 comparisons. No index helps, because the inner side is a materialised
temporary result. That is why the three index and pruning attempts above all
came back flat.

If this needed to be fast, the fix is a **sweep line rather than a cross join**:
emit `+salary` at each interval's start and `−salary` the day after its end,
sort those events once, take a running total with a window function, and read
off the value at each period. That is O(n log n) over 54,000 events instead of
O(periods × intervals), and would put it in single-digit milliseconds.

It is not implemented because it is materially harder to read than the current
query, and 319 ms for one chart on one page does not justify that. The
alternative is written down here so the decision is a choice rather than an
oversight.

## Deep pagination

`LIMIT 25 OFFSET 8725` costs 58 ms against 18 ms for the first page, because
SQLite must produce and discard every preceding row. That is inherent to offset
pagination.

It is left as it is because an HR Manager reaches page 350 by scrolling rather
than by filtering, and filtering is both faster and what the screen is designed
around. **Keyset pagination** — `WHERE (last_name, id) > (?, ?)` — would make
every page cost the same as the first, and is the change to make if deep paging
ever becomes a real access pattern. It is not free: it gives up the ability to
jump to an arbitrary page number, which is why it is not the default here.

## Where this stops working

The stated assumption is one organisation of ~10,000 employees and a handful of
concurrent users ([requirements](requirements.md)). That assumption is what
justifies SQLite, a single process and synchronous database access. The things
that would break it, in the order they would bite:

1. **Concurrent writers.** SQLite allows one at a time. Fine for one HR Manager;
   not fine for fifty, or for an automated feed.
2. **Horizontal scaling.** A local database file means one node. The remedy is
   Postgres — the `_minor` integer columns and the window-function SQL both port
   directly, and Drizzle supports it with the same query-builder API.
3. **Analytics at 100,000+ employees.** The aggregates are linear in headcount,
   so ten times the staff is roughly ten times the time. At that size the answer
   is a summary table refreshed on write, not a faster scan.

None of these are near at ten thousand. Writing down where the edge is seemed
more useful than claiming there isn't one.
