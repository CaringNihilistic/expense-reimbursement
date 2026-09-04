"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  expenseLines,
  expenseReports,
  reportApprovers,
  reportEvents,
  users,
  type ExpenseReport,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canView, isEditable } from "@/lib/reports";
import { canTransition, type TransitionAction, type Verdict } from "@/lib/transitions";

/**
 * The write half of the workflow engine (goals 4 and 9).
 *
 * Every decision here follows the same three steps: load, ask canTransition,
 * and — only if it said yes — perform exactly two writes inside one
 * transaction. The status change and its timeline row commit together or not
 * at all, because a status change missing from the timeline would make goal 9
 * a lie.
 */

async function loadReport(reportId: string): Promise<ExpenseReport> {
  const [report] = await db
    .select()
    .from(expenseReports)
    .where(eq(expenseReports.id, reportId))
    .limit(1);
  if (!report) notFound();
  return report;
}

/**
 * A refusal is shown to the user, not swallowed. Goal 4 asks for "a message
 * explaining why", and the message canTransition produced is that message —
 * carried in the URL so a Server Component can render it. It is our own text,
 * never user input.
 */
function refuse(reportId: string, verdict: Extract<Verdict, { ok: false }>): never {
  redirect(`/reports/${reportId}?refused=${encodeURIComponent(verdict.message)}`);
}

/** The column updates that accompany each transition. */
function statusPatch(action: TransitionAction, actorId: string) {
  const now = new Date();
  switch (action) {
    case "submit":
      return { status: "submitted" as const, submittedAt: now, updatedAt: now };
    case "approve":
      return {
        status: "approved" as const,
        decidedAt: now,
        decidedById: actorId,
        updatedAt: now,
      };
    case "reject":
      // Back to draft, and submittedAt is cleared so the column means exactly
      // one thing: "currently submitted, since". Goal 10's stale-alert
      // predicate reads it, and the history of past submissions lives in the
      // timeline, which cannot be rewritten.
      return { status: "draft" as const, submittedAt: null, updatedAt: now };
    case "mark_paid":
      return { status: "paid" as const, paidAt: now, updatedAt: now };
  }
}

async function transition(
  reportId: string,
  action: TransitionAction,
  options: { reason?: string } = {},
): Promise<void> {
  const actor = await requireUser();
  const report = await loadReport(reportId);

  // Only "submit" needs the line count, so only "submit" pays for the query.
  let lineCount: number | undefined;
  if (action === "submit") {
    const [row] = await db
      .select({ value: count() })
      .from(expenseLines)
      .where(eq(expenseLines.reportId, reportId));
    lineCount = row.value;
  }

  const verdict = canTransition(report, actor, action, { reason: options.reason, lineCount });
  if (!verdict.ok) refuse(reportId, verdict);

  await db.transaction(async (tx) => {
    await tx
      .update(expenseReports)
      .set(statusPatch(action, actor.id))
      .where(eq(expenseReports.id, reportId));

    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor.id,
      kind: "status_change",
      fromStatus: verdict.from,
      toStatus: verdict.to,
      reason: options.reason?.trim() || null,
    });
  });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  revalidatePath("/approvals");

  // Rejecting returns the report to draft, and a draft is visible only to its
  // owner — so an approver who has just rejected something can no longer see
  // the page they acted on. Send them back to the queue rather than to a 404.
  // Asking canView keeps this correct if the visibility rule ever changes.
  const stillVisible = canView({ ownerId: report.ownerId, status: verdict.to }, actor);
  redirect(stillVisible ? `/reports/${reportId}` : "/approvals");
}

/* ------------------------------------------------------------------ *
 * The four transitions
 * ------------------------------------------------------------------ */

export async function submitReport(reportId: string): Promise<void> {
  await transition(reportId, "submit");
}

export async function approveReport(reportId: string): Promise<void> {
  await transition(reportId, "approve");
}

export async function markPaid(reportId: string): Promise<void> {
  await transition(reportId, "mark_paid");
}

export async function rejectReport(reportId: string, formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "");
  await transition(reportId, "reject", { reason });
}

/* ------------------------------------------------------------------ *
 * Comments (goal 9)
 * ------------------------------------------------------------------ */

const CommentInput = z.object({ body: z.string().trim().min(1).max(2000) });

export async function addComment(reportId: string, formData: FormData): Promise<void> {
  const actor = await requireUser();
  const report = await loadReport(reportId);
  // Anyone who may read the report may comment on it: goal 9 says the
  // timeline carries comments "left by the owner or an approver".
  if (!canView(report, actor)) notFound();

  const parsed = CommentInput.safeParse({ body: formData.get("body") });
  if (!parsed.success) redirect(`/reports/${reportId}?refused=${encodeURIComponent("A comment cannot be empty.")}`);

  await db.insert(reportEvents).values({
    reportId,
    actorId: actor.id,
    kind: "comment",
    body: parsed.data.body,
  });

  revalidatePath(`/reports/${reportId}`);
  redirect(`/reports/${reportId}`);
}

/* ------------------------------------------------------------------ *
 * Assigned approvers (goal 5)
 * ------------------------------------------------------------------ */

export async function setApprovers(reportId: string, formData: FormData): Promise<void> {
  const actor = await requireUser();
  const report = await loadReport(reportId);
  if (report.ownerId !== actor.id) notFound();
  if (!isEditable(report)) {
    redirect(
      `/reports/${reportId}?refused=${encodeURIComponent(
        "Approvers can only be changed while the report is a draft.",
      )}`,
    );
  }

  const requested = formData
    .getAll("approverIds")
    .map(String)
    .filter((id) => z.string().uuid().safeParse(id).success);

  // Never trust the checkbox list: re-read which of those users actually hold
  // the approver role. A crafted POST cannot assign an employee.
  const eligible = requested.length
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, requested), eq(users.role, "approver")))
    : [];

  await db.transaction(async (tx) => {
    await tx.delete(reportApprovers).where(eq(reportApprovers.reportId, reportId));
    if (eligible.length) {
      await tx
        .insert(reportApprovers)
        .values(eligible.map(({ id }) => ({ reportId, userId: id })));
    }
  });

  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/approvals");
  redirect(`/reports/${reportId}`);
}
