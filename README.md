# Expense Reimbursement

Employees submit expense reports with individual line items, an approver who is not the employee
decides on each one, and finance can see exactly what is owed and to whom at any moment.

Built for Assignment 11 — the brief is kept verbatim in [docs/brief.md](docs/brief.md).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), TypeScript, React 19 |
| Data access | Drizzle ORM over `postgres.js` |
| Database | PostgreSQL — 18 on Neon in production, 16 in Docker locally |
| Auth | bcryptjs + a signed JWT session cookie (`jose`) |
| Tests | Vitest |

Reasoning for each of these is in [docs/decisions.md](docs/decisions.md).

## Running it locally

Requires Node 20+ and Docker (or any Postgres 14+ you point `DATABASE_URL` at).

```bash
npm install
cp .env.example .env.local && cp .env.local .env   # then edit AUTH_SECRET
docker compose up -d                               # Postgres on localhost:5433
npm run db:migrate
npm run db:seed
npm run dev                                        # http://localhost:3000
```

Every demo account uses the password `demo1234`. `sandeep@northwind.test` is an approver who also
submits reports — that account exists to demonstrate that the server refuses to let an approver
decide their own report.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert demo accounts (re-runnable) |

To confirm the database is enforcing what it claims to:

```bash
docker compose exec -T db psql -U expense -d expense -f - < scripts/verify-constraints.sql
```

Ten checks, run inside a transaction that is rolled back. They cover the append-only trigger on
`report_events`, the status/role/category vocabularies, positive amounts, forward-running date
ranges, and case-insensitive email uniqueness.

## Layout

```
src/
  app/          routes; Server Components read, Server Actions mutate
  components/   nav bar, timeline
  db/           schema.ts (six tables) and the pooled client
  lib/          auth.ts (the security boundary), transitions.ts (the workflow
                engine, pure + tested), reports.ts (reads), format.ts
  middleware.ts cosmetic redirects only — NOT a security boundary
drizzle/        SQL migrations, including the append-only trigger
scripts/        migrate, seed, constraint verification
docs/           architecture, schema, plan, decisions, ai-prompts
```

## The one thing worth knowing before reading the code

Authorization is not in the middleware. Next.js middleware has been bypassable with a crafted
request header (CVE-2025-29927), and Server Actions are public HTTP endpoints that anyone can POST
to regardless of what the interface renders. So `requireUser()` and `requireApprover()` are called
inside every action and every data-loading function, and from session 3 onward a single pure
function `canTransition()` is the only thing in the codebase permitted to change a report's status.

## Deployment

Live at **https://expense-reimbursement-blush.vercel.app** — Vercel for the app, Neon for Postgres,
both on free tiers.

Use Neon's **pooled** connection string (the host contains `-pooler`); serverless functions open a
connection per invocation and will exhaust a direct one. `src/db/index.ts` sets `prepare: false` for
the same reason — pgbouncer in transaction mode cannot hold server-side prepared statements.

Set `DATABASE_URL` and `AUTH_SECRET` as environment variables in Vercel **before the first build**,
not after. `src/db/index.ts` throws at import time when `DATABASE_URL` is missing, and Next imports
every route module while collecting page data, so a deploy without them fails the build rather than
failing at runtime.

Migrations are not run by the build. Point `DATABASE_URL` at Neon and run them from a workstation:

```bash
DATABASE_URL="<neon pooled url>" npm run db:migrate
DATABASE_URL="<neon pooled url>" npm run db:seed
```

Four things worth knowing, all learned the hard way:

- **Neon's compute sleeps.** The free tier scales to zero, and the first request after an idle
  period can time out rather than merely being slow — the first `db:seed` against Neon died with
  `CONNECT_TIMEOUT` and the identical command succeeded straight after, because the first attempt is
  what woke the compute. Retry once.
- **`channel_binding=require`** in Neon's connection string is fine with `postgres.js`. It was worth
  checking rather than assuming, since it is a libpq parameter.
- **Vercel functions default to `iad1`** (us-east-1) while this database is in `us-east-2`. Setting
  the function region to `cle1` (Cleveland, us-east-2) in Settings → Functions co-locates them.
- **The obvious hostname was taken.** `expense-reimbursement.vercel.app` already belongs to an
  unrelated app, so Vercel assigned a suffixed name. Check what you actually deployed to before
  pointing anyone at a URL.

The ten checks in `scripts/verify-constraints.sql` were run against Neon as well as locally, so the
append-only trigger and every CHECK constraint are known to exist in production, not just in Docker:

```bash
docker compose exec -T -e PGURL="<neon pooled url>" db sh -c 'psql "$PGURL" -f -' < scripts/verify-constraints.sql
```
