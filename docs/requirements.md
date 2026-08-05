# Salary Management — Requirements

**Author:** Deepak Kumar · **Status:** Baseline, written before implementation · **Persona:** HR Manager, ACME Corp

## Goal

ACME's HR team manages salary data for **10,000 employees across multiple countries in spreadsheets**. Spreadsheets fail here in three specific ways: there is no history (a cell is overwritten and the previous number is gone), no safe concurrent editing, and no way to compare pay across currencies without hand-built FX tabs that go stale.

Replace them with web software that lets one HR Manager **maintain salary records reliably** and **answer questions about how the organisation pays people** — without exporting anything back to Excel.

Success looks like: the HR Manager can find any employee in under five seconds, record a raise in under thirty, and answer "are we paying people fairly and what does it cost us?" from a screen rather than a pivot table.

## Scope

**The questions the product must answer.** These drove the feature list, not the other way round:

| The HR Manager asks | The product answers with |
|---|---|
| What does payroll cost us? | FX-normalised total annual cost, headcount, average and median — sliced by country, department and level |
| How is pay distributed? | Median, p25/p75/p90 and a histogram, per slice |
| Is anyone paid outside their band? | Compa-ratio and range penetration against per-(level, country) salary bands, with an explicit out-of-band list |
| Do we have a pay equity problem? | Gender pay gap shown **both unadjusted and like-for-like** (same level and department) |
| How has this person been paid over time? | A full compensation timeline per employee |
| Who changed this salary, and when? | An immutable audit log |
| How do I get our existing data in and out? | CSV export, and CSV salary import with a dry-run preview before anything is written |

**Features.** Login (salary data is PII) · employee directory with server-side search, filter, sort and pagination · employee detail with compensation history · record-a-raise flow with effective dating and a reason · analytics dashboard covering the table above · CSV import/export · audit log.

**Cross-cutting requirements.** Money is stored as integers in minor units and never as floating point. Salary changes are effective-dated, so history is preserved and back-dating is possible. Multi-currency amounts are normalised to USD through a dated FX snapshot for comparison. Every mutation writes an audit record.

## Deliberately out of scope

Each of these is a real feature of a mature comp platform. They are excluded because none of them changes whether the HR Manager can answer the questions above, and each would consume time better spent on correctness of the ones that do.

| Excluded | Reasoning |
|---|---|
| **Payroll processing, tax, payslips** | A different product with a different compliance surface (per-country tax law, statutory filings). This system is the source of truth for *what someone is paid*, not the system that pays them. |
| **Approval workflows / comp cycles** | Meaningful only with multiple roles and an org hierarchy to route through. With a single HR Manager persona, an approval step would approve to itself. |
| **Multi-role RBAC and SSO** | One persona is specified. Real login is in scope because salary data is sensitive; a role matrix is not, because there is exactly one role. The schema carries a `role` column so this is additive later. |
| **Live FX API** | A dated snapshot table is deterministic, works offline, and makes tests reproducible. A live rate would make every historical report irreproducible — the wrong tradeoff for financial reporting, where a stated as-of rate is the correct behaviour anyway. |
| **Equity, bonuses, benefits** | Modelled as a single variable-pay field rather than full instruments. Equity in particular needs vesting schedules, grant types and 409A valuations — a large domain that would dominate the build. |
| **Performance reviews, notifications, multi-tenancy** | Adjacent products. No bearing on the stated problem. |
| **Full-text search infrastructure** | At 10,000 rows an indexed scan answers in single-digit milliseconds. FTS5 would be infrastructure with no user-visible benefit at this size. |

## Non-goals worth stating

This is sized for **one organisation of ~10k employees and a handful of concurrent users**, not a multi-tenant SaaS. That assumption is what justifies SQLite, single-process deployment, and synchronous database access. It is written down because it is the assumption most likely to be wrong later, and the one that would most change the architecture if it were.
