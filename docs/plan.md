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

Filled in at the end of each session.

| Session | Estimated | Actual | What slipped |
|---|---|---|---|
| 1 · Skeleton, auth, deploy | 2h 00m | _record it_ | Scope complete: repo, six tables, append-only trigger, session auth, seed, local verification. Vercel + Neon deploy still outstanding. |
| 2 · Reports and lines | 2h 00m | | |
| 3 · Workflow engine | 2h 00m | | |
| 4 · Finding and bulk | 2h 00m | | |
| 5 · Dashboard and alerts | 2h 00m | | |
| 6 · Seed, harden, submit | 2h 00m | | |

## What gets cut if time runs short

The brief says eight goals done well beats ten done badly, but all ten are the stated cutoff. So the
plan is to cut **fidelity, not goals** — in this order:

1. Visual polish. Unstyled but clear beats half-styled.
2. The eight-week chart becomes a table of the same numbers. Goal 8 still met.
3. Test breadth shrinks to `canTransition` only — that suite never goes.
4. Timeline comments become read-only display of seeded comments rather than a compose box.

What does not get cut under any circumstance: server-side enforcement, the rule that nobody approves
their own report, per-report results from bulk actions, and these five documents.

_(Update this section with what actually happened, not what was planned.)_
