import type { Metadata } from "next";

import { NavBar } from "@/components/nav-bar";
import { requireUser } from "@/lib/auth";

import { createReport } from "../actions";

export const metadata: Metadata = { title: "New report · Expense Reimbursement" };

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: "32rem" }}>
      <NavBar user={user} />

      <h1>New report</h1>

      <form action={createReport} className="card stack" style={{ marginTop: "1rem" }}>
        {error ? (
          <p className="error">Enter a title and a valid date range (end on or after start).</p>
        ) : null}

        <div>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" required autoFocus placeholder="e.g. March client travel" />
        </div>

        <div style={{ display: "flex", gap: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="periodStart">Period start</label>
            <input id="periodStart" name="periodStart" type="date" required />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="periodEnd">Period end</label>
            <input id="periodEnd" name="periodEnd" type="date" required />
          </div>
        </div>

        <button type="submit">Create report</button>
      </form>
    </main>
  );
}
