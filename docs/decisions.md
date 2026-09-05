# Decisions

Decisions where a real alternative existed and I picked one. Written at the end of the session that
produced them, not reconstructed at the end.

---

## Decision 1 — Next.js full-stack over a split API and SPA

- **Chose:** One Next.js App Router codebase. Server Components read from Postgres during render;
  Server Actions handle mutations. One deployment.
- **Rejected:** A separate backend (FastAPI or Express) with a React SPA in front of it, which is
  the arrangement I have most often seen used for this shape of app.
- **Why:** The split version costs a second deployment, CORS configuration, token handling, and a
  client-side data layer — and every endpoint gets written twice, once as a route and once as a
  typed fetch wrapper. On a twelve-hour budget that is roughly three hours of plumbing that scores
  nothing against the ten goals. It also makes goal 6 easier to get *wrong*: with a JSON API and a
  React table it is tempting to fetch everything and filter in the browser, which the brief
  explicitly forbids. Rendering the list on the server makes doing it correctly the path of least
  resistance.
- **Cost I accepted:** "The server" and "the app" become the same process, so the rule about where
  authorization lives has to be stated and followed deliberately rather than falling out of the
  architecture. That is Decision 2.

---

## Decision 2 — Hand-rolled session auth, and the guard is not in the middleware

- **Chose:** bcryptjs for password hashing, a signed HS256 JWT in an httpOnly cookie via `jose`,
  and `requireUser()` / `requireApprover()` called *inside* every Server Action and data-loading
  function. About eighty lines in `src/lib/auth.ts`.
- **Rejected:** Auth.js / NextAuth with a credentials provider. Also rejected: checking the session
  in `middleware.ts` and trusting it downstream, which is the pattern most Next.js tutorials show.
- **Why:** The brief only asks for email and password, and warns that submitting generated code you
  cannot explain is the most common way to fail. A framework I would have to defend the internals of
  is a worse trade than eighty lines I wrote. More importantly, middleware is the wrong place for
  the check: Next.js middleware has been bypassable with a crafted request header (CVE-2025-29927),
  and Server Actions are public HTTP endpoints anyone can POST to regardless of what the UI renders.
  Middleware here does nothing but redirect logged-out browsers for cosmetic reasons.
- **How I know it works:** a session cookie signed with the wrong secret gets past the middleware
  and is still refused by the page. That is the test that distinguishes a real boundary from a
  decorative one.
- **Also:** `bcryptjs` rather than `bcrypt` because the latter is a native module and its build
  fails on Vercel.

---

## Decision 3 — There is no `rejected` status

- **Chose:** Four stored statuses — `draft`, `submitted`, `approved`, `paid`. Rejection is an
  *event*: it moves the report back to `draft` and writes a permanent `report_events` row carrying
  the reason and the actor. A draft whose most recent event is a rejection renders as "Returned for
  changes".
- **Rejected:** Five statuses including a stored `rejected`.
- **Why:** Goal 4 says a report moves to Approved *or Rejected*, and then says that a rejected
  report "returns to Draft, where its owner can edit it and submit it again". Both cannot be true of
  a stored value at once — if the report is back in Draft, nothing is ever left sitting in Rejected,
  and a status filter for it would always return zero rows. Modelling rejection as an event keeps
  the literal instruction ("returns to Draft") and keeps the rejection permanently visible where
  goal 9 says history must live.
- **What it costs:** "rejected" is not a value in the status filter or the dashboard's status
  breakdown. Both surface "Returned for changes" instead, derived from the latest event.
- **How to reverse it:** add `"rejected"` to `STATUSES` in `src/db/schema.ts` and change one branch
  in `canTransition`. Deliberately kept to a one-line change in case this reading turns out wrong.

---

## Decision 4 — Drizzle over Prisma

- **Chose:** Drizzle ORM over `postgres.js`.
- **Rejected:** Prisma, which has better documentation and a nicer client.
- **Why:** Goal 6 requires sorting a paginated list by **the sum of a relation** — a report's total
  is the sum of its lines, and there is no `total` column (Decision 5). Prisma cannot express an
  `ORDER BY` over an aggregate of a related table; it supports `_count` and nothing else, so that
  requirement would have gone through `$queryRaw` anyway. If the hardest query in the application
  has to be raw SQL regardless, the ORM that makes SQL a first-class citizen is the better fit.
  Drizzle also keeps the schema as plain TypeScript, so the CHECK constraints and the domain
  vocabularies live in the same file as the table definitions.
- **Cost:** a smaller ecosystem, and migrations that need more attention — the append-only trigger
  is a hand-written migration because triggers are outside what Drizzle models.

---

## Decision 5 — The report total is computed, never stored

- **Chose:** No `total` column on `expense_reports`. The total is `sum(expense_lines.amount)`,
  computed in SQL wherever it is needed.
- **Rejected:** A denormalised `total` column maintained by the service that edits lines.
- **Why:** Goal 3 says the total is always the sum of the lines and never a value the client can
  set. With no column to write, that is structurally true rather than a rule someone has to
  remember. It also removes an entire class of bug — a stored total that drifts from its lines.
- **What it costs:** every list that sorts or displays totals has to join a grouped subquery, and
  that is the query most likely to get slow first (see `docs/schema.md`).
- **Later reversed:** _not yet — see below._

> **Session 4 update — this did *not* get reversed, and I am not going to pretend otherwise.**
> Goal 6's sort-by-total is now built, which is the exact pressure I expected to force a `total`
> column. It did not. Sorting by a correlated `sum()` subquery across 33 reports is instant, and
> `count(*) over ()` gives the match total in the same round trip. The cost schema.md predicts is
> real but arrives at a data volume this project does not have, and denormalising now would be
> optimising against a number I have not measured.
>
> What would actually trigger it: the sort-by-total page taking long enough to notice — call it
> 200ms of database time — at which point the fix is a `total` column maintained by the one service
> that edits lines. The reversal the brief asks for turned out to be [Decision
> 10](#decision-10--reversed-reports-stopped-being-my-reports) instead, which is a better example
> because it was forced by a requirement rather than by taste.

---

## Decision 6 — Assignment is routing, not permission

- **Chose:** Any approver may decide any submitted report they do not own. Assignment via
  `report_approvers` drives the "assigned to me" queue and gates who may dismiss a stale alert.
- **Rejected:** Only assigned approvers may approve or reject.
- **Why:** Goal 5 says every approver can see the *full* queue of submitted reports awaiting a
  decision as well as a filtered list of those assigned to them, and goal 10 says an approver can
  dismiss the alert "for a report assigned to them". Read together, assignment looks like a routing
  and visibility concept; if it were a permission gate, showing every approver the full queue would
  be showing them work they cannot do.
- **This is a judgement call, not a certainty.** The other reading is defensible. It is isolated to
  one clause in `canTransition`, so it is cheap to change if a reviewer disagrees.

---

## Decision 7 — Repair the money type at the query boundary, not in the display layer

- **Context:** Decision 5 and the comment on `expense_lines.amount` both promise the same thing —
  money is a `numeric` that arrives in JavaScript as a **string**, and nothing ever calls
  `parseFloat` on it. Session 2 proved that promise was quietly false.

  Drizzle's relational query API (`db.query.expenseReports.findFirst({ with: { lines } })`) does not
  fetch a relation with a second query. It builds one statement that aggregates the nested rows into
  JSON. Postgres serialises `numeric` into a JSON **number**, and `JSON.parse` on the way back hands
  you a float. So `"120.50"` arrived as `120.5` — while TypeScript still typed the field as `string`,
  because Drizzle's `numeric()` column declares string mode and nothing in the type system knows the
  JSON round trip happened. The plain `db.select()` path used by the list query is unaffected; the
  driver returns those untouched.

  I found it because a line rendered as `120.5` in an input instead of `120.50`.

- **Chose:** Restore the string at the boundary — `getOwnReport()` maps the returned lines back to
  `Number(amount).toFixed(2)` — so everything downstream inherits the type the schema advertises.
- **Rejected:** (a) `toFixed(2)` in the display helper only. That fixes the symptom where I happened
  to look and leaves every future consumer of the relational API holding a float — the exact trap I
  just fell into. (b) A custom `numeric` parser on the `postgres` client. This cannot work: by the
  time the driver sees the bytes they are inside a JSON blob, and the value stopped being a
  `numeric` while it was still in Postgres. (c) Abandoning the relational API for hand-written
  joins, which is a large change to buy back something one `map` already buys.
- **What it costs:** a coercion that has to be remembered at each relational read of a money column.
  It is a boundary repair, not a fix — the honest description is a patch over a leaky abstraction.
- **Why it is still safe:** `numeric(12,2)` guarantees the true value has at most two decimals, so
  formatting a single already-rounded value cannot drift. What would not be safe is *summing* floats
  in JavaScript, and nothing does: every total is `sum()` in SQL.
- **The wider lesson:** a type annotation is a claim about runtime, not proof of it. This one was
  wrong for one query path only, and TypeScript reported no error at any point.

---

## Decision 8 — Refusals are values, not exceptions

- **Chose:** `canTransition(report, actor, action)` is a pure function returning a discriminated
  union — `{ ok: true, from, to }` or `{ ok: false, code, message }`. It performs no I/O. Callers
  load the row, ask, and only then write.
- **Rejected:** (a) throwing a `ForbiddenError` from inside the Server Action, which is the more
  usual shape; (b) enforcing the lifecycle in a database trigger.
- **Why not exceptions:** goal 7 requires a bulk action to report *per report* which ones were
  refused and why — naming the ones refused because the approver owned them. An exception unwinds
  the loop it was thrown in; a value can be collected into an array. Bulk approval becomes
  `ids.map(id => canTransition(...))` with nothing new to invent, which is the whole reason the
  workflow engine was built in session 3 rather than alongside session 4.
- **Why not a trigger:** the rules depend on *who is asking*, and a CHECK constraint cannot see the
  actor. A trigger could, by being handed the actor, but its refusal arrives as a Postgres exception
  string — the wrong shape for goal 7's typed per-report codes, and untestable without a database.
- **What purity bought:** 30 tests that run in 5ms with no Postgres, covering every action from
  every status, both roles, ownership, archiving, and the missing-reason case. This is the part of
  the brief where being wrong is expensive, and it is the part that is cheapest to prove right.
- **The cost:** the caller has to remember to ask. Nothing in the type system forces a Server Action
  to consult `canTransition` before writing — the discipline is convention, enforced by the fact
  that all four transitions route through one private `transition()` helper.
- **One thing it caught:** rejection returns a report to draft, and a draft is visible only to its
  owner, so an approver who rejected something could no longer see the page they had just acted on.
  The redirect now asks `canView` where to send them. A rule expressed as a function is a rule you
  can re-ask somewhere else.

---

## Decision 9 — The bulk result travels in the URL, and the page looks nothing up

- **Chose:** a bulk action redirects to `/approvals?result=<base64url JSON>`, and the results panel
  renders *only* what that parameter contains. It performs no database query at all.
- **Rejected:** redirect with a list of report ids and re-query them for their titles. This is the
  obvious design and it is the one I started with.
- **Why I abandoned it:** a bulk *rejection* returns those reports to draft, and a draft is visible
  only to its owner — so by the time the page renders, the approver can no longer read the rows they
  just acted on. Making the results panel work would have meant querying report titles by id while
  bypassing `canView`, on a page whose input is the query string. That is an information leak with
  extra steps: anyone could hand it an id and be told the title of a report they cannot see.
- **Why the URL is safe:** the panel is pure display of its own input, so forging one only fools the
  forger. React escapes the text, `zod` rejects anything that is not the expected shape, and the
  selection is capped at 25 so the parameter cannot grow without bound.
- **What it costs:** the result is a snapshot, not live. Reload after acting on something else and
  the old panel is still there until dismissed. For a transient confirmation that is the right
  trade; for anything durable it would not be.
- **Also rejected:** `useActionState`, which is the idiomatic React answer and would have returned
  the result directly. It requires a client component, and this application has none — every page is
  a Server Component and every mutation a Server Action. One `"use client"` to render a confirmation
  panel is a poor trade for a boundary that is currently absolute and easy to reason about.

---

## Decision 10 — Reversed: `/reports` stopped being "my reports"

- **Originally chose (session 2):** `/reports` is the owner's own list — every report you own, with
  an archived toggle. The navigation called it "My reports" and `listOwnReports()` filtered by
  `owner_id = you` in SQL.
- **Reversed to (session 4):** `/reports` is *the* list, spanning every employee the viewer is
  allowed to see, with owner reduced to one filter among search, status, approver, sort and page.
- **What forced it:** goal 6 asks for "one list [that] shows expense reports across every employee
  the viewer can see". That is not a filter added to an owner-scoped page; it is a different page
  with a different visibility rule. Keeping both would have meant two lists differing only in a
  `where` clause, and a reviewer reasonably asking which one is authoritative.
- **What it cost:** `listOwnReports()` was deleted rather than extended, the navigation label
  changed, and ownership scoping moved from being *structural* — you could only ever query your own
  rows — to being one condition inside a larger query. That is a genuine loss of safety, and it is
  why the visibility clause in `searchReports()` is written to mirror `canView()` exactly and is
  covered by a test that an employee's list contains nothing but their own reports.
- **What I would do differently:** read goal 6 properly before building goal 2's list. The
  information needed to get this right on the first attempt was in the brief the whole time.

---

## Decision 11 — The stale alert has no scheduled job, and no "dismissed" flag

- **Chose:** a dismissal is an *append-only row* in `alert_dismissals` carrying a timestamp. Whether
  an alert is showing is computed at read time: submitted for longer than `STALE_AFTER_DAYS`, and no
  dismissal by this viewer inside the last `ALERT_SNOOZE_DAYS`.
- **Rejected:** a `dismissed_until` column on `expense_reports`, cleared by a nightly job — the
  design most people reach for, and the one the word "returns" in goal 10 seems to invite.
- **Why:** goal 10 says the alert comes back if the report is still undecided N days later. With a
  flag, something has to *un-set* it, which means a scheduler, which means a new failure mode: if
  the job does not run, alerts stay silent and the thing the feature exists to prevent — a report
  quietly rotting in Submitted — happens anyway, invisibly. Deriving the state from two timestamps
  means the alert cannot get stuck, because nothing has to remember to bring it back. It returns
  because the clock moved.
- **How I know it works:** the dismissal row was aged past the snooze window directly in the
  database and the alert reappeared on the very next page load, with nothing scheduled and nothing
  restarted.
- **What it costs:** `alert_dismissals` grows forever, one row per dismissal. At this scale that is
  nothing; if it mattered, old rows are trivially prunable precisely because they are only read
  through a recency window.
- **Also:** dismissals are per approver rather than global. The queue is shared, and one approver
  deciding they have seen something should not blind everyone else to it.

---

## Decision 12 — Dashboard "this week" counts come from the timeline, not the row

- **Chose:** count `report_events` rows with `to_status = 'approved'` (or `'paid'`) since Monday.
- **Rejected:** counting `expense_reports` by `decided_at >= monday` / `paid_at >= monday`, which is
  one table and no join.
- **Why:** the row remembers only its *most recent* transition. A report approved last week and paid
  this week still carries last week's `decided_at`, so "approved this week" would silently omit it —
  and a report can move twice in a week, which the row cannot represent at all. The timeline records
  every transition and cannot be rewritten (goal 9), which makes it the only honest source for a
  question about *when things happened* rather than *what state things are in*.
- **What it costs:** a join, and a dependency on every transition writing its event — which is
  already guaranteed, because the status change and its timeline row commit in one transaction.
