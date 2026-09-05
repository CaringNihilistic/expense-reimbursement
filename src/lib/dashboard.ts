import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { expenseLines, expenseReports, reportEvents, type Status, type User } from "@/db/schema";
import { fillWeeks, type WeekBucket } from "@/lib/weeks";

/**
 * Goal 8's dashboard.
 *
 * Scope follows the same visibility rule as everything else: an approver sees
 * the company, an employee sees themselves. Goal 8 is written from finance's
 * point of view — "how much do we owe" — but goal 1 says an employee sees only
 * their own reports, and the two are only compatible if the numbers are scoped
 * to the viewer. So the same page answers "what does the company owe" for an
 * approver and "what am I owed" for an employee.
 *
 * The two "this week" numbers are counted from `report_events` rather than
 * from `decided_at`/`paid_at` on the row, because the row only remembers the
 * most recent transition. A report approved last week and paid this week still
 * carries `decided_at` from last week, and counting rows would quietly report
 * the wrong number the moment anything moved twice. The timeline cannot lie:
 * it is append-only.
 */

const WEEKS = 8;

export type StatusSlice = { status: Status | "returned"; count: number; total: string };
export type CategorySlice = { category: string; total: string };

export type Dashboard = {
  awaitingApproval: number;
  reimbursementsDue: string;
  approvedThisWeek: number;
  paidThisWeek: number;
  byStatus: StatusSlice[];
  byCategory: CategorySlice[];
  paidPerWeek: WeekBucket[];
  scope: "everyone" | "you";
};

/** A report's total, as a correlated subquery — joins here would fan out. */
const totalOf = sql<string>`(select coalesce(sum(l.amount), 0) from ${expenseLines} l where l.report_id = ${expenseReports.id})`;

/** The most recent status change was submitted -> draft, i.e. a rejection. */
const wasReturned = sql<boolean>`coalesce((
  select e.from_status = 'submitted' and e.to_status = 'draft'
  from ${reportEvents} e
  where e.report_id = ${expenseReports.id} and e.kind = 'status_change'
  order by e.created_at desc limit 1
), false)`;

export async function getDashboard(viewer: Pick<User, "id" | "role">): Promise<Dashboard> {
  const isApprover = viewer.role === "approver";
  const mine: SQL | undefined = isApprover ? undefined : eq(expenseReports.ownerId, viewer.id);
  const live = and(isNull(expenseReports.archivedAt), mine);

  const [headline] = await db
    .select({
      awaitingApproval: sql<number>`count(*) filter (where ${expenseReports.status} = 'submitted')::int`,
      reimbursementsDue: sql<string>`coalesce(sum(${totalOf}) filter (where ${expenseReports.status} = 'approved'), 0)`,
    })
    .from(expenseReports)
    .where(live);

  // Counted from the timeline, for the reason in the module comment above.
  const weekStartSql = sql`date_trunc('week', now())`;
  const [thisWeek] = await db
    .select({
      approved: sql<number>`count(*) filter (where ${reportEvents.toStatus} = 'approved')::int`,
      paid: sql<number>`count(*) filter (where ${reportEvents.toStatus} = 'paid')::int`,
    })
    .from(reportEvents)
    .innerJoin(expenseReports, eq(expenseReports.id, reportEvents.reportId))
    .where(and(sql`${reportEvents.createdAt} >= ${weekStartSql}`, mine));

  const statusRows = await db
    .select({
      status: expenseReports.status,
      returned: wasReturned,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${totalOf}), 0)`,
    })
    .from(expenseReports)
    .where(live)
    .groupBy(expenseReports.status, wasReturned);

  // Decision 3: there is no stored `rejected`. A returned draft is split out
  // here so the breakdown says something truer than "draft".
  const byStatus: StatusSlice[] = [];
  const order: (Status | "returned")[] = ["draft", "returned", "submitted", "approved", "paid"];
  for (const key of order) {
    const rows = statusRows.filter((row) =>
      key === "returned"
        ? row.status === "draft" && row.returned
        : row.status === key && !(key === "draft" && row.returned),
    );
    if (rows.length === 0) continue;
    byStatus.push({
      status: key,
      count: rows.reduce((n, row) => n + row.count, 0),
      // Only ever one row per (status, returned) pair, so this is a pick, not a sum.
      total: rows[0].total,
    });
  }

  const byCategory = await db
    .select({
      category: expenseLines.category,
      total: sql<string>`coalesce(sum(${expenseLines.amount}), 0)`,
    })
    .from(expenseLines)
    .innerJoin(expenseReports, eq(expenseReports.id, expenseLines.reportId))
    .where(live)
    .groupBy(expenseLines.category)
    .orderBy(sql`sum(${expenseLines.amount}) desc`);

  const weekly = await db
    .select({
      weekStart: sql<string>`to_char(date_trunc('week', ${reportEvents.createdAt}), 'YYYY-MM-DD')`,
      total: sql<string>`coalesce(sum(${totalOf}), 0)`,
    })
    .from(reportEvents)
    .innerJoin(expenseReports, eq(expenseReports.id, reportEvents.reportId))
    .where(
      and(
        eq(reportEvents.toStatus, "paid"),
        sql`${reportEvents.createdAt} >= date_trunc('week', now()) - interval '${sql.raw(String(WEEKS - 1))} weeks'`,
        mine,
      ),
    )
    .groupBy(sql`date_trunc('week', ${reportEvents.createdAt})`);

  return {
    awaitingApproval: headline?.awaitingApproval ?? 0,
    reimbursementsDue: headline?.reimbursementsDue ?? "0",
    approvedThisWeek: thisWeek?.approved ?? 0,
    paidThisWeek: thisWeek?.paid ?? 0,
    byStatus,
    byCategory,
    // Gaps filled in JavaScript so a quiet week is a zero bar, not a missing one.
    paidPerWeek: fillWeeks(weekly, WEEKS, new Date()),
    scope: isApprover ? "everyone" : "you",
  };
}
