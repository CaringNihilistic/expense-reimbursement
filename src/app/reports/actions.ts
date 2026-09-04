"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { CATEGORIES, expenseLines, expenseReports, type ExpenseReport } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isEditable } from "@/lib/reports";

const ReportInput = z
  .object({
    title: z.string().trim().min(1),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ["periodEnd"] });

const LineInput = z.object({
  incurredOn: z.string().min(1),
  // Kept as a string end to end — see the "never parseFloat money" note on
  // expense_lines.amount in src/db/schema.ts. The regex is the friendly
  // front door; the database CHECK (amount > 0) is the real backstop.
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(1),
});

/** Ownership check only — no status check, since archive/restore is legal at any status. */
async function loadOwnedReport(reportId: string, ownerId: string): Promise<ExpenseReport> {
  const [report] = await db
    .select()
    .from(expenseReports)
    .where(and(eq(expenseReports.id, reportId), eq(expenseReports.ownerId, ownerId)))
    .limit(1);
  if (!report) notFound();
  return report;
}

async function loadOwnedLine(lineId: string, ownerId: string) {
  const [row] = await db
    .select({ line: expenseLines, report: expenseReports })
    .from(expenseLines)
    .innerJoin(expenseReports, eq(expenseReports.id, expenseLines.reportId))
    .where(and(eq(expenseLines.id, lineId), eq(expenseReports.ownerId, ownerId)))
    .limit(1);
  if (!row) notFound();
  return row;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export async function createReport(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ReportInput.safeParse({
    title: formData.get("title"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });
  if (!parsed.success) redirect("/reports/new?error=1");

  const [report] = await db
    .insert(expenseReports)
    .values({ ownerId: user.id, ...parsed.data })
    .returning({ id: expenseReports.id });

  revalidatePath("/reports");
  redirect(`/reports/${report.id}`);
}

export async function updateReport(reportId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const report = await loadOwnedReport(reportId, user.id);
  if (!isEditable(report)) redirect(`/reports/${reportId}?error=locked`);

  const parsed = ReportInput.safeParse({
    title: formData.get("title"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });
  if (!parsed.success) redirect(`/reports/${reportId}?error=1`);

  await db
    .update(expenseReports)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(expenseReports.id, reportId));

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  redirect(`/reports/${reportId}`);
}

export async function archiveReport(reportId: string): Promise<void> {
  const user = await requireUser();
  await loadOwnedReport(reportId, user.id);

  await db
    .update(expenseReports)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(expenseReports.id, reportId));

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  redirect(`/reports/${reportId}`);
}

export async function restoreReport(reportId: string): Promise<void> {
  const user = await requireUser();
  await loadOwnedReport(reportId, user.id);

  await db
    .update(expenseReports)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(expenseReports.id, reportId));

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  redirect(`/reports/${reportId}`);
}

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */

export async function addLine(reportId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const report = await loadOwnedReport(reportId, user.id);
  if (!isEditable(report)) redirect(`/reports/${reportId}?error=locked`);

  const parsed = LineInput.safeParse({
    incurredOn: formData.get("incurredOn"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    description: formData.get("description"),
  });
  if (!parsed.success) redirect(`/reports/${reportId}?error=line`);

  await db.insert(expenseLines).values({ reportId, ...parsed.data });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  redirect(`/reports/${reportId}`);
}

export async function updateLine(lineId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const { report } = await loadOwnedLine(lineId, user.id);
  if (!isEditable(report)) redirect(`/reports/${report.id}?error=locked`);

  const parsed = LineInput.safeParse({
    incurredOn: formData.get("incurredOn"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    description: formData.get("description"),
  });
  if (!parsed.success) redirect(`/reports/${report.id}?error=line`);

  await db.update(expenseLines).set(parsed.data).where(eq(expenseLines.id, lineId));

  revalidatePath(`/reports/${report.id}`);
  revalidatePath("/reports");
  redirect(`/reports/${report.id}`);
}

export async function deleteLine(lineId: string): Promise<void> {
  const user = await requireUser();
  const { report } = await loadOwnedLine(lineId, user.id);
  if (!isEditable(report)) redirect(`/reports/${report.id}?error=locked`);

  await db.delete(expenseLines).where(eq(expenseLines.id, lineId));

  revalidatePath(`/reports/${report.id}`);
  revalidatePath("/reports");
  redirect(`/reports/${report.id}`);
}
