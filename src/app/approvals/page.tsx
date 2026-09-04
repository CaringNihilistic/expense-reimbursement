import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireApprover } from "@/lib/auth";
import { formatAmount, formatDate, formatTimestamp } from "@/lib/format";
import { listApprovalQueue } from "@/lib/reports";

export const metadata: Metadata = { title: "Approvals · Expense Reimbursement" };

/**
 * Goal 5: every approver sees the full queue of reports awaiting a decision,
 * and can filter it down to the ones assigned to them.
 *
 * requireApprover() is the guard, and it runs here rather than in middleware
 * for the reasons in docs/architecture.md. Reports the viewer owns are listed
 * too — assignment is routing, not permission (Decision 6) — and the decision
 * itself is refused per report by canTransition.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ assigned?: string }>;
}) {
  const user = await requireApprover();
  const { assigned } = await searchParams;
  const assignedOnly = assigned === "1";

  const reports = await listApprovalQueue(user.id, { assignedOnly });

  return (
    <main>
      <NavBar user={user} />

      <h1>Awaiting a decision</h1>

      <div className="muted" style={{ margin: "0.5rem 0 1.5rem" }}>
        <Link href="/approvals">Everything</Link>
        {" · "}
        <Link href="/approvals?assigned=1">Assigned to me</Link>
        {" — viewing "}
        {assignedOnly ? "reports assigned to you" : "every submitted report"}
      </div>

      {reports.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {assignedOnly
              ? "Nothing is assigned to you right now."
              : "Nothing is waiting for a decision."}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Submitted by</th>
                <th>Period</th>
                <th>Submitted</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <Link href={`/reports/${report.id}`}>{report.title}</Link>
                    {report.assignedToMe ? (
                      <>
                        {" "}
                        <span className="pill">assigned</span>
                      </>
                    ) : null}
                    {report.ownerId === user.id ? (
                      <>
                        {" "}
                        <span className="pill">yours</span>
                      </>
                    ) : null}
                  </td>
                  <td className="muted">{report.ownerName}</td>
                  <td className="muted">
                    {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                  </td>
                  <td className="muted">
                    {report.submittedAt ? formatTimestamp(report.submittedAt) : "—"}
                  </td>
                  <td>{formatAmount(report.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
