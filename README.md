# Expense Reimbursement

Employees submit expense reports with individual line items, an approver who is not the employee
decides on each one, and finance can see exactly what is owed and to whom at any moment.

**Live:** https://expense-reimbursement-blush.vercel.app — sign in as `meera@northwind.test` with
the password `demo1234`.

Built for Assignment 11; the brief is kept verbatim in [docs/brief.md](docs/brief.md), and
[SUBMISSION.md](SUBMISSION.md) is the submission itself.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript | One deployable. Server Components read, Server Actions mutate, so server-side filtering is the path of least resistance rather than a rule to remember |
| Data access | Drizzle ORM over `postgres.js` | The hardest query sorts by the sum of a relation, which needs SQL to be a first-class citizen |
| Database | PostgreSQL — 18 on Neon in production, 16 in Docker locally | |
| Auth | `bcryptjs` + a signed HS256 JWT in an httpOnly cookie (`jose`) | About eighty lines I can defend, rather than a framework I would have to |
| Tests | Vitest — 66 unit, 7 integration | |

The reasoning behind each is in [docs/decisions.md](docs/decisions.md).

## Running it locally

Requires Node 20+ and Docker (or any PostgreSQL 14+ you point `DATABASE_URL` at).

```bash
npm install
cp .env.example .env.local && cp .env.local .env   # then edit AUTH_SECRET
docker compose up -d                               # Postgres on localhost:5433
npm run db:migrate
npm run db:seed                                    # eight accounts
npm run db:seed:demo                               # eight weeks of realistic history
npm run dev                                        # http://localhost:3000
```

Every demo account uses the password `demo1234`. `sandeep@northwind.test` is an approver who also
submits reports — that account exists to demonstrate that the server refuses to let an approver
decide their own report.

`db:seed:demo` is what makes the dashboard and the alerts worth looking at: it backdates reports,
timelines and payments across eight weeks, because data created "now" produces an empty chart and no
stale alerts. It refuses to run twice, since `report_events` is append-only and re-seeding would
duplicate history rather than replace it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — unit suites always, integration when `DATABASE_URL` is set |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert the eight demo accounts (re-runnable) |
| `npm run db:seed:demo` | Insert eight weeks of realistic reports, lines and timelines |

## How this is verified

Three layers, because they catch different things.

**Unit tests (66).** The rules, as pure functions: `canTransition` and every illegal transition from
every status; CSV quoting and spreadsheet formula injection; the bulk-result encoding; week
bucketing and its zero-fill.

**Integration tests (7).** The queries, against a real PostgreSQL, because visibility is a `where`
clause and a `where` clause cannot be unit tested. They check that an employee's list contains
nobody else's reports, that an approver sees everything except other people's drafts, that a total
does not multiply when several approvers are assigned, and that a dismissed alert returns once the
dismissal ages out. Skipped automatically when `DATABASE_URL` is unset.

**Database constraints (10).** Run them yourself:

```bash
docker compose exec -T db psql -U expense -d expense -f - < scripts/verify-constraints.sql
```

Ten checks inside a transaction that is rolled back, covering the append-only trigger on
`report_events`, the status/role/category vocabularies, positive amounts, forward-running date
ranges, and case-insensitive email uniqueness. They pass against Neon as well as locally, so the
guarantees are known to exist in production and not only in Docker.

## Layout

```
src/
  app/            routes; Server Components read, Server Actions mutate
    reports/      list, detail, create; actions.ts and workflow.ts
    approvals/    queue and bulk decisions
    alerts/       stale-approval alerts (goal 10)
    exports/      the reimbursements-due CSV — the one Route Handler
  components/     nav bar, timeline
  db/             schema.ts (six tables) and the pooled client
  lib/            auth.ts        the security boundary
                  transitions.ts the workflow engine — pure, exhaustively tested
                  reports.ts     reads: search, visibility, timeline
                  dashboard.ts   goal 8 aggregates
                  alerts.ts      goal 10 predicates
                  csv.ts, weeks.ts, bulk-result.ts, format.ts
  middleware.ts   cosmetic redirects only — NOT a security boundary
drizzle/          SQL migrations, including the append-only trigger
scripts/          migrate, seed, seed-demo, constraint verification
docs/             architecture, schema, plan, decisions, ai-prompts
```

## The two things worth knowing before reading the code

**Authorization is not in the middleware.** Next.js middleware has been bypassable with a crafted
request header (CVE-2025-29927), and Server Actions are public HTTP endpoints anyone can POST to
regardless of what the interface renders. So `requireUser()` and `requireApprover()` are called
inside every action and every data-loading function. Hiding a button is not a security control, and
the rules here are tested by replaying real Server Action payloads with the wrong account's cookie.

**One pure function owns the lifecycle.** `canTransition()` in `src/lib/transitions.ts` is the only
thing permitted to authorise a status change. It performs no I/O and returns a verdict rather than
throwing, which is what lets goal 7's bulk action call it in a loop and report per-report refusals
instead of unwinding the batch.

## Deployment

Vercel for the app, Neon for PostgreSQL, both on free tiers.

Use Neon's **pooled** connection string (the host contains `-pooler`); serverless functions open a
connection per invocation and will exhaust a direct one. `src/db/index.ts` sets `prepare: false` for
the same reason — pgbouncer in transaction mode cannot hold server-side prepared statements.

Set `DATABASE_URL` and `AUTH_SECRET` in Vercel **before the first build**, not after.
`src/db/index.ts` throws at import time when `DATABASE_URL` is missing, and Next imports every route
module while collecting page data, so a deploy without them fails the *build* rather than failing at
runtime.

Migrations are not run by the build. Point `DATABASE_URL` at Neon and run them from a workstation:

```bash
DATABASE_URL="<neon pooled url>" npm run db:migrate
DATABASE_URL="<neon pooled url>" npm run db:seed
DATABASE_URL="<neon pooled url>" npm run db:seed:demo
```

Four things learned doing this, recorded because each cost time:

- **Neon's compute sleeps.** The free tier scales to zero, and the first request after an idle period
  can time out rather than merely being slow — the first `db:seed` against Neon died with
  `CONNECT_TIMEOUT` and the identical command succeeded straight after, because the first attempt is
  what woke the compute. Retry once.
- **`channel_binding=require`** in Neon's connection string is fine with `postgres.js`. Worth
  checking rather than assuming, since it is a libpq parameter.
- **Vercel functions default to `iad1`** (us-east-1) while this database is in `us-east-2`, so the
  function region is set to `cle1` (Cleveland, us-east-2) to co-locate them — confirmed by the second
  field of the `x-vercel-id` response header. Rendering is query-heavy: the report detail page runs
  five separate queries, and cross-region each one pays the round trip again. Co-located, that
  five-query page costs no more than the one-query list page.
- **The obvious hostname was taken.** `expense-reimbursement.vercel.app` already belongs to an
  unrelated application, so Vercel assigned a suffixed name. Check what you actually deployed to
  before pointing anyone at a URL.
