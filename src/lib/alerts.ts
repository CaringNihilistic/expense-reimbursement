import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { alertDismissals, expenseLines, expenseReports, reportApprovers, users, type ExpenseReport, type User } from "@/db/schema";
import { ALERT_SNOOZE_DAYS, STALE_AFTER_DAYS } from "@/lib/constants";

/**
 * Goal 10's stale-approval alerts.
 *
 * A report is stale when it has sat in Submitted longer than
 * STALE_AFTER_DAYS without a decision. An approver may dismiss the alert for a
 * report assigned to them, and the alert *returns* if the report is still
 * undecided ALERT_SNOOZE_DAYS later.
 *
 * The return needs no scheduled job, which is the point of the design. There
 * is no "dismissed" flag to unset and no cron to unset it: a dismissal is a
 * timestamped row, and the alert reappears simply because that row ages out of
 * the snooze window. The state is a function of the clock, evaluated at read
 * time, so nothing can be left stuck by a job that failed to run.
 *
 * Dismissals are per approver. One approver silencing an alert does not
 * silence it for everyone else, which matters because the queue is shared.
 */

export type StaleAlert = ExpenseReport & {
  total: string;
  ownerName: string;
  assignedToMe: boolean;
  daysWaiting: number;
};

/** Submitted, unarchived, and older than the threshold. */
const isStale = and(
  eq(expenseReports.status, "submitted"),
  isNull(expenseReports.archivedAt),
  sql`${expenseReports.submittedAt} < now() - ${sql.raw(`interval '${STALE_AFTER_DAYS} days'`)}`,
);

/** This viewer dismissed it recently enough that it should stay quiet. */
const dismissedBy = (userId: string) => sql`exists (
  select 1 from ${alertDismissals} d
  where d.report_id = ${expenseReports.id}
    and d.user_id = ${userId}
    and d.dismissed_at > now() - ${sql.raw(`interval '${ALERT_SNOOZE_DAYS} days'`)}
)`;

const assignedTo = (userId: string) => sql<boolean>`exists (
  select 1 from ${reportApprovers} ra
  where ra.report_id = ${expenseReports.id} and ra.user_id = ${userId}
)`;

export async function listStaleAlerts(viewerId: string): Promise<StaleAlert[]> {
  const rows = await db
    .select({
      report: expenseReports,
      total: sql<string>`(select coalesce(sum(l.amount), 0) from ${expenseLines} l where l.report_id = ${expenseReports.id})`,
      ownerName: users.name,
      assignedToMe: assignedTo(viewerId),
      daysWaiting: sql<number>`floor(extract(epoch from now() - ${expenseReports.submittedAt}) / 86400)::int`,
    })
    .from(expenseReports)
    .innerJoin(users, eq(users.id, expenseReports.ownerId))
    .where(and(isStale, sql`not ${dismissedBy(viewerId)}`))
    .orderBy(asc(expenseReports.submittedAt));

  return rows.map(({ report, ...rest }) => ({ ...report, ...rest }));
}

/** The navigation badge. Same predicate, counted rather than listed. */
export async function countStaleAlerts(viewerId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(expenseReports)
    .where(and(isStale, sql`not ${dismissedBy(viewerId)}`));

  return row?.value ?? 0;
}

/**
 * Goal 10 gates dismissal on assignment: "an approver can dismiss the alert
 * for a report assigned to them". This is the one place assignment is a
 * permission rather than routing — see Decision 6.
 */
export async function isAssignedTo(reportId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ reportId: reportApprovers.reportId })
    .from(reportApprovers)
    .where(and(eq(reportApprovers.reportId, reportId), eq(reportApprovers.userId, userId)))
    .limit(1);

  return Boolean(row);
}
