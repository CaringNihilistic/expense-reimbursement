# Plan

## How the work is split

Six sessions of roughly two hours, one a day. Three rules set the order:

1. **Deploy on day one.** Hosting problems are the ones that eat an evening, and they must surface
   while there is still a week left to fix them — not on the last day.
2. **Build the workflow engine early.** It is the hardest part of the brief and everything after it
   consumes it: bulk actions, the timeline, the queues and the dashboard all depend on the same
   transition rules. It gets session 3, while I am still fresh.
3. **Close every session with a commit and a paragraph of documentation.** The brief says a history
   that is one big commit scores zero, and that these documents should be written as the work
   happens. Both are cheap to do daily and expensive to reconstruct.

| # | Session | Goals |
|---|---|---|
| 1 | Skeleton, auth, and a live URL | 1 |
| 2 | Reports and lines, archive and restore | 2, 3 |
| 3 | The workflow engine, timeline, assigned approvers | 4, 5, 9 |
| 4 | Server-side search and filtering, bulk decisions, CSV export | 6, 7 |
| 5 | Dashboard and stale-approval alerts | 8, 10 |
| 6 | Realistic seed data, hardening, documentation | — |

All six ran, plus an unplanned seventh for deployment — which should have been part of session 1.

## Why that order

Sessions 2 and 3 are the spine: there is no point building a search page over reports that do not
exist, or a bulk approval over a transition rule that has not been written. Sessions 4 and 5 are
both consumers of session 3 — bulk approval is `canTransition` in a loop, and the alerts area is a
query over the same `submitted` state the workflow produces. Either could slip a day without
blocking the other, which makes them the natural place to absorb overrun.

Session 6 exists because a demo with an empty dashboard reads as a broken app. Seeding realistic
data across eight weeks is the difference between "it works" and "I can see it working", and it is
worth a dedicated slot rather than fifteen rushed minutes.

## Estimated versus actual

Filled in at the end of each session. **Total: about 13 hours against a 12-hour budget.** These
are close rather than exact — reconstructed from the commit record, not a stopwatch.

| Session | Estimated | Actual | What slipped |
|---|---|---|---|
| 1 · Skeleton, auth, deploy | 2h 00m | ~2h 00m | Scope complete: repo, six tables, append-only trigger, session auth, seed, local verification. **The deploy did not happen on day one** — it slipped to after session 3, so rule 1 of this plan was broken by three sessions. It cost nothing in the end, which is luck rather than vindication: the first deploy surfaced a taken hostname, a sleeping database and a region mismatch, and any of those could have been the thing that ate the last evening. |
| 2 · Reports and lines | 2h 00m | ~2h 30m | Goals 2 and 3 complete and driven end to end in a real browser. Most of the time went to verification rather than to writing the feature, and it earned its keep: it caught a money-precision bug the type system was actively hiding (see Decision 7). |
| 3 · Workflow engine | 2h 00m | ~2h 00m | Goals 4, 5 and 9 complete, plus the first real test suite (30 tests on `canTransition`). Came in closer to estimate than session 2 because the pure function could be proved correct without a browser. Two bugs found by testing rather than reading: an approver landed on a 404 after rejecting, and the "needs a line" rule hid the very button that would have explained it. |
| 4 · Finding and bulk | 2h 00m | ~1h 30m | Goals 6 and 7. The cheapest session so far, because session 3 had already paid for it: bulk approval is `canTransition` in a loop, exactly as Decision 8 predicted. Time went instead to two things that were not obviously coming — the bulk result could not be re-queried without leaking (Decision 9), and goal 6 forced `/reports` to stop being the owner's list (Decision 10, the reversal). |
| 5 · Dashboard and alerts | 2h 00m | ~2h 00m | Goals 8 and 10, so all ten are now met. The eight-week chart shipped as bars rather than falling back to the table in the cut list, because there was time. One bug that only a screenshot could catch: the bars rendered as flat 2px lines, since a percentage height had no definite parent height to resolve against. Counts, labels and values were all correct — the picture was wrong. |
| — · Deployment | not planned | ~1h 00m | Should have been part of session 1. GitHub, Neon, Vercel, migrations and seeding against production, plus verifying the constraint suite and the segregation-of-duties rule against the live server rather than only against Docker. |
| 6 · Seed, harden, submit | 2h 00m | ~2h 00m | Eight weeks of backdated demo history as a committed, re-runnable script; seven integration tests against a real database, which was the largest remaining gap in how this is verified; and a full pass over these documents. |

## What was going to be cut, and what actually was

The plan was to cut **fidelity, not goals**, in this order:

1. Visual polish. Unstyled but clear beats half-styled.
2. The eight-week chart becomes a table of the same numbers. Goal 8 still met.
3. Test breadth shrinks to `canTransition` only — that suite never goes.
4. Timeline comments become read-only display of seeded comments rather than a compose box.

**In the end only the first was cut.** The interface is deliberately plain — one small stylesheet, no
component library, no design system — and that is the one item on the list I would still cut first
if the time came back.

Items 2, 3 and 4 all survived. The chart shipped as bars rather than a table; the test suite grew to
73 rather than shrinking to 30; comments are a working compose box rather than seeded display. That
was not discipline so much as compound interest: building the workflow engine as a *pure function*
in session 3 made sessions 4 and 5 cheaper than estimated, and the time that bought is what paid for
the things the plan had earmarked for cutting.

What was never at risk, and was not cut: server-side enforcement, the rule that nobody approves
their own report, per-report results from bulk actions, and these five documents.

## What the plan got wrong

Three things, recorded because the estimates were not the interesting part:

- **Rule 1 was broken.** "Deploy on day one" slipped by three sessions. The outcome was fine, which
  is luck rather than vindication — the first deploy surfaced a taken hostname, a sleeping database
  and a region mismatch, and any of those could have been the thing that ate the last evening.
- **The reversal was not the one predicted.** `docs/decisions.md` nominated the missing `total`
  column, on the theory that goal 6's sort-by-total would force a denormalisation. It did not. The
  reversal that actually happened was `/reports` ceasing to be the owner's list (Decision 10),
  forced by a requirement that was in the brief before session 2 built the wrong thing.
- **Verification cost more than the features.** Session 2 spent most of its time proving things
  rather than writing them, and that pattern held. It was worth it — the two bugs that mattered most
  (a money-precision fault and a chart that rendered as flat lines) were both invisible to the type
  checker and to the build.
