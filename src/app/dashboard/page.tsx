import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard · Expense Reimbursement" };

/**
 * Placeholder landing page. The real dashboard (goal 8 — headline numbers,
 * status/category breakdowns, the eight-week paid-per-week chart) lands in
 * session 5, once there is a workflow producing decided and paid reports to
 * summarise.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main>
      <NavBar user={user} />

      <h1>Welcome, {user.name.split(" ")[0]}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {user.email}
      </p>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Reports</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Create expense reports and add line items. The list searches by title and filters by
          status, owner and assigned approver — an employee sees only their own, an approver sees
          everything that has left draft.
        </p>
        <Link href="/reports" className="button-link">
          Go to reports
        </Link>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Build status</h2>
        <ul className="muted" style={{ marginBottom: 0 }}>
          <li>Session 1 — accounts, roles, schema, auth ✓</li>
          <li>Session 2 — expense reports and lines, archive and restore ✓</li>
          <li>Session 3 — the workflow engine, timeline and assigned approvers</li>
          <li>Session 4 — server-side search, bulk decisions and CSV export</li>
          <li>Session 5 — dashboard metrics and stale-approval alerts</li>
          <li>Session 6 — realistic seed data, hardening and the docs</li>
        </ul>
      </div>
    </main>
  );
}
