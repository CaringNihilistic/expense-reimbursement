"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { alertDismissals } from "@/db/schema";
import { requireApprover } from "@/lib/auth";
import { isAssignedTo } from "@/lib/alerts";
import { ALERT_SNOOZE_DAYS } from "@/lib/constants";

/**
 * Dismissing an alert inserts a timestamped row; it never updates one.
 *
 * That is what makes goal 10's "the alert returns" free: there is no flag to
 * unset, so nothing has to remember to unset it. The row simply ages out of
 * the snooze window and the alert reappears at the next read.
 */
export async function dismissAlert(reportId: string): Promise<void> {
  const actor = await requireApprover();

  // Goal 10 permits dismissal only "for a report assigned to them".
  if (!(await isAssignedTo(reportId, actor.id))) {
    redirect(
      `/alerts?refused=${encodeURIComponent(
        "You can only dismiss alerts for reports assigned to you.",
      )}`,
    );
  }

  await db.insert(alertDismissals).values({ reportId, userId: actor.id });

  revalidatePath("/alerts");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  redirect(
    `/alerts?dismissed=${encodeURIComponent(
      `Hidden for ${ALERT_SNOOZE_DAYS} days. If it is still undecided then, it will come back.`,
    )}`,
  );
}
