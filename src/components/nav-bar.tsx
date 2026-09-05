import Link from "next/link";

import { logout } from "@/app/login/actions";
import type { User } from "@/db/schema";
import { countStaleAlerts } from "@/lib/alerts";
import { isApprover } from "@/lib/auth";

/**
 * An async Server Component: it fetches its own alert count rather than making
 * every page that renders it pass one down. Goal 10 asks for the badge to be
 * visible in the navigation, which means everywhere.
 */
export async function NavBar({ user }: { user: User }) {
  const approver = isApprover(user);
  const staleCount = approver ? await countStaleAlerts(user.id) : 0;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
        marginBottom: "2rem",
      }}
    >
      <nav style={{ display: "flex", gap: "1.25rem", alignItems: "baseline" }}>
        <Link href="/dashboard" style={{ fontWeight: 600, textDecoration: "none" }}>
          Expense Reimbursement
        </Link>
        {/* Not "My reports" any more: since goal 6 this list spans everyone
            the viewer may see, with owner as one filter among several. */}
        <Link href="/reports">Reports</Link>
        {/* Cosmetic only — both routes are guarded by requireApprover(). */}
        {approver ? <Link href="/approvals">Approvals</Link> : null}
        {approver ? (
          <Link href="/alerts">
            Alerts
            {staleCount > 0 ? <span className="badge">{staleCount}</span> : null}
          </Link>
        ) : null}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span className="muted">
          {user.name} · <span className="pill">{user.role}</span>
        </span>
        <form action={logout}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
