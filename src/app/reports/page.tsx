import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireUser } from "@/lib/auth";
import { formatAmount, formatDate } from "@/lib/format";
import { listOwnReports } from "@/lib/reports";

export const metadata: Metadata = { title: "My reports · Expense Reimbursement" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requireUser();
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const reports = await listOwnReports(user.id, { archived: showArchived });

  return (
    <main>
      <NavBar user={user} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <h1>My reports</h1>
        <Link href="/reports/new" className="button-link">
          New report
        </Link>
      </div>

      <div className="muted" style={{ margin: "0.5rem 0 1.5rem" }}>
        <Link href="/reports">Active</Link>
        {" · "}
        <Link href="/reports?archived=1">Archived</Link>
        {" — viewing "}
        {showArchived ? "archived" : "active"}
      </div>

      {reports.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {showArchived
              ? "No archived reports."
              : "No reports yet. Create one to get started."}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Period</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <Link href={`/reports/${report.id}`}>{report.title}</Link>
                  </td>
                  <td className="muted">
                    {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                  </td>
                  <td>
                    {/* No stored `rejected` status — Decision 3. A draft whose
                        last status change was a rejection reads as returned. */}
                    <span className="pill">
                      {report.returnedForChanges ? "returned" : report.status}
                    </span>
                  </td>
                  <td className="muted">{report.lineCount}</td>
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
