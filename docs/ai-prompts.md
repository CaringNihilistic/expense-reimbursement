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

## Building session 2

### Prompt

> check if the session 1 is completed and then start session 2

### What I got

First an audit rather than an answer. It checked the repository state instead of trusting the tick
in `plan.md`, and reported session 1 as **not** complete: there was no git remote configured, no
Vercel or Neon connection string anywhere, and `npm test` reported "no test files found" — the
`test(db)` commit had added `scripts/verify-constraints.sql`, which is run by hand through `psql`,
not a Vitest suite. That is a fair correction. The plan's own rule 1 is "deploy on day one" and I
had not done it.

Then goals 2 and 3: `src/lib/reports.ts` for the reads, `src/app/reports/actions.ts` for the seven
Server Actions, three pages, and a shared nav.

### What I corrected — **the verification found a bug the types were hiding**

The build passed and the types checked, and none of that was worth anything, because the bug was
invisible to both. Driving the app in a real browser showed a line amount rendering as `120.5`
instead of `120.50`.

The cause is written up as Decision 7: Drizzle's relational query API aggregates nested rows into
JSON inside Postgres, `numeric` becomes a JSON number, and the value comes back a float — while
TypeScript still says `string`. The `db.select()` path used by the list query is unaffected, which
is why it showed up in one place and not the other.

What I want on the record is that **`tsc` was green throughout**. A type annotation is a claim
about runtime, not proof of it.

### What else it got wrong — its own test script, three times

The browser suite it wrote failed repeatedly, and each failure was the harness, not the app:

1. `button:has-text("Save")` matched **"Save changes"** too — `has-text` is a substring match — so
   the click went to the metadata form instead of the line. Fixed with `:text-is("Save")`.
2. `text=Flight` never matches a value inside an `<input>`; `text=` matches rendered text, and an
   input's value is an attribute.
3. `waitForURL(sameUrl)` resolves instantly when the URL already matches, so assertions ran before
   the round trip landed. Every one of these actions redirects to the page it is already on.

It also chased two false leads with real conviction — that the session cookie was being dropped,
and that React 19 could not submit a form from a button associated by the `form` attribute — before
isolating each with a probe that disproved it. The thing that actually settled the question was
replaying the Server Action with `curl` and reading the row back out of Postgres: the server had
been correct the entire time.

**Lesson I took from it:** a failing test is a claim about two things, the app and the test, and it
is worth asking which one is lying. Roughly two thirds of this session went to verification and its
false alarms rather than to the feature.

### What I insisted on

Testing the security boundary rather than assuming it. Signed in as a second employee and (a)
requested another user's report — 404, (b) replayed that user's `updateLine` Server Action payload
against their line with my own cookie — 404, row unchanged. That second one is the test that
matters, because it is the attack `docs/architecture.md` says the design defends against, and the
only way to run it is to bypass the interface entirely.

---

## Building session 3

### Prompt

> start session 3

### What I got

The workflow engine as a pure function first, its test suite second, and only then the interface —
which is the order the plan asks for and, more to the point, the order that let the hard part be
proved correct in 5ms instead of through a browser. Then the timeline, the approval queue, assigned
approvers, and the comment box.

### What I corrected — **two bugs the tests found, both invisible to the type checker**

1. **Rejecting dropped the approver on a 404.** Rejection returns a report to Draft (Decision 3),
   and a draft is visible only to its owner — so the approver who had just rejected something could
   no longer see the page the action redirected them to. The fix is to ask `canView` where to send
   them rather than assuming the report page. Recorded at the end of Decision 8, because it is a
   small illustration of a large idea: a rule expressed as a function is a rule you can re-ask
   somewhere else.

2. **The "add a line first" rule hid its own explanation.** I had the interface ask `canTransition`
   whether to render the Submit button at all, which is right for ownership and status — and wrong
   for this rule, because the button vanished and took the reason with it. Now ownership and status
   decide whether the button exists; the line-count rule only decides what the hint next to it says,
   and the server refuses either way.

Neither would have been caught by reading the code, and neither broke a type.

### What the AI got wrong: its test harness, again

Three more harness failures, none of them the app — a stale closure that waited for the wrong
report's URL, a sign-out click on a 404 page that has no navigation, and title selectors that
matched leftovers from previous runs.

That last one was interesting, because the *reason* the leftovers existed is goal 9 working: my
cleanup ran `delete from report_events`, the append-only trigger refused it, the whole statement
rolled back, and the reports survived. The test harness was defeated by the immutability the brief
asked for. I switched to unique per-run titles and kept the trigger.

### What I insisted on

Proving the segregation-of-duties rule against the server rather than the interface. The button is
hidden on your own report, which proves nothing. So: sign in as Sandeep, lift the real
`approveReport` payload from Meera's view of that same report, and POST it with Sandeep's cookie.
Refused, with `canTransition`'s own message, the status unchanged and no timeline row written. The
same replay as an employee is refused for the other reason. Those two curl commands are the
evidence for goal 1 that the interface cannot provide.

---

## _(sessions 4–6 to follow)_
