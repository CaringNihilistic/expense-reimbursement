"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenseReports, reportEvents } from "@/db/schema";
import { requireApprover } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canTransition, type TransitionAction } from "@/lib/transitions";
import { encodeBulkResult, type BulkOutcome } from "@/lib/bulk-result";

/**
 * Goal 7. Bulk approve and bulk reject.
 *
 * This is the payoff for Decision 8. Because canTransition returns a verdict
 * rather than throwing, the loop below is unremarkable: ask about each report,
 * write the ones that passed, and collect every answer. A refusal does not
 * abort the batch, which is the whole requirement — the approver may own one
 * of the selected reports, and that one must be named while the rest go
 * through.
 *
 * Each report gets its own transaction. One failing write must not roll back
 * decisions that legitimately succeeded.
 */

/** Bounded so the result, which travels in the URL, cannot grow unbounded. */
const MAX_SELECTION = 25;

async function bulk(action: Extract<TransitionAction, "approve" | "reject">, formData: FormData) {
  const actor = await requireApprover();

  const ids = [...new Set(formData.getAll("reportIds").map(String))]
    .filter(isUuid)
    .slice(0, MAX_SELECTION);
  const reason = String(formData.get("reason") ?? "");

  if (ids.length === 0) {
    redirect(`/approvals?refused=${encodeURIComponent("Select at least one report first.")}`);
  }

  const reports = await db.select().from(expenseReports).where(inArray(expenseReports.id, ids));
  const byId = new Map(reports.map((report) => [report.id, report]));

  const outcomes: BulkOutcome[] = [];

  for (const id of ids) {
    const report = byId.get(id);
    if (!report) {
      outcomes.push({ title: id, ok: false, code: "NOT_FOUND", message: "No such report." });
      continue;
    }

    const verdict = canTransition(report, actor, action, { reason });
    if (!verdict.ok) {
      outcomes.push({ title: report.title, ok: false, code: verdict.code, message: verdict.message });
      continue;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(expenseReports)
        .set(
          action === "approve"
            ? { status: "approved", decidedAt: now, decidedById: actor.id, updatedAt: now }
            : { status: "draft", submittedAt: null, updatedAt: now },
        )
        .where(eq(expenseReports.id, id));

      await tx.insert(reportEvents).values({
        reportId: id,
        actorId: actor.id,
        kind: "status_change",
        fromStatus: verdict.from,
        toStatus: verdict.to,
        reason: action === "reject" ? reason.trim() : null,
      });
    });

    outcomes.push({ title: report.title, ok: true });
  }

  revalidatePath("/approvals");
  revalidatePath("/reports");
  redirect(`/approvals?result=${encodeBulkResult({ action, outcomes })}`);
}

export async function bulkApprove(formData: FormData): Promise<void> {
  await bulk("approve", formData);
}

export async function bulkReject(formData: FormData): Promise<void> {
  await bulk("reject", formData);
}
