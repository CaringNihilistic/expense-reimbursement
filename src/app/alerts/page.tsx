import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { listStaleAlerts } from "@/lib/alerts";
import { requireApprover } from "@/lib/auth";
import { ALERT_SNOOZE_DAYS, STALE_AFTER_DAYS } from "@/lib/constants";
import { formatAmount, formatDate, formatTimestamp } from "@/lib/format";

import { dismissAlert } from "./actions";

export const metadata: Metadata = { title: "Alerts · Expense Reimbursement" };

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; dismissed?: string }>;
}) {
  const user = await requireApprover();
  const { refused, dismissed } = await searchParams;
  const alerts = await listStaleAlerts(user.id);

  return (
    <main>
      <NavBar user={user} />

      <h1>Stale approvals</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Reports that have waited more than {STALE_AFTER_DAYS} days for a decision. Dismissing one
        hides it for {ALERT_SNOOZE_DAYS} days; if it is still undecided then, it comes back.
      </p>

      {refused ? <p className="error">{refused}</p> : null}
      {dismissed ? <div className="notice">{dismissed}</div> : null}

      {alerts.length === 0 ? (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            Nothing has been waiting longer than {STALE_AFTER_DAYS} days. Anything you have
            dismissed will reappear here if it is still undecided.
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: "1.5rem", padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Submitted by</th>
                <th>Waiting</th>
                <th>Submitted</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>
                    <Link href={`/reports/${alert.id}`}>{alert.title}</Link>
                    {alert.assignedToMe ? (
                      <>
                        {" "}
                        <span className="pill">assigned</span>
                      </>
                    ) : null}
                  </td>
                  <td className="muted">{alert.ownerName}</td>
                  <td>
                    <strong>{alert.daysWaiting} days</strong>
                  </td>
                  <td className="muted">
                    {alert.submittedAt ? formatTimestamp(alert.submittedAt) : "—"}
                  </td>
                  <td>{formatAmount(alert.total)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {alert.assignedToMe ? (
                      <form action={dismissAlert.bind(null, alert.id)}>
                        <button type="submit" className="secondary">
                          Dismiss
                        </button>
                      </form>
                    ) : (
                      <span className="muted">Not assigned to you</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: "1rem" }}>
        Thresholds come from <code>STALE_AFTER_DAYS</code> and <code>ALERT_SNOOZE_DAYS</code>.
      </p>
    </main>
  );
}
