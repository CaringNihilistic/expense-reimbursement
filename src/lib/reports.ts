import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { expenseLines, expenseReports, type ExpenseReport, type ExpenseLine } from "@/db/schema";

export type ReportSummary = ExpenseReport & { total: string; lineCount: number };
export type ReportWithLines = ExpenseReport & { total: string; lines: ExpenseLine[] };

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

  return rows.map(({ report, total, lineCount }) => ({ ...report, total, lineCount }));
}

export async function getOwnReport(
  reportId: string,
  ownerId: string,
): Promise<ReportWithLines | null> {
  const report = await db.query.expenseReports.findFirst({
    where: (r, { and, eq }) => and(eq(r.id, reportId), eq(r.ownerId, ownerId)),
    with: {
      lines: { orderBy: (l, { desc }) => desc(l.incurredOn) },
    },
  });
  if (!report) return null;

  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${expenseLines.amount}), 0)` })
    .from(expenseLines)
    .where(eq(expenseLines.reportId, reportId));

  return {
    ...report,
    total,
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
