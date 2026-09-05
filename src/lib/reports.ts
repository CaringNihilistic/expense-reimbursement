import { and, asc, desc, eq, isNull, isNotNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  expenseLines,
  expenseReports,
  reportApprovers,
  reportEvents,
  users,
  type ExpenseReport,
  type ExpenseLine,
  type ReportEvent,
  type User,
} from "@/db/schema";

export type ReportWithLines = ExpenseReport & {
  total: string;
  lines: ExpenseLine[];
  ownerName: string;
};

export type QueueRow = ExpenseReport & {
  total: string;
  ownerName: string;
  assignedToMe: boolean;
};

export type TimelineEvent = ReportEvent & { actorName: string };

export type SearchRow = ExpenseReport & {
  total: string;
  ownerName: string;
  returnedForChanges: boolean;
};

/**
 * `returned` is not a stored status (Decision 3) — it is a draft whose last
 * status change was a rejection. It is offered as a filter anyway, because
 * "show me what came back to me" is a question people actually ask.
 */
export const STATUS_FILTERS = ["draft", "returned", "submitted", "approved", "paid"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORT_FIELDS = ["submitted", "status", "total"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type SearchFilters = {
  q?: string;
  status?: StatusFilter;
  ownerId?: string;
  approverId?: string;
  archived: boolean;
  sort: SortField;
  dir: "asc" | "desc";
  page: number;
  perPage: number;
};

export type SearchResult = {
  rows: SearchRow[];
  matchCount: number;
  page: number;
  perPage: number;
  pageCount: number;
};

/** Scalar subquery for a report's total. Avoids fanning out over a join. */
const totalOf = (reportId = expenseReports.id) =>
  sql<string>`(select coalesce(sum(l.amount), 0) from ${expenseLines} l where l.report_id = ${reportId})`;

/** The most recent status change was submitted -> draft, i.e. a rejection. */
const returnedForChanges = sql<boolean>`coalesce((
  select e.from_status = 'submitted' and e.to_status = 'draft'
  from ${reportEvents} e
  where e.report_id = ${expenseReports.id} and e.kind = 'status_change'
  order by e.created_at desc
  limit 1
), false)`;

/**
 * A report may be edited — its metadata, and its lines — only while it is
 * still a draft and not archived. Session 2 never produces anything but
 * drafts (submission lands in session 3), but goal 3 states the rule
 * ("until the report is submitted") independently of that, so it is
 * enforced here rather than left implicit.
 *
 * Archiving a non-draft report is still allowed — goal 2 places no status
 * restriction on archive/restore — it just also freezes editing, which is
 * the one judgement call in this file: an archived report reads as "done
 * with", so re-opening it for edits goes through Restore first.
 */
export function isEditable(report: Pick<ExpenseReport, "status" | "archivedAt">): boolean {
  return report.status === "draft" && report.archivedAt === null;
}

/**
 * Goal 6. One list across every employee the viewer is allowed to see, with
 * search, filters, sorting and pagination — all of it in SQL. Nothing here
 * loads a set and narrows it in JavaScript.
 *
 * Two deliberate choices worth knowing:
 *
 * The total is a correlated subquery rather than a join to a grouped set.
 * Joining `expense_lines` *and* `report_approvers` in one statement fans the
 * rows out and multiplies `sum(amount)` by the number of assigned approvers —
 * a wrong number that looks plausible. Subqueries cannot fan out.
 *
 * The match count is `count(*) over ()`, so the page of rows and the total
 * number of matches arrive in a single round trip instead of two queries that
 * can disagree with each other under concurrent writes.
 *
 * This is the query docs/schema.md predicts will break first at 100x, and
 * sorting by total is the reason. See that file.
 */
export async function searchReports(
  viewer: Pick<User, "id" | "role">,
  filters: SearchFilters,
): Promise<SearchResult> {
  const conditions: (SQL | undefined)[] = [
    // The same visibility rule as canView(), expressed in SQL: your own
    // reports always, plus everyone else's once they have left draft.
    viewer.role === "approver"
      ? sql`(${expenseReports.ownerId} = ${viewer.id} or ${expenseReports.status} <> 'draft')`
      : eq(expenseReports.ownerId, viewer.id),
    filters.archived ? isNotNull(expenseReports.archivedAt) : isNull(expenseReports.archivedAt),
  ];

  if (filters.q) {
    // Case-insensitive contains. At 100x this wants a trigram index; at this
    // size an index would be slower than the sequential scan it replaces.
    conditions.push(sql`${expenseReports.title} ilike ${`%${filters.q}%`}`);
  }
  if (filters.ownerId) conditions.push(eq(expenseReports.ownerId, filters.ownerId));
  if (filters.approverId) {
    conditions.push(sql`exists (
      select 1 from ${reportApprovers} ra
      where ra.report_id = ${expenseReports.id} and ra.user_id = ${filters.approverId}
    )`);
  }
  if (filters.status === "returned") {
    conditions.push(eq(expenseReports.status, "draft"));
    conditions.push(returnedForChanges);
  } else if (filters.status) {
    conditions.push(eq(expenseReports.status, filters.status));
  }

  const direction = filters.dir === "asc" ? sql`asc` : sql`desc`;
  const orderBy: Record<SortField, SQL> = {
    // Drafts have no submitted date; keep them out of the way rather than
    // letting NULL sort to whichever end Postgres prefers.
    submitted: sql`${expenseReports.submittedAt} ${direction} nulls last`,
    // Alphabetical order of the status words is meaningless. Order by
    // position in the lifecycle instead, which is what "sort by status" means.
    status: sql`case ${expenseReports.status}
      when 'draft' then 0 when 'submitted' then 1 when 'approved' then 2 else 3 end ${direction}`,
    total: sql`${totalOf()} ${direction}`,
  };

  const offset = (filters.page - 1) * filters.perPage;

  const rows = await db
    .select({
      report: expenseReports,
      total: totalOf(),
      ownerName: users.name,
      returnedForChanges,
      matchCount: sql<number>`count(*) over ()::int`,
    })
    .from(expenseReports)
    .innerJoin(users, eq(users.id, expenseReports.ownerId))
    .where(and(...conditions))
    // created_at breaks ties so paging is stable: without it two reports with
    // the same total can swap places between page 1 and page 2.
    .orderBy(orderBy[filters.sort], desc(expenseReports.createdAt))
    .limit(filters.perPage)
    .offset(offset);

  const matchCount = rows.length ? Number(rows[0].matchCount) : 0;

  return {
    rows: rows.map(({ report, matchCount: _ignored, ...rest }) => ({ ...report, ...rest })),
    matchCount,
    page: filters.page,
    perPage: filters.perPage,
    pageCount: Math.max(1, Math.ceil(matchCount / filters.perPage)),
  };
}

/** Everyone, for the owner filter. Small table; no need to paginate it. */
export async function listUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.name));
}

/**
 * Goal 7's CSV: approved but not yet paid — the money the company currently
 * owes. Archived reports are excluded; an archived report is not a live debt.
 */
export async function getReimbursementsDue(): Promise<
  (ExpenseReport & { total: string; ownerName: string; ownerEmail: string; decidedByName: string | null })[]
> {
  const decider = sql<string | null>`(select d.name from ${users} d where d.id = ${expenseReports.decidedById})`;

  const rows = await db
    .select({
      report: expenseReports,
      total: totalOf(),
      ownerName: users.name,
      ownerEmail: users.email,
      decidedByName: decider,
    })
    .from(expenseReports)
    .innerJoin(users, eq(users.id, expenseReports.ownerId))
    .where(and(eq(expenseReports.status, "approved"), isNull(expenseReports.archivedAt)))
    .orderBy(asc(expenseReports.decidedAt));

  return rows.map(({ report, ...rest }) => ({ ...report, ...rest }));
}

/**
 * Goal 5's approval queue: every report awaiting a decision, or just those
 * assigned to this approver.
 *
 * The viewer's own reports are deliberately included. Assignment is routing,
 * not permission (Decision 6), and goal 7 needs a bulk selection that *can*
 * contain the approver's own report so the per-report refusal is
 * demonstrable. canTransition refuses them one by one at decision time.
 */
export async function listApprovalQueue(
  viewerId: string,
  { assignedOnly }: { assignedOnly: boolean },
): Promise<QueueRow[]> {
  const assignedToMe = sql<boolean>`exists (
    select 1 from ${reportApprovers} ra
    where ra.report_id = ${expenseReports.id} and ra.user_id = ${viewerId}
  )`;

  const rows = await db
    .select({ report: expenseReports, total: totalOf(), ownerName: users.name, assignedToMe })
    .from(expenseReports)
    .innerJoin(users, eq(users.id, expenseReports.ownerId))
    .where(
      and(
        eq(expenseReports.status, "submitted"),
        isNull(expenseReports.archivedAt),
        assignedOnly ? assignedToMe : undefined,
      ),
    )
    // Oldest first: the queue is a work list, and the report that has waited
    // longest is the one goal 10 will eventually raise an alert about.
    .orderBy(asc(expenseReports.submittedAt));

  return rows.map(({ report, ...rest }) => ({ ...report, ...rest }));
}

/**
 * Who may look at a report.
 *
 * The owner, always. An approver, once the report has left draft — goal 1
 * gives approvers "reports submitted by other employees", and someone else's
 * unsubmitted draft is nobody's business. A rejected report returns to draft
 * (Decision 3) and so leaves the approvers' view again, which is right: it is
 * back in its owner's hands.
 *
 * Returning null rather than throwing a 403 keeps the two indistinguishable
 * to a caller — a stranger cannot use the error to learn that a report exists.
 */
export function canView(
  report: Pick<ExpenseReport, "ownerId" | "status">,
  viewer: Pick<User, "id" | "role">,
): boolean {
  if (report.ownerId === viewer.id) return true;
  return viewer.role === "approver" && report.status !== "draft";
}

export async function getVisibleReport(
  reportId: string,
  viewer: Pick<User, "id" | "role">,
): Promise<ReportWithLines | null> {
  const report = await db.query.expenseReports.findFirst({
    where: (r, { eq }) => eq(r.id, reportId),
    with: {
      lines: { orderBy: (l, { desc }) => desc(l.incurredOn) },
      owner: true,
    },
  });
  if (!report) return null;
  if (!canView(report, viewer)) return null;

  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${expenseLines.amount}), 0)` })
    .from(expenseLines)
    .where(eq(expenseLines.reportId, reportId));

  return {
    ...report,
    total,
    ownerName: report.owner.name,
    // The relational query API (`with: { lines }`) fetches nested rows via a
    // JSON-aggregating SQL query. Postgres serialises `numeric` into a JSON
    // *number*, so by the time it reaches JS `line.amount` is silently a
    // float (e.g. 120.5, not "120.50") — unlike the plain `db.select()` path
    // above, which the driver returns as a string untouched. Re-fix it to a
    // string here so nothing downstream inherits a float that looks like
    // money; see the "never parseFloat money" note on expense_lines.amount
    // in src/db/schema.ts. This is formatting a value Postgres already
    // rounded to 2dp, not arithmetic on it.
    lines: report.lines.map((line) => ({ ...line, amount: Number(line.amount).toFixed(2) })),
  };
}

/**
 * Goal 9's timeline. Status changes and comments share one table, so this is
 * one ordered query rather than a merge of two result sets — and the table is
 * append-only in the database, not by convention (drizzle/0001).
 *
 * Newest first: the useful question is almost always "what happened last".
 */
export async function getTimeline(reportId: string): Promise<TimelineEvent[]> {
  const rows = await db
    .select({ event: reportEvents, actorName: users.name })
    .from(reportEvents)
    .innerJoin(users, eq(users.id, reportEvents.actorId))
    .where(eq(reportEvents.reportId, reportId))
    .orderBy(desc(reportEvents.createdAt));

  return rows.map(({ event, actorName }) => ({ ...event, actorName }));
}

/** The eligible approvers assigned to a report (goal 5). */
export async function getAssignedApprovers(reportId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(reportApprovers)
    .innerJoin(users, eq(users.id, reportApprovers.userId))
    .where(eq(reportApprovers.reportId, reportId))
    .orderBy(asc(users.name));

  return rows.map(({ user }) => user);
}

/** Everyone who could be assigned as an approver. */
export async function listApprovers(): Promise<User[]> {
  return db.select().from(users).where(eq(users.role, "approver")).orderBy(asc(users.name));
}
