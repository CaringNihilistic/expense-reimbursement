import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireApprover } from "@/lib/auth";
import { decodeBulkResult, summarise } from "@/lib/bulk-result";
import { formatAmount, formatDate, formatTimestamp } from "@/lib/format";
import { listApprovalQueue } from "@/lib/reports";

import { bulkApprove, bulkReject } from "./bulk";

export const metadata: Metadata = { title: "Approvals · Expense Reimbursement" };

/**
 * Goal 5's queue and goal 7's bulk decisions.
 *
 * requireApprover() is the guard, and it runs here rather than in middleware
 * for the reasons in docs/architecture.md. Reports the viewer owns are listed
 * too — assignment is routing, not permission (Decision 6) — and are
 * deliberately selectable, because the per-report refusal goal 7 asks for is
 * only demonstrable if you can select one.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ assigned?: string; result?: string; refused?: string }>;
}) {
  const user = await requireApprover();
  const { assigned, result, refused } = await searchParams;
  const assignedOnly = assigned === "1";

  const reports = await listApprovalQueue(user.id, { assignedOnly });

  // Rendered purely from the URL — see src/lib/bulk-result.ts for why this
  // deliberately does not look anything up.
  const bulk = decodeBulkResult(result);
  const counts = bulk ? summarise(bulk) : null;

  return (
    <main>
      <NavBar user={user} />

      <h1>Awaiting a decision</h1>

      {refused ? (
        <p className="error" style={{ marginTop: "1rem" }}>
          {refused}
        </p>
      ) : null}

      {bulk && counts ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2>
            {bulk.action === "approve" ? "Bulk approval" : "Bulk rejection"} — {counts.approved}{" "}
            {bulk.action === "approve" ? "approved" : "returned"}, {counts.refused} refused
          </h2>
          {counts.selfOwned > 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              {counts.selfOwned === 1 ? "One report was" : `${counts.selfOwned} reports were`} refused
              because you submitted {counts.selfOwned === 1 ? "it" : "them"} yourself.
            </p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {bulk.outcomes.map((outcome, index) => (
                <tr key={`${outcome.title}-${index}`}>
                  <td>{outcome.title}</td>
                  <td>
                    {outcome.ok ? (
                      <span className="pill">{bulk.action === "approve" ? "approved" : "returned"}</span>
                    ) : (
                      <>
                        <span className="pill">refused</span> <span>{outcome.message}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginBottom: 0 }}>
            <Link href={assignedOnly ? "/approvals?assigned=1" : "/approvals"}>Dismiss</Link>
          </p>
        </div>
      ) : null}

      <div className="muted" style={{ margin: "1rem 0 1.5rem" }}>
        <Link href="/approvals">Everything</Link>
        {" · "}
        <Link href="/approvals?assigned=1">Assigned to me</Link>
        {" · "}
        <a href="/exports/reimbursements-due">Export reimbursements due (CSV)</a>
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
        <form action={bulkApprove}>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th />
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
                      <input
                        type="checkbox"
                        name="reportIds"
                        value={report.id}
                        aria-label={`Select ${report.title}`}
                        style={{ width: "auto" }}
                      />
                    </td>
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

          <div className="card stack" style={{ marginTop: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Decide on the selected reports</h2>
            <p className="muted" style={{ margin: 0 }}>
              Every report is checked individually. Any you submitted yourself will be refused by
              name, and the rest still go through.
            </p>
            <div>
              <label htmlFor="reason">Reason (required to reject)</label>
              <input id="reason" name="reason" placeholder="What needs to change?" />
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button type="submit">Approve selected</button>
              <button type="submit" formAction={bulkReject} className="secondary">
                Reject selected
              </button>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
