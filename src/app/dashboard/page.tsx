import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireUser } from "@/lib/auth";
import { getDashboard } from "@/lib/dashboard";
import { capitalize, formatAmount } from "@/lib/format";
import { weekLabel } from "@/lib/weeks";

export const metadata: Metadata = { title: "Dashboard · Expense Reimbursement" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ flex: "1 1 12rem" }}>
      <div className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.7rem", fontWeight: 600, lineHeight: 1.2, marginTop: "0.35rem" }}>
        {value}
      </div>
      {hint ? (
        <div className="muted" style={{ fontSize: "0.8rem" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboard(user);

  const everyone = data.scope === "everyone";
  const peak = Math.max(...data.paidPerWeek.map((w) => Number(w.total)), 1);
  const statusTotal = data.byStatus.reduce((n, slice) => n + slice.count, 0);
  const categoryPeak = Math.max(...data.byCategory.map((c) => Number(c.total)), 1);

  return (
    <main>
      <NavBar user={user} />

      <h1>Dashboard</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {everyone
          ? "Across everyone. You hold the approver role, so these are company-wide figures."
          : "Your own reports only."}
      </p>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <Stat
          label="Awaiting approval"
          value={String(data.awaitingApproval)}
          hint={data.awaitingApproval === 1 ? "report" : "reports"}
        />
        <Stat
          label="Reimbursements due"
          value={formatAmount(data.reimbursementsDue)}
          hint="approved, not yet paid"
        />
        <Stat label="Approved this week" value={String(data.approvedThisWeek)} hint="since Monday" />
        <Stat label="Paid this week" value={String(data.paidThisWeek)} hint="since Monday" />
      </div>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <div className="card" style={{ flex: "1 1 20rem" }}>
          <h2>By status</h2>
          {data.byStatus.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No reports yet.
            </p>
          ) : (
            <table>
              <tbody>
                {data.byStatus.map((slice) => (
                  <tr key={slice.status}>
                    <td>
                      <span className="pill">{slice.status}</span>
                    </td>
                    <td style={{ width: "45%" }}>
                      <div
                        className="bar"
                        style={{ width: `${Math.round((slice.count / statusTotal) * 100)}%` }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>{slice.count}</td>
                    <td style={{ textAlign: "right" }} className="muted">
                      {formatAmount(slice.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ flex: "1 1 20rem" }}>
          <h2>By category</h2>
          {data.byCategory.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No expense lines yet.
            </p>
          ) : (
            <table>
              <tbody>
                {data.byCategory.map((slice) => (
                  <tr key={slice.category}>
                    <td>{capitalize(slice.category)}</td>
                    <td style={{ width: "45%" }}>
                      <div
                        className="bar"
                        style={{ width: `${Math.round((Number(slice.total) / categoryPeak) * 100)}%` }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>{formatAmount(slice.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Reimbursements paid per week</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          The last eight weeks. A week with no payments is a zero, not a gap.
        </p>
        {/* Server-rendered bars. No charting library, and no client JavaScript
            — the whole application still ships none. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "0.6rem", height: "9rem", marginTop: "1rem" }}>
          {data.paidPerWeek.map((week) => {
            const value = Number(week.total);
            return (
              // The wrapper needs a definite height of its own, or the bar's
              // percentage height has nothing to resolve against and collapses
              // to its minimum — which is exactly what it did first time.
              <div
                key={week.weekStart}
                style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}
              >
                <div
                  title={`${weekLabel(week.weekStart)}: ${formatAmount(week.total)}`}
                  className="bar-column"
                  style={{
                    height: `${Math.max(1, Math.round((value / peak) * 100))}%`,
                    opacity: value === 0 ? 0.3 : 1,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.4rem" }}>
          {data.paidPerWeek.map((week) => (
            <div key={week.weekStart} className="muted" style={{ flex: 1, textAlign: "center", fontSize: "0.7rem" }}>
              {weekLabel(week.weekStart)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          {data.paidPerWeek.map((week) => (
            <div key={week.weekStart} style={{ flex: 1, textAlign: "center", fontSize: "0.75rem" }}>
              {Number(week.total) === 0 ? <span className="muted">—</span> : formatAmount(week.total)}
            </div>
          ))}
        </div>
      </div>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        <Link href="/reports">Browse and search all reports →</Link>
      </p>
    </main>
  );
}
