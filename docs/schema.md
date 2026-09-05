# Schema

Six tables. Defined in [`src/db/schema.ts`](../src/db/schema.ts); the SQL is in
[`drizzle/`](../drizzle).

## Table by table

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | `gen_random_uuid()` |
| `email` | `text` not null | unique on `lower(email)` |
| `password_hash` | `text` not null | bcrypt, cost 10 |
| `name` | `text` not null | |
| `role` | `text` not null default `'employee'` | CHECK in (`employee`, `approver`) |
| `created_at` | `timestamptz` not null | |

Uniqueness is a unique index on the expression `lower(email)` rather than on the column, which
gives case-insensitive uniqueness without installing the `citext` extension.

### `expense_reports`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `owner_id` | `uuid` not null → `users.id` | `on delete restrict` |
| `title` | `text` not null | CHECK non-blank after trimming |
| `period_start`, `period_end` | `date` not null | CHECK `period_end >= period_start` |
| `status` | `text` not null default `'draft'` | CHECK in (`draft`, `submitted`, `approved`, `paid`) |
| `submitted_at`, `decided_at`, `paid_at` | `timestamptz` null | |
| `decided_by_id` | `uuid` null → `users.id` | who approved it |
| `archived_at` | `timestamptz` null | archive is a flag, not a status |
| `created_at`, `updated_at` | `timestamptz` not null | |

No `total` column — see "Denormalisation" below. No `rejected` status — see
[decisions.md](decisions.md#decision-3--there-is-no-rejected-status).

### `expense_lines`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `report_id` | `uuid` not null → `expense_reports.id` | `on delete cascade` |
| `incurred_on` | `date` not null | |
| `amount` | `numeric(12,2)` not null | CHECK `> 0` |
| `category` | `text` not null | CHECK in the seven fixed categories |
| `description` | `text` not null | |
| `created_at` | `timestamptz` not null | |

`numeric`, never `float8`. Drizzle returns it as a JavaScript **string** on purpose; all arithmetic
happens in SQL via `sum()`. Nothing in the application calls `parseFloat` on money.

### `report_approvers`

| Column | Type | Notes |
|---|---|---|
| `report_id` | `uuid` → `expense_reports.id` | cascade |
| `user_id` | `uuid` → `users.id` | cascade |
| `assigned_at` | `timestamptz` not null | |

Composite primary key `(report_id, user_id)`, plus an index on `user_id` for the "assigned to me"
queue.

### `report_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `report_id` | `uuid` not null → `expense_reports.id` | **`on delete restrict`** |
| `actor_id` | `uuid` not null → `users.id` | restrict |
| `kind` | `text` not null | CHECK in (`status_change`, `comment`) |
| `from_status`, `to_status` | `text` null | populated on status changes |
| `reason` | `text` null | required when an approver rejects |
| `body` | `text` null | the comment text |
| `created_at` | `timestamptz` not null | |

Status changes and comments share one table so the timeline is a single ordered query rather than a
merge of two result sets in application code.

The foreign key is `restrict`, not `cascade`, which has a useful consequence: a report that has any
history can never be hard-deleted, only archived. A pristine draft that was never submitted has no
events and still can be.

### `alert_dismissals`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `report_id` | `uuid` not null → `expense_reports.id` | cascade |
| `user_id` | `uuid` not null → `users.id` | cascade |
| `dismissed_at` | `timestamptz` not null | |

One row per dismissal, never updated. The alert returns simply because the row ages out of the
snooze window, which is why goal 10 needs no scheduled job.

## Relationships

One-to-many:

- `users` → `expense_reports` (owner)
- `expense_reports` → `expense_lines`
- `expense_reports` → `report_events`
- `users` → `report_events` (actor)

Many-to-many — **exactly one**:

- `expense_reports` ↔ `users` through `report_approvers`. Any number of approvers may be assigned to
  a report, and one approver may be assigned to any number of reports.

`alert_dismissals` is one-to-many from both sides rather than a join table: it records *events*
(this person dismissed this alert at this moment), not a relationship.

## Constraints: database versus application

The line I drew is **shape in the database, policy in the application**.

In the database, because they must hold no matter what code runs:

- Foreign keys, primary keys, not-null.
- The three closed vocabularies — role, status, category — as CHECK constraints. Text plus CHECK
  rather than a Postgres enum, because altering an enum needs a migration and a table rewrite while
  a CHECK needs one line.
- `amount > 0`, `period_end >= period_start`, non-blank title.
- The `report_events` shape rule: a `status_change` carries a `to_status` and no `body`; a `comment`
  is the reverse. One constraint stops half the malformed rows the timeline could otherwise hold.
- **Append-only `report_events`.** A `BEFORE UPDATE OR DELETE` trigger raises an exception, plus a
  statement-level trigger for `TRUNCATE`, which row triggers do not catch. Goal 9 says nothing in
  the timeline can be edited or deleted after the fact "including by approvers" — a service-layer
  guard would hold only as long as every future code path remembers to go through it. This holds
  against a bug, a stray script, and anyone at a `psql` prompt.

The three vocabularies are also declared to TypeScript with Drizzle's `$type<…>()`, so `status` is
`"draft" | "submitted" | "approved" | "paid"` in the editor rather than plain `string`. That is a
type-level mirror of the CHECK constraint, not a second enforcement point — the database is still
the thing that holds. It was added in session 3 because `canTransition` switches exhaustively on
status, and a `string` there means the compiler cannot tell you when a case is missing.

In the application, because they depend on who is asking:

- Who may submit, approve, reject or mark paid — including the rule that an approver may never
  decide their own report. This is a function of the actor, not of the row, and a CHECK constraint
  cannot see the actor.
- Which transitions are legal from which status. Expressible as a trigger, but then the refusal
  reason arrives as a Postgres exception string instead of the typed code goal 7 needs to report
  per report.
- Ownership scoping on reads.

`scripts/verify-constraints.sql` proves the database half — ten checks, run in a transaction that
rolls back. All ten pass.

## What I deliberately denormalised

**Nothing, yet — and that is the deliberate part.** The obvious candidate is a `total` column on
`expense_reports`. I left it out so that goal 3's "never a value the client can set" is structurally
true rather than merely enforced (see
[decisions.md](decisions.md#decision-5--the-report-total-is-computed-never-stored)).

The cost is real: sorting a paginated list by total requires joining a grouped subquery over
`expense_lines` on every page load. If that becomes the thing that hurts, the fix is a `total`
column maintained by the one service that edits lines — and I will record it as a reversal rather
than pretend it was the plan.

## What goal 6 actually built, and what it confirmed

The search query is one statement: a correlated `sum()` subquery for the total, `count(*) over ()`
for the match count, `EXISTS` for the approver filter, `ILIKE` for the title search, and
`LIMIT`/`OFFSET` for the page.

The totals are **subqueries rather than joins on purpose**. Joining `expense_lines` and
`report_approvers` in the same statement fans the rows out and multiplies `sum(amount)` by the
number of assigned approvers — a wrong number that looks entirely plausible. Subqueries cannot fan
out, and the test suite checks the listed total against the report's own detail page precisely
because that is the failure mode that would otherwise ship silently.

Sorting by status orders by position in the lifecycle rather than alphabetically, since
`approved < draft < paid < submitted` is not a meaningful order for anything.

## What would break first at 100× the data

This section was written in session 1 as a prediction. Session 4 built the query it predicts about,
so the honest status of each item is now recorded alongside it. At roughly 100,000 reports and a
million lines, in the order I expect it:

1. **Sorting by total.** Every other sort is a plain indexed column. Sorting by an aggregate means
   grouping every line belonging to every report that matches the filters before the first page can
   be returned — the work does not shrink because the page is small. This is the first thing to
   break, and the denormalised `total` column above is the fix.
   *Status after session 4: built, and not yet a problem.* At 33 reports it is instant, so the
   `total` column stays unbuilt — see the Decision 5 postscript in `decisions.md` for what would
   actually trigger it. The title search is `ILIKE '%…%'`, which cannot use a b-tree index either;
   at this size a `pg_trgm` GIN index would cost more than the sequential scan it replaced, and it
   is the second thing to add when this list stops being instant.
2. **`count(*) OVER ()` for the match total.** Goal 6 needs the number of matches; the window
   function gets it in the same round trip, but Postgres still has to reach every matching row. The
   usual answers are an approximate count above some threshold, or keyset pagination instead of
   `OFFSET`.
3. **`OFFSET` pagination.** Deep pages scan and discard everything before them. Fine at page 3,
   painful at page 900.
4. **The dashboard aggregates.** Four headline numbers, two breakdowns and an eight-week series,
   all recomputed on every page load. The eight-week chart is the one worth caching or rolling up
   first, since it re-reads a growing history to produce eight numbers that change once a day.

What does *not* break: the stale-alert predicate, which is indexed on `(status, submitted_at)` and
only ever touches submitted reports — a set that stays small because reports leave it.
