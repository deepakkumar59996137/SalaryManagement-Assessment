# How AI was used

The brief asks for this, and asks that AI be used "intentionally while
maintaining correctness and quality". So this is an honest account of what the
tooling did, what it got wrong, and where the judgment came from — not a list of
prompts that produced a finished product.

**Tool:** Claude Code (Opus), one long session, driving the whole build.

## The shape of the collaboration

The work was structured as **17 milestones, each ending in a commit**, decided
before any code was written. That structure is the single most useful thing
about how this was built: it kept each step small enough to actually review, and
it means the commit history reads as a sequence of decisions rather than a
finished artifact dropped in one go.

Four decisions were settled by asking rather than assuming, because getting them
wrong would have meant rebuilding:

1. **Stack** — Next.js + Node, per the JD.
2. **Database and deployment** — SQLite everywhere, free host.
3. **How far the analytics should go** — full comp analytics, which is what made
   pay equity and band analysis part of the build rather than a stretch goal.
4. **Auth scope** — one real login, not a role matrix.

A fifth question followed once the SQLite-on-a-free-host constraint became
concrete: persistence. Free tiers have ephemeral disks, so the choice was
between paying for a volume, using a hosted SQLite service, or re-seeding on
boot. That tradeoff was surfaced rather than silently resolved.

## Where AI was genuinely good

- **Volume with consistency.** Ten thousand employees with region-matched names,
  a realistic level pyramid, log-normal salary distributions and a planted
  representation gradient — written once, correct, and reproducible.
- **Breadth of test cases.** The edge cases in `tests/unit/dates.test.ts` and
  `tests/unit/csv.test.ts` — a byte-order mark, 29 February plus one year,
  doubled quotes inside a quoted field — are the kind of list that is tedious to
  produce by hand and easy to under-do.
- **Holding a convention across the codebase.** Money as minor units, dates as
  ISO strings, the layering rule, error mapping. Applied consistently in every
  file rather than drifting.
- **Explaining decisions in the code.** The comments say *why*, and the ADRs
  exist, because that was the standard set at the start and applied throughout.

## Where it needed correcting

These are the moments where the output was wrong, and where the fix came from
measuring or checking rather than from generating more:

- **A `.gitignore` rule silently deleted a feature from the repository.** The
  worst one, and it survived seventeen commits. `data/` was written to ignore
  the generated SQLite directory; git matches an unanchored pattern at *any*
  depth, so it also excluded `src/app/(app)/data`, `src/app/api/data` and
  `src/components/data`. The CSV import screen and both its route handlers were
  never committed. Nothing complained: `git add -A` reported success, the commit
  went through, every test passed, and `npm run build` succeeded — all of them
  reading files from the working directory rather than from git. Then the same
  word in `.dockerignore` did it a second time, stripping the files back out of
  the build context *after* the first fix put them into the repo. It surfaced
  only as a 404 on the deployed site.

  The lesson is specific and worth keeping: **a green test suite says nothing
  about what is actually in your repository.** The check that catches this is
  cloning into an empty directory and building there, and it should have run
  before the deployment was called done rather than after a user reported a 404.

- **Performance budgets were invented, not measured.** The first version of
  `scripts/benchmark.ts` asserted 100 ms per analytics aggregate and 300 ms per
  page. Reality was two to three times that. The correct response was not to
  widen the numbers quietly but to investigate — four optimisations measured,
  one taken, the rest written up in [performance.md](performance.md) with what
  they actually bought. **Guessing a number and asserting it is worse than not
  asserting one.**
- **A slow test suite that looked fine.** The seed test took 8.8 s. The cause
  was 130,000 individual `expect()` calls. Aggregating violations and asserting
  once cut it to 2.1 s *and* made failures report every bad row instead of the
  first.
- **A test that passed while the typecheck failed.** `reason = 'MERIT' as const`
  narrowed a parameter to a literal. Vitest does not typecheck, so the suite
  stayed green while `npm run typecheck` did not. Caught by running both.
- **Chart annotation drawn behind the data.** Percentile markers were placed
  behind the histogram columns on the reasonable-sounding principle that
  annotation should not obscure data. But the median sits where the columns are
  tallest, so the most useful line was always invisible. **Only visible in a
  screenshot** — which is why the capture step exists.
- **Card titles that were not headings.** shadcn's `CardTitle` renders a `div`.
  Three headings on the employee detail page were not headings at all. Found by
  a Playwright selector failing, and fixed in the app rather than worked around
  in the test.
- **A test helper with a latent collision.** The fixture's sequence counter was
  incremented inside a default parameter, so it only advanced when the caller
  omitted a name. Every test that supplied one collided on a unique index.

The pattern is consistent: **the generated code was mostly right, and the things
that were wrong were only found by running it** — the benchmark, the typecheck,
the linter, a screenshot, a real browser.

## What was deliberately not delegated

- **The requirements document**, written first, before any code. What to build
  and what to leave out is the judgment the rest depends on.
- **Every "we are not building that" decision.** No payroll processing, no
  approval workflows, no employee create form. Those are in
  [requirements.md](requirements.md) and [tradeoffs.md](tradeoffs.md) with
  reasoning, because an unexplained absence looks like an oversight.
- **The choice to reject an optimisation that worked.** Carrying current salary
  on `employees` gave a measured 1.8× on the analytics. It was not taken. That
  is a judgment about whether a permanent correctness obligation is worth a
  change nobody would notice, and it is the kind of call a tool will not make
  for you.
- **The colour palette was validated, not chosen by eye.** Run through a
  colour-vision checker against this application's actual surfaces, in both
  themes. The result — that three light-mode hues fall below 3:1 contrast —
  is why every chart ships direct labels and a data table.

## Prompts that did the most work

Not verbatim, but these are the instructions that shaped the result:

> Read the assessment. Build the solution incrementally.

Everything followed from taking "incrementally" literally: a plan first, then
seventeen commits, each one a complete step.

> Build the seed so the analytics have something true to say.

This is the prompt that made the difference between a working dashboard and a
useful one. Uniform random salaries would have rendered perfectly and shown
nothing. Planting a representation gradient — and then letting the analytics
*discover* a 10.5% headline gap against a 0.7% like-for-like gap — is what makes
the pay equity screen demonstrate a point rather than display a number.

> Set a performance budget, measure against it, and investigate what you find.

Which produced the one section of the documentation that says "I was wrong about
this, here is what I measured, and here is what I decided not to do."

## The honest summary

AI wrote most of the lines. It did not decide what the product was for, which
sentence in the brief mattered most, what to leave out, or which of two working
implementations to keep. Those decisions are visible in the ADRs, the
requirements document, and the tradeoffs — and they are the parts worth reading.
