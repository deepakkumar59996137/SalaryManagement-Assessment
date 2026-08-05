# Tradeoffs

The decisions where a reasonable engineer could have gone the other way, and why
this one went the way it did. Structural decisions with lasting consequences are
in [`decisions/`](decisions/) as ADRs; this is everything else.

## Product

**Analytics over more CRUD.** The brief asks for salary management software and
then, almost in passing, for the ability to "answer questions about how the org
pays people". That second sentence is the one a spreadsheet cannot satisfy, so
the build is weighted towards it: the pay-equity comparison, band outliers and
distribution work got more attention than adding, editing or offboarding
employees. Consequence: **you cannot create an employee in this application.**
The seed does it. That is a genuine gap and a deliberate one — a create form is
a solved problem that demonstrates nothing, and the time went into the screens
that answer questions instead.

**Both gap figures, always together.** The unadjusted gender pay gap is what gets
reported publicly, and on its own it points at the wrong remedy about as often as
the right one. Showing it beside the like-for-like figure costs a second
calculation and some explanatory prose, and turns a number into a finding. The
seeded data makes the point concrete: 10.5% unadjusted, 0.7% within cohorts.

**Cohorts with fewer than three of either gender are excluded.** This lowers
coverage and means the like-for-like figure describes less than the whole
organisation, which the screen states. The alternative — comparing a cohort of
one man and one woman — is both statistically meaningless and a privacy leak,
since anyone who knows the org chart could read two individual salaries off it.

**"In band" is deliberately uncoloured.** The obvious design gives it a green
tick. But most people are in band, so the table would be a wall of green and the
exceptions would stop standing out. Status colour is spent only where something
needs attention.

## Engineering

**Charts hand-built rather than Recharts.** Recharts was in the original
dependency list and was removed. The charts here are bars, columns and one
polyline; rendering them as server HTML and SVG ships no client JavaScript and
gave exact control over the mark specs. The cost is that a genuinely interactive
chart — brushing, zooming, a crosshair that tracks the pointer — would now mean
either writing it or adding the dependency back. For a dashboard that is read
rather than manipulated, that trade is right; for an exploratory analysis tool
it would not be.

**Server components call services directly; the REST API exists alongside.**
Pages could have fetched `/api/employees`, but that would mean the server making
an HTTP request to itself. Instead pages call the service and the API serves
programmatic callers. The risk is drift between the two paths, which is why both
go through the same zod schema and the same service function, and why the API is
covered by its own tests.

**URL as state.** Filters, sorting and pagination all live in the query string
rather than in component state. Every view is therefore a link — "everyone in
Germany paid below band, worst first" can be sent to someone. The cost is a
server round trip per filter change instead of an instant client-side re-render,
which is why the search box debounces. At 18–40 ms a query that trade is
comfortable; it would not be at 500 ms.

**`typedRoutes` turned off.** Next can typecheck route literals, which catches
typos in static links. It cannot check `${pathname}${queryString}`, which is what
almost every navigation in this app is. Keeping it on would have meant an
`as Route` cast at every call site: all of the friction, none of the safety.

**No employee edit, so no stale search index.** Search runs `LIKE` over
concatenated name, code, email and title — 34 ms across ten thousand rows.
A stored, indexed search column would roughly halve that. It was not added
because the win is small against a 250 ms debounce, and because a denormalised
column is a correctness obligation.

## Data and correctness

**Money as integers, everywhere, with no exceptions.** The cost is a format step
on every read and a parse step on every write. The benefit is that a payroll
total always equals the sum of its parts. There is no partial version of this
decision that works.

**FX as a dated snapshot rather than a live API.** Covered in
[ADR-0005](decisions/0005-fx-snapshot-not-live-api.md). Worth repeating here
because it looks like a shortcut and is not: a report that gives a different
answer each time it is run is not a report. Real finance systems quote an
as-of rate for the same reason.

**The payroll trend holds the population fixed.** This system records no
termination date, so it cannot say who was employed in March 2024. Rather than
imply otherwise, the trend moves only salaries and holds today's employees
constant, and the chart says so on its face. The honest alternative is to add a
`termination_date` column and close the compensation interval on departure —
which is the right model and was left out with the rest of the offboarding flow.

**Gender is stored, and only two values can be compared.** Pay-equity analysis
needs it. `OTHER` and `UNDISCLOSED` are counted in headcount and reported as not
comparable rather than folded into one side of a binary comparison, because
folding them in would misstate both groups. The screen says how many people that
is.

## Testing

**Real SQLite in integration tests, no mocks.** An in-memory database with
migrations applied costs about a millisecond, so testing against the real engine
is cheaper than maintaining a fake of it — and it means the SQL is under test,
which is where most of the interesting logic lives.

**Scrypt cost parameters stored in the hash.** Needed for tests to hash at
N=256 while production uses N=16384 (the auth suite went from 4.6 s to 434 ms).
The side benefit is the real one: the work factor can be raised later without
invalidating a single existing password.

**Assertions over 10,000 rows collect violations and assert once.** Calling
`expect()` per row costs six seconds and stops at the first bad row. Collecting
failures and asserting the collection is empty is faster *and* reports every
offender.

**No component tests.** The logic worth testing was pushed into `src/domain` and
the services, both of which are tested directly. Testing that a React component
renders a number it was handed mostly tests React. The Playwright smoke test
covers the wiring end to end instead.

## Deployment

**Free host, ephemeral disk, re-seed on boot.** Chosen deliberately, and the
sharp edge is real: **edits a reviewer makes do not survive a spin-down.** In
exchange the demo costs nothing and every cold start restores a known-good
10,000-employee dataset — which for a demo is arguably a feature. The README
names the one-line change that makes it durable.

**Demo credentials shown on the login screen.** Indefensible for a system
holding real salary data, and necessary for one whose database resets and whose
whole purpose is to be opened by someone who was sent a link. Gated behind
`HIDE_DEMO_CREDENTIALS`, which a real deployment would set.

## What I would do next, in order

1. **Employee create, edit and offboard**, including a termination date — which
   would also make the payroll trend able to answer the question it currently
   sidesteps.
2. **Approval workflow for salary changes**, once there is more than one role to
   route between.
3. **Keyset pagination**, if deep paging turns out to be a real access pattern.
4. **A sweep-line payroll trend** ([performance.md](performance.md)), if the
   analytics page needs to be materially faster.
5. **Postgres**, at the point where a second writer or a second node exists.
