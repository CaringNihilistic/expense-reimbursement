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

> **On the reversal the brief asks for:** the honest candidate is Decision 5. If sorting by total
> across a paginated list turns out to be awkward or slow enough to matter, the fix is to
> denormalise `total` onto `expense_reports` and maintain it in the one service that touches lines.
> If that happens I will record it here with what actually triggered it, rather than inventing a
> tidier story.

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
