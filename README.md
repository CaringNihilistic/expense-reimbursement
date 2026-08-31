# Expense Reimbursement

Employees submit expense reports with individual line items, an approver who is not the employee
decides on each one, and finance can see exactly what is owed and to whom at any moment.

Built for Assignment 11 — the brief is kept verbatim in [docs/brief.md](docs/brief.md).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), TypeScript, React 19 |
| Data access | Drizzle ORM over `postgres.js` |
| Database | PostgreSQL 16 (Neon in production, Docker locally) |
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
  db/           schema.ts (six tables) and the pooled client
  lib/          auth.ts (the security boundary), constants.ts
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

Vercel for the app, Neon for Postgres, both on free tiers. Use Neon's **pooled** connection string
(the host contains `-pooler`); serverless functions open a connection per invocation and will
exhaust a direct one. `src/db/index.ts` sets `prepare: false` for the same reason — pgbouncer in
transaction mode cannot hold server-side prepared statements.

Set `DATABASE_URL` and `AUTH_SECRET` as environment variables in Vercel. Never commit them.
