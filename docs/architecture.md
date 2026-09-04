# Architecture

> Written incrementally. Sections are filled in as the pieces they describe get built; anything
> not yet true is marked **(not built yet)** rather than described in advance.

## The moving pieces, and where each runs

There are three, and one of them is a browser.

| Piece | Where it runs | Talks to |
|---|---|---|
| Next.js app (App Router) | Vercel, Node runtime, one serverless function per route | Postgres over TLS |
| PostgreSQL 16 | Neon, pooled endpoint | nothing outward |
| Browser | The user's machine | the app over HTTPS |

There is no separate API service and no client-side data layer. Server Components read directly
from Postgres during render; Server Actions handle every mutation. That is one deployable, no CORS,
no token refresh, and no set of REST endpoints written twice — once as a route and once as a
typed client.

The cost of that choice is that "the server" and "the app" are the same thing, so the discipline
about *where* authorization happens has to be explicit. See below.

### Why the guard is not in the middleware

`src/middleware.ts` exists, and it does exactly one thing: bounce a browser with no session cookie
to `/login` so a logged-out visitor sees a form. It does not verify the cookie's signature and it
grants nothing.

Two reasons it cannot be the security boundary:

1. Next.js middleware has been bypassable with a crafted request header (CVE-2025-29927). Code that
   can be skipped entirely cannot be the thing standing between a user and someone else's data.
2. Server Actions compile to public HTTP endpoints. Anyone can POST to one directly. Whether the
   interface rendered a button is irrelevant.

So `requireUser()` and `requireApprover()` in `src/lib/auth.ts` are called *inside* every Server
Action and every data-loading function. This is what goal 1 means by "enforced on the server, not
just hidden in the interface", and it is verifiable: sending a garbage or wrong-secret session
cookie gets past the middleware and is still refused by the page.

## The request path, end to end

Take the action the whole system exists for: an approver clicks **Approve** on a report — and it
happens to be a report they submitted themselves.

1. The browser POSTs to the Server Action endpoint for `approveReport(reportId)`.
2. The action calls `requireApprover()`. That reads the `session` cookie, verifies the HS256
   signature with `AUTH_SECRET`, and loads the user row from Postgres. A missing, expired, tampered
   or wrongly-signed cookie all resolve the same way: redirect to `/login`.
3. The action loads the report and calls `canTransition(report, actor, "approve")` — a pure
   function with no I/O, and the only thing in the codebase allowed to authorise a status change.
4. Because `report.ownerId === actor.id`, it returns
   `{ ok: false, code: "SELF_APPROVAL", message: "You submitted this report" }`.
5. The action returns that verdict without opening a transaction. **Nothing is written** — no
   status change, and no timeline row.
6. The page re-renders with the message beside the report.

Had the verdict been `ok: true`, step 5 would instead open one transaction and do two writes: the
`UPDATE` on `expense_reports`, and an `INSERT` into the append-only `report_events`. Both or
neither — a status change that is not on the timeline would make goal 9 a lie. Then
`revalidatePath()` re-renders the queue and the alert badge.

The bulk endpoint (goal 7) is this same path in a loop: one `canTransition` call per selected id,
verdicts collected into an array, so the response can name exactly which reports were refused
because the approver owned them.

**(not built yet)** — `canTransition` and the transactional write land in session 3; bulk in
session 4. Steps 1–2 are built and verified.

Steps 1–2 are not theoretical. Signing in as a second employee and POSTing another user's
`updateLine` action directly — the real payload, lifted from their page, replayed with my own
session cookie — returns 404 and changes nothing. No interface was involved, which is the point.

## Where the money lives

There is no `total` column, so a report's total is `sum(expense_lines.amount)` computed in SQL on
every read. Two consequences worth stating, because both are load-bearing:

- **Nothing sums money in JavaScript.** The list view gets its totals from a grouped join; the
  detail view runs one `sum()`. Neither adds anything up in application code.
- **`numeric` does not always survive the trip out of Postgres as a string.** Drizzle's relational
  query API round-trips nested rows through JSON, which turns `numeric` into a float, so
  `getOwnReport()` restores the string at that boundary. See
  [decisions.md](decisions.md#decision-7--repair-the-money-type-at-the-query-boundary-not-in-the-display-layer).

## What I decided not to build

Named here so the omissions read as decisions rather than gaps:

- **Receipt uploads and OCR.** Blob storage, an upload pipeline and an extraction model, worth zero
  against the ten goals.
- **Email and notification delivery.** The dashboard and the alerts area are the replacement for
  the inbox — which is the premise of the brief. Adding email back would be re-creating the problem.
- **Multi-level approval chains.** SAP Concur escalates an undecided report to the approver's
  approver. That needs an org hierarchy the brief never asks for. Goal 10's stale alerts are the
  first two thirds of the same idea without the tree.
- **Multi-currency.** One currency, stored as `numeric(12,2)`. Rates, conversion dates and
  historical restatement are a project of their own.
- **A locked terminal state after Paid.** Real systems freeze paid reports so they cannot be
  edited. Here `paid` is simply terminal in the transition table — no transition leads out of it,
  but nothing extra enforces immutability of the lines.
- **Departments, budgets, per-category policy limits, corporate card reconciliation.** Every
  stretch idea in the brief, untouched, on purpose.
