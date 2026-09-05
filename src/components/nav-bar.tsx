import Link from "next/link";

import { logout } from "@/app/login/actions";
import { isApprover } from "@/lib/auth";
import type { User } from "@/db/schema";

export function NavBar({ user }: { user: User }) {
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
        {/* Cosmetic only — /approvals is guarded by requireApprover(). */}
        {isApprover(user) ? <Link href="/approvals">Approvals</Link> : null}
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
