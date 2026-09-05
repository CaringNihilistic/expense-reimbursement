import { requireApprover } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { getReimbursementsDue } from "@/lib/reports";

/**
 * Goal 7's second half: the reimbursements due — every report approved but not
 * yet paid — as a CSV.
 *
 * A Route Handler rather than a Server Action, because the answer is a file
 * with its own content type and filename, not a page. This is the one
 * deliberate exception to "Server Components read, Server Actions mutate" in
 * docs/architecture.md.
 *
 * requireApprover() runs here for the same reason it runs everywhere else: a
 * route handler is a public HTTP endpoint, and the export is the whole
 * reimbursement ledger.
 */
export async function GET(): Promise<Response> {
  await requireApprover();

  const due = await getReimbursementsDue();

  const csv = toCsv(
    [
      "Report",
      "Owner",
      "Owner email",
      "Period start",
      "Period end",
      "Submitted",
      "Approved",
      "Approved by",
      "Amount due",
    ],
    due.map((report) => [
      report.title,
      report.ownerName,
      report.ownerEmail,
      report.periodStart,
      report.periodEnd,
      report.submittedAt?.toISOString().slice(0, 10) ?? "",
      report.decidedAt?.toISOString().slice(0, 10) ?? "",
      report.decidedByName ?? "",
      report.total,
    ]),
  );

  const filename = `reimbursements-due-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // This is live financial data; it should never sit in a shared cache.
      "cache-control": "no-store",
    },
  });
}
