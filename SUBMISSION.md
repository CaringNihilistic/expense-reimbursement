# Submission

## Links

- **GitHub repository:** _<public repo URL — add after first push>_
- **Live application:** _<deployed URL — add after first deploy>_

## Notes for the reviewer

_To fill in before submitting. If the database sleeps when idle, say so here — Neon's free tier
scales to zero and the first request after a quiet period takes a second or two to wake._

The one thing worth knowing before reading the code: authorization is deliberately **not** in the
Next.js middleware. Middleware here only redirects logged-out browsers to the login page. The real
guard runs inside every Server Action and data-loading function, because Next.js middleware has been
bypassable with a crafted header (CVE-2025-29927) and Server Actions are public HTTP endpoints. A
session cookie signed with the wrong secret gets past the middleware and is still refused by the
page — that is the test that separates a real boundary from a decorative one.

## Demo credentials

Password for every account: `demo1234`

| Role | Email | Password |
|------|-------|----------|
| Approver | `meera@northwind.test` | `demo1234` |
| Approver | `rajat@northwind.test` | `demo1234` |
| Approver who also submits | `sandeep@northwind.test` | `demo1234` |
| Employee | `ayush@northwind.test` | `demo1234` |
| Employee | `neha@northwind.test` | `demo1234` |

`sandeep@northwind.test` exists specifically to demonstrate goals 1 and 7: sign in as Sandeep and
try to approve a report Sandeep submitted. The server refuses it, and a bulk action that includes
one of Sandeep's own reports names that report as refused for exactly that reason while still
approving the rest.

## Stack

| Layer | What you used | Why |
|-------|---------------|-----|
| Frontend | Next.js 15 App Router, React 19, TypeScript | Server Components render the lists, so goal 6's "filter on the server" is the path of least resistance rather than a rule to remember |
| Backend | Next.js Server Actions (same deployment) | One codebase, no CORS, no token handling, no endpoint written twice |
| Database | PostgreSQL 16 via Drizzle ORM | Goal 6 needs `ORDER BY` over the sum of a relation, which Prisma cannot express |
| Hosting | Vercel + Neon, free tiers | _confirm once deployed_ |

Full reasoning in [docs/decisions.md](docs/decisions.md).

## Goal checklist

Mark each honestly. Partial is fine — say what is partial.

| # | Goal | Status | Notes |
|---|------|--------|-------|
| 1 | Accounts and roles | Done | Email/password login, employee and approver roles, guards inside every action rather than in middleware. All three rules are verified by replaying real Server Action payloads with the wrong account's cookie: another employee gets 404 for a report and for a line edit; an employee is refused an approval ("Only an approver can mark a report approved."); and an approver POSTing an approval of **their own** report is refused ("You submitted this report, so it needs a different approver.") with the row unchanged and no timeline event written. |
| 2 | Expense reports | Done | Create with title and date range, edit while draft, archive and restore. Archived reports leave the default list without losing anything — the archived view still shows them. |
| 3 | Expense lines | Done | Date, amount, category from the fixed list, description. Add, edit and remove while the report is a draft. The total is `sum(amount)` in SQL on every read — there is no total column for a client to set. |
| 4 | Report lifecycle with rules | Done | Draft → Submitted → Approved → Paid, with rejection returning the report to Draft carrying its reason. One pure function, `canTransition`, authorises every change; 30 unit tests cover it, including every illegal transition from every status. Refusals are shown as the message the server produced. |
| 5 | Assigned approvers | Done | Owners assign any number of approvers to a draft; `/approvals` shows the full queue and an assigned-to-me filter. Assignment is routing, not permission (Decision 6), so the queue lists the viewer's own reports too — which is what goal 7 needs to demonstrate. |
| 6 | Finding reports | Not done | Session 4 |
| 7 | Acting on many reports at once | Not done | Session 4 |
| 8 | Dashboard | Not done | Session 5 |
| 9 | History you cannot rewrite | Done | Every status change and comment on one timeline, with old → new status, who made it, and the reason on a rejection. Immutability is the database's job, verified at the `psql` prompt: `DELETE`, `UPDATE` and `TRUNCATE` on `report_events` are each refused by the trigger. |
| 10 | Stale-approval alerts | Not done | Session 5 — `alert_dismissals` already in the schema |

## How much time did you actually spend?

_Record per session in [docs/plan.md](docs/plan.md) and total it here._

## What would you do next, with another 12 hours?

_To fill in._

## What are you least happy with in this codebase, and why?

_To fill in._
