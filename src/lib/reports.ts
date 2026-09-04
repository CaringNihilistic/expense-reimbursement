import { and, asc, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";

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

export type ReportSummary = ExpenseReport & {
  total: string;
  lineCount: number;
  /**
   * A draft whose most recent status change was a rejection. There is no
   * stored `rejected` status (Decision 3), so "Returned for changes" is
   * derived from the timeline rather than read off the row.
   */
  returnedForChanges: boolean;
};

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

export async function listOwnReports(
  ownerId: string,
  { archived }: { archived: boolean },
): Promise<ReportSummary[]> {
  const rows = await db
    .select({
      report: expenseReports,
      total: sql<string>`coalesce(sum(${expenseLines.amount}), 0)`,
      lineCount: sql<number>`count(${expenseLines.id})::int`,
      returnedForChanges,
    })
    .from(expenseReports)
    .leftJoin(expenseLines, eq(expenseLines.reportId, expenseReports.id))
    .where(
      and(
        eq(expenseReports.ownerId, ownerId),
        archived ? isNotNull(expenseReports.archivedAt) : isNull(expenseReports.archivedAt),
      ),
    )
    .groupBy(expenseReports.id)
    .orderBy(desc(expenseReports.createdAt));

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
