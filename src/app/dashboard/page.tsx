import type { Metadata } from "next";

import { logout } from "@/app/login/actions";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard · Expense Reimbursement" };

/**
 * Session 1 placeholder. Its only job is to prove the whole auth loop works
 * end to end: cookie set, cookie verified, user loaded from Postgres, guard
 * enforced on the server. The real dashboard (goal 8) lands in session 5.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>Signed in as {user.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {user.email} · <span className="pill">{user.role}</span>
          </p>
        </div>
        <form action={logout}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: "2rem" }}>
        <h2>Session 1 complete</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Accounts, roles, the six tables, the append-only trigger and a deployable app. What is
          still to come:
        </p>
        <ul className="muted" style={{ marginBottom: 0 }}>
          <li>Session 2 — expense reports and lines, archive and restore</li>
          <li>Session 3 — the workflow engine, timeline and assigned approvers</li>
          <li>Session 4 — server-side search, bulk decisions and CSV export</li>
          <li>Session 5 — dashboard metrics and stale-approval alerts</li>
          <li>Session 6 — realistic seed data, hardening and the docs</li>
        </ul>
      </div>
    </main>
  );
}
