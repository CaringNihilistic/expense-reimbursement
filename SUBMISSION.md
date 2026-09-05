# Submission — Expense Reimbursement

| | |
|---|---|
| **Repository** | https://github.com/CaringNihilistic/expense-reimbursement |
| **Live application** | https://expense-reimbursement-blush.vercel.app |
| **Stack** | Next.js 15 (App Router) · TypeScript · Drizzle ORM · PostgreSQL 18 (Neon) · Vercel |
| **Goals met** | 10 of 10 |
| **Tests** | 73 — 66 unit, 7 integration against a real database |

---

## Demo credentials

Password for every account: **`demo1234`**

| Role | Email | Why this account exists |
|---|---|---|
| Approver | `meera@northwind.test` | Decides most reports; assigned to several |
| Approver | `rajat@northwind.test` | A second approver, so dismissals and queues can be seen to be per-person |
| Approver **who also submits** | `sandeep@northwind.test` | The segregation-of-duties demo — see below |
| Employee | `ayush@northwind.test` | Has a report that was rejected and resubmitted |
| Employee | `neha@northwind.test` | Owns the reimbursement currently owed |
| Employee | `tomas@`, `grace@`, `wei@` | Give the queue, the alerts and the eight-week chart something real |

## Two things to know before reading the code

**Authorization is deliberately not in the middleware.** `src/middleware.ts` only redirects
logged-out browsers to the login page. The real guard — `requireUser()` / `requireApprover()` — runs
*inside* every Server Action and data-loading function, because Next.js middleware has been
bypassable with a crafted header (CVE-2025-29927) and Server Actions are public HTTP endpoints that
anyone can POST to regardless of what the interface renders.

**The database sleeps.** Neon's free tier scales its compute to zero when idle, so the first request
after a quiet period pays a cold start and can occasionally time out rather than merely being slow.
Please retry once — it is not a broken deployment. I hit it myself while seeding: the first
`db:seed` against Neon died with `CONNECT_TIMEOUT` and the identical command succeeded straight
afterwards, because the first attempt is what woke the compute.

## A five-minute tour of the live site

Sign in as **`meera@northwind.test`** (approver) unless noted.

| Where | What it demonstrates |
|---|---|
| **Dashboard** | Four headline figures, breakdowns by status and category, and reimbursements paid per week for eight weeks — including two deliberately quiet weeks, which appear as zeroes rather than closing up. |
| **Reports** | Goal 6 in one page: title search, filters for status, owner and assigned approver, sorting by submitted date, status or total, and a match count. Everything happens in SQL. Try sorting by **Total amount**. |
| **Approvals** | The queue, plus goal 7's bulk actions. Select several reports and approve them at once. |
| **Alerts** (badge in the nav) | Reports past the staleness threshold. **Kolkata trade fair** is assigned to Meera and can be dismissed; **Analytics platform trial** is not assigned to her, so it cannot. |
| **Export reimbursements due** | Goal 7's CSV — the four reports approved but not yet paid. |
| Sign in as **`ayush@`** → **Mumbai office supplies** | A report returned for changes. The banner carries the approver's reason, and the timeline shows the whole round trip. |
| Sign in as **`sandeep@`** → **Approver's own travel claim** | The segregation-of-duties demo. It sits in his own approval queue, flagged `yours`, with **no Approve button**. |

That missing button proves nothing by itself, so it was tested against the server instead. Lifting
the real `approveReport` payload from Meera's view of that same report and replaying it with
Sandeep's own cookie returns:

```
303 See Other
Location: /reports/…?refused=You%20submitted%20this%20report%2C%20so%20it%20needs%20a%20different%20approver.
```

with the status still `submitted` and no timeline event written. Run against production, not just
locally. The same replay as an employee is refused with *"Only an approver can mark a report
approved."*

## Goal checklist

| # | Goal | Status | Notes |
|---|---|---|---|
| 1 | Accounts and roles | **Done** | Email/password, two roles, guards inside every action rather than in middleware. Verified by replaying real Server Action payloads with the wrong account's cookie: another employee gets 404 for a report and for a line edit; an employee is refused an approval; and an approver approving **their own** report is refused, with the row unchanged and no timeline event written. |
| 2 | Expense reports | **Done** | Title and date range, editable while draft, archive and restore. Archiving removes a report from the default list without destroying anything — the archived view still shows it. |
| 3 | Expense lines | **Done** | Date, amount, fixed-list category, description; add, edit and remove while the report is a draft. The total is `sum(amount)` computed in SQL on every read — there is no `total` column for a client to set. |
| 4 | Report lifecycle with rules | **Done** | Draft → Submitted → Approved → Paid, with rejection returning the report to Draft carrying its reason. One pure function, `canTransition`, authorises every change; 30 tests cover it, including every illegal transition from every status. Refusals surface as the message the server produced. |
| 5 | Assigned approvers | **Done** | Owners assign any number of approvers to a draft; `/approvals` shows the full queue and an assigned-to-me filter. Assignment is routing, not permission ([Decision 6](docs/decisions.md)), so the queue includes the viewer's own reports — which is exactly what goal 7 needs. |
| 6 | Finding reports | **Done** | One list across everyone the viewer may see, with search, three filters, three sorts and pagination reporting the match count. All in one SQL statement; `count(*) over ()` returns the page and the total together. Sorting by status follows the lifecycle, not the alphabet. |
| 7 | Acting on many reports at once | **Done** | Bulk approve and reject, each report checked individually, with a per-report result naming any refused **because the approver owned them** while the rest still go through. Plus the reimbursements-due CSV, guarded by `requireApprover`. |
| 8 | Dashboard | **Done** | Four headline numbers, two breakdowns, and an eight-week chart. The "this week" counts read the append-only timeline rather than `decided_at`/`paid_at`, because a row remembers only its most recent transition ([Decision 12](docs/decisions.md)). Scope follows visibility: approvers see the company, employees see themselves. |
| 9 | History you cannot rewrite | **Done** | Every status change and comment on one timeline, with old → new status, actor and rejection reason. Immutability is the database's job, verified at the `psql` prompt: `DELETE`, `UPDATE` and `TRUNCATE` on `report_events` are each refused by the trigger. |
| 10 | Stale-approval alerts | **Done** | Reports past `STALE_AFTER_DAYS` appear in `/alerts` with a nav count badge. An approver may dismiss one **assigned to them**; dismissals are per person. The alert returns after `ALERT_SNOOZE_DAYS` **with no scheduled job** ([Decision 11](docs/decisions.md)) — proven by ageing a dismissal past the window and watching it reappear. |

## How much time did I actually spend?

About **13 hours**, against a 12-hour budget. Reconstructed from the commit record rather than a
stopwatch, so treat the per-session figures as close rather than exact.

| Session | Planned | Actual | Notes |
|---|---|---|---|
| 1 · Skeleton, schema, auth | 2h 00m | ~2h 00m | On plan. |
| 2 · Reports and lines | 2h 00m | ~2h 30m | Over, and worth it — verification found a money-precision bug the type checker could not see. |
| 3 · Workflow engine | 2h 00m | ~2h 00m | On plan. The pure function was provable without a browser. |
| — · Deployment | not planned | ~1h 00m | Should have been session 1. See below. |
| 4 · Search and bulk | 2h 00m | ~1h 30m | Under, because session 3 had already paid for it. |
| 5 · Dashboard and alerts | 2h 00m | ~2h 00m | On plan. |
| 6 · Seed, hardening, docs | 2h 00m | ~2h 00m | On plan. |

Calendar-wise the work happened across three days — 31 August, 4 September and 5 September 2026 —
which the git history shows.

**The plan's first rule was "deploy on day one", and I broke it by three sessions.** It cost nothing
in the end, but that is luck rather than vindication: the first deploy turned up a taken hostname, a
sleeping database and a region mismatch, and any of those could have been the thing that ate the
last evening. The lesson stands even though the outcome was fine.

## What would I do next, with another 12 hours?

In this order, because this is the order in which they pay:

1. **Receipt attachments (~4h).** The scenario the brief describes is people emailing *photos of
   receipts*, and right now an approver decides without ever seeing one. Every other feature is
   built; this is the one that would change whether the system could actually replace the email
   thread. Blob storage, an upload on the line editor, a thumbnail on the timeline. I left it out on
   purpose — it scores nothing against the ten goals — but it is the first real gap.
2. **Store money as integer minor units (~2h).** The single change that would delete a whole class
   of bug rather than patch it. See "least happy" below.
3. **Extend integration coverage to the write paths (~2h).** The seven integration tests cover the
   queries; the bulk action, the transactional status change and the CSV export are covered only by
   scripts that are not in the repository. Those are the paths where a bug corrupts data rather than
   merely displaying it wrongly.
4. **Continuous integration (~1h).** 73 tests that nobody runs automatically are 73 tests that will
   eventually be wrong. `npm run typecheck && npm test` on every push, with a Postgres service
   container so the integration suite actually runs.
5. **The performance work `docs/schema.md` predicts (~2h),** but only after measuring: a `pg_trgm`
   index for the title search, keyset pagination instead of `OFFSET`, and the denormalised `total`
   column if sorting by it ever becomes slow enough to notice. All three are currently
   optimisations against numbers I have not observed, which is why none of them are built.
6. **An accessibility and design pass (~1h).** The interface is deliberately plain. It is keyboard
   navigable and uses real form labels, but it has not been tested with a screen reader.

## What am I least happy with?

**Money is a string held together by a rule I have to remember.**

`expense_lines.amount` is `numeric(12,2)`, and the schema comment states the invariant plainly:
money arrives in JavaScript as a *string*, and nothing ever calls `parseFloat` on it. In session 2 I
found that invariant was quietly false. Drizzle's relational query API fetches nested rows by
aggregating them into JSON *inside Postgres*, and `numeric` serialises into a JSON **number** — so
`"120.50"` arrived as `120.5`, while TypeScript still cheerfully reported `string`.

The fix ([Decision 7](docs/decisions.md)) restores the string at that one boundary. It works, it is
tested, and it is a patch. Every future relational read of a money column has to remember to do the
same thing, and nothing in the type system will complain if one forgets — because the type was never
what made it true.

The change I would actually make is to **store money as an integer number of minor units**. A
`bigint` of paise cannot be silently coerced into a lossy float by a JSON round trip, `sum()` stays
exact, and the invariant stops depending on anyone's memory. I did not do it during the assignment
because it touches the schema, a migration, every query and every display path, and the existing
patch is correct — but "correct and fragile" is a worse place to be than "correct by construction",
and I would rather be honest that this is the compromise I like least.

**Runner-up:** verification depth is uneven. The 73 committed tests cover the pure logic and the
riskiest queries, but the end-to-end runs that actually caught most of the bugs — the browser
scripts that drove submit → reject → resubmit → approve → pay, and the `curl` replays of Server
Action payloads — live outside the repository. They were the most valuable tool I had, and a
reviewer cannot re-run them. That is the gap items 3 and 4 above would close.

---

Full reasoning for every design choice is in [docs/decisions.md](docs/decisions.md); the prompts I
used, including the ones that produced something wrong, are in [docs/ai-prompts.md](docs/ai-prompts.md).
