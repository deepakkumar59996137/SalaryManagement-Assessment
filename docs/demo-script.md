# Demo script

A walkthrough in roughly **six minutes**. Every number below is from the seeded
dataset, so the screen will match the script.

**Before recording:** run `npm run seed` so the data is in its canonical state —
the E2E tests and any manual clicking will otherwise have given people raises.
Sign in ahead of time and start on the dashboard.

---

## 1 · The problem, in one sentence (20s)

> ACME's HR team manages salary data for ten thousand employees across ten
> countries in spreadsheets. A spreadsheet has no history, no safe concurrent
> editing, and no way to compare pay across currencies. This replaces it — and
> more importantly, it answers questions a spreadsheet can't.

Don't linger. The screens make the case faster than words do.

## 2 · Dashboard — what does payroll cost? (60s)

Land on **/dashboard**.

- **$713M annual payroll**, 9,620 active employees, 10 countries. Point out that
  every figure is normalised to USD — summing ten currencies is otherwise
  meaningless.
- **Median $60,000 against a mean of $74,066.** Worth saying out loud: the mean
  is dragged by a long tail of senior pay, which is why the median is the
  headline and both are shown.
- **299 paid below band — $1,463,100 a year to fix.** That last figure is the
  point. It turns a compliance risk into a budget line someone can approve.

Scroll to **payroll cost by country**. Click **Show data table**.

> Every chart has this. Three of the palette's colours don't meet contrast
> minimums on white, so no figure is ever locked behind seeing colour.

## 3 · The question the brief actually asks (90s) — *the centrepiece*

Stay on the dashboard, point at **Pay equity**.

- **Unadjusted gap: 10.5%.** This is the number that gets reported publicly.
- **Like for like: 0.7%.**

> Those two numbers describe completely different problems. If I only reported
> the first, the obvious response is to adjust individual women's salaries — and
> that would be the wrong fix, because within any given department and level,
> pay here is within one percent.

Click **See the breakdown by level** → **/analytics#pay-equity**.

Scroll to **Representation by level**:

| Level | Women |
|---|---|
| L1 | 48.1% |
| L2 | 45.6% |
| L3 | 42.4% |
| L4 | 37.1% |
| L5 | 30.5% |
| L6 | 28.8% |

> There it is. Women are nearly half of the junior level and under a third of
> the senior one. The pay gap is a promotion and hiring problem. That is a
> finding, not a number.

Point at the caveat text underneath.

> Cohorts with fewer than three of either gender are excluded — a gap computed
> from two people is noise, and publishing it would identify their salaries. It
> says what coverage that leaves, and how many people a binary comparison can't
> represent at all.

## 4 · Finding the people who need attention (60s)

Go to **/employees?bandPosition=BELOW&sort=compaRatio**.

> Everyone paid below the minimum for their level and country, worst first. This
> is one dropdown. In a spreadsheet it's a morning.

Point out:
- Local salary with the **USD equivalent underneath** — ₹, ¥, £ all readable.
- The **band meter** on each row, with the true compa-ratio beside it.
- The URL. **This view is a link** — filters, sorting and paging all live in the
  query string, so it can be sent to someone.

Click the top row (**Alice Wilson**, compa 0.61).

## 5 · History, and making a change (90s)

On the employee page:

- **The salary timeline.** Every change, when it took effect, how big it was and
  why.

> This is the thing the spreadsheet lost. A cell got overwritten and the previous
> number was gone. Here nothing is ever overwritten — a change closes one dated
> interval and opens the next.

- The **band context**: min, mid, max, and where this person sits.

Click **Change salary**. Click **+10%**.

> The preview updates before anything is saved — the new compa-ratio, the band
> position, the size of the change. "Is this number reasonable?" is answerable
> while typing it, not after committing it. It uses the same functions the
> server will use to store it, so the preview can't disagree with the result.

Set a reason, add a note, **Save**. The timeline updates immediately.

Go to **/audit**.

> Who changed what, when. Append-only. The description is written at the time of
> the change, so it still reads correctly if the employee is later renamed.

## 6 · Getting off spreadsheets (60s)

Go to **/data**.

> They're coming from Excel, and an annual review cycle *is* a spreadsheet. So
> it has to go both ways.

Upload a CSV with one deliberately bad row (e.g. an unknown employee code).

- Every row previewed, **with the line number from their spreadsheet**.
- The **total effect on annual payroll**, across currencies.
- The bad row named, and **Apply disabled**.

> All or nothing. A payroll file applied halfway is worse than one that was
> rejected — some people get their raise, others silently don't, and nobody can
> tell which without reading every row.

Fix the row, re-upload, apply. Optionally show the audit log carrying both the
individual changes and one summary entry.

## 7 · Engineering, briefly (60s)

Don't narrate the whole architecture. Pick three:

> **Money is never a float.** Everything is an integer in minor units. A test
> sums ten thousand salaries and asserts exactness against the float version,
> which drifts.

> **Salary history is effective-dated intervals**, with an invariant — exactly
> one open interval, no overlaps — enforced in a transaction *and* by a partial
> unique index in the database. The tests assert the invariant directly, because
> the dangerous failure isn't "the raise didn't save", it's "the raise saved and
> left two overlapping salaries behind".

> **278 tests in ten seconds**, including integration tests against real
> in-memory SQLite. No mocked database — a migrated in-memory database costs
> about a millisecond, so testing the real engine is cheaper than faking it.

If there's time, `npm run benchmark`:

> Budgets set from measurement, not guesswork. The first version guessed and was
> wrong by a factor of three on the analytics. The write-up says what I measured,
> what I fixed, and — for one optimisation that worked and I still rejected —
> why.

## 8 · Close (20s)

> Deliberately not built: payroll processing, approval workflows, a role matrix,
> employee onboarding. Those are in the requirements document with reasoning,
> because an unexplained absence looks like an oversight and a stated one is a
> decision.

---

## If something goes wrong on camera

- **Data looks off** — the E2E tests give people raises. `npm run seed` restores
  it exactly; the seed is deterministic.
- **The deployed demo is slow to load** — a free host spins down when idle, so
  the first request takes ~30s. Open it once before recording.
- **The deployed demo has lost your edits** — expected. Ephemeral disk; every
  cold start re-seeds. Worth saying on camera, it's a documented tradeoff.

## Numbers worth having memorised

| | |
|---|---|
| Employees / active | 10,000 / 9,620 |
| Countries · currencies | 10 · 10 |
| Annual payroll | $712,503,160 |
| Median · mean | $60,000 · $74,066 |
| Below band · above band | 299 · 573 |
| Cost to lift everyone to band minimum | $1,463,100/yr |
| Unadjusted gap · like-for-like | 10.5% · 0.7% |
| Women at L1 · L6 | 48.1% · 28.8% |
| Tests · runtime | 278 · ~10s |
| Seed time | 4.3s |
