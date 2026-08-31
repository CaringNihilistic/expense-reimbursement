# AI prompts

I used Claude (Claude Code) throughout. This file records the prompts as they were actually typed,
in order, grouped by what I was trying to do — including where the output was wrong and what I did
about it.

> **Still being filled in.** Sessions 2–6 get added as they happen, not reconstructed at the end.

---

## Understanding the brief

### Prompt

> read the files

### What I got

A summary of the ten goals with the specifics called out — the parts of goals 1, 4, 7 and 10 that
spell out exact rules rather than headline features. It also flagged two things I had not noticed:
that the five documentation files were sitting loose in the folder rather than under `docs/` where
the brief asks for them, and that a `CLAUDE.md` from an unrelated project further up my Downloads
tree was being pulled into context.

### What I corrected

Nothing in the summary. I moved the doc stubs into `docs/` as part of the first commit.

---

## Surveying what already exists

### Prompt

> first, scrape the web look for the existing type of project or any product available already

### What I got

A survey of the commercial category (SAP Concur, Expensify, Zoho Expense, Ramp) and of what is on
GitHub. The useful findings were not the product list:

- **Preventing self-approval is a named accounting control** — segregation of duties — not a quirk
  of this brief. That reframed goal 1 for me and gave me the vocabulary I used in
  `docs/decisions.md`.
- **My state machine matches the industry.** Expensify and Emburse use the same Draft → Submitted →
  Approved → Paid shape, with rejection returning the report to the submitter carrying a reason.
- **Goal 7 has no market equivalent.** Nothing advertises a bulk approval that reports per-report
  refusal reasons, which told me it is there to test partial-success API design specifically.
- **Nothing open-source is close enough to fork.** The available projects are either personal
  finance trackers with no approval concept at all, or bootcamp reimbursement apps with a role check
  and nothing else. None have assigned approvers, an immutable timeline, or stale alerts.

### What I corrected

Nothing to correct — it was research, and I verified the segregation-of-duties claim against the
linked sources rather than taking it on trust.

---

## Designing before building

### Prompt

> first design the architecture on basis of the requirements given to you and then master plan in
> phases for the execution

### What I got

Before answering, it asked which stack to design around and recommended **FastAPI with Jinja and
HTMX** — server-rendered Python, on the grounds that it matched what I am fastest in and would make
goal 6's "filter on the server" true by construction.

Then, once I picked, a full design: the `canTransition` guard as the single function that goals 1,
4, 7 and 9 all route through; six tables; the stale-alert predicate as a read-time query rather than
a cron job; and a six-session plan with per-session commit lists and a cut order.

### What I corrected — **the recommendation was wrong for me**

I overrode the stack recommendation and chose **Next.js full-stack TypeScript** instead. The
reasoning it gave was sound in the abstract but was built on a stale read of what I am currently
fastest in — it inferred my Python comfort from a `CLAUDE.md` belonging to a different project.

That override then invalidated part of its own advice, and I had to watch for the knock-on effects:
the Python answer had no ORM question in it at all, whereas the TypeScript one does, and the
first suggestion for that (Prisma) would not have handled goal 6's sort-by-sum-of-relation. That is
recorded as Decision 4.

**Lesson I took from it:** the model optimises against the context it has, and context from an
unrelated project silently poisons a recommendation. Worth checking what it thinks it knows about
you before accepting advice that hinges on it.

---

## Building session 1

### Prompt

> do it

### What I got

The session 1 scaffold: git repository, the six-table Drizzle schema, the append-only trigger as a
hand-written migration, session auth, a seed script, and local verification.

### What I corrected

Two things it got wrong on the first attempt, both caught by running the code rather than reading
it:

1. **Shell quoting.** It tried to write the schema file through a bash heredoc, which broke on the
   quotes inside the TypeScript. It switched to writing the file directly. No effect on the output,
   but a reminder that "it ran" and "it worked" are different claims.
2. **Top-level `await` in the throwaway scripts.** The project is CommonJS, so `tsx` refused. Fixed
   by wrapping in an `async main()` — which the real `scripts/migrate.ts` and `scripts/seed.ts`
   already did, so only the scratch script was affected.

What I insisted on, and would insist on again: **it verified the claims rather than asserting them.**
The append-only trigger, the CHECK constraints and the case-insensitive email index are all things
that are easy to write and easy to get subtly wrong. `scripts/verify-constraints.sql` runs ten
checks against a real Postgres and all ten pass. Likewise the claim that authorization does not
depend on middleware was tested by sending a session cookie signed with the wrong secret: it gets
past the middleware and is still refused by the page.

---

## _(sessions 2–6 to follow)_
