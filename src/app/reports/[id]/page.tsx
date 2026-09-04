import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NavBar } from "@/components/nav-bar";
import { CATEGORIES } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { capitalize, formatAmount, formatDate, formatTimestamp } from "@/lib/format";
import { getOwnReport, isEditable } from "@/lib/reports";

import { addLine, archiveReport, deleteLine, restoreReport, updateLine, updateReport } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Report ${id.slice(0, 8)} · Expense Reimbursement` };
}

const ERROR_MESSAGES: Record<string, string> = {
  "1": "Enter a title and a valid date range (end on or after start).",
  line: "Check the line's fields — the amount must be greater than zero.",
  locked: "This report can no longer be edited.",
};

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;

  const report = await getOwnReport(id, user.id);
  if (!report) notFound();

  const editable = isEditable(report);

  return (
    <main>
      <NavBar user={user} />

      {error && ERROR_MESSAGES[error] ? (
        <p className="error" style={{ marginBottom: "1.5rem" }}>
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      {report.archivedAt ? (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <span className="muted">Archived on {formatTimestamp(report.archivedAt)}.</span>
            <form action={restoreReport.bind(null, report.id)}>
              <button type="submit" className="secondary">
                Restore
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>{report.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <span className="pill">{report.status}</span> · {formatDate(report.periodStart)} –{" "}
            {formatDate(report.periodEnd)} · total {formatAmount(report.total)}
          </p>
        </div>
        {!report.archivedAt ? (
          <form action={archiveReport.bind(null, report.id)}>
            <button type="submit" className="secondary">
              Archive
            </button>
          </form>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Details</h2>
        {editable ? (
          <form action={updateReport.bind(null, report.id)} className="stack">
            <div>
              <label htmlFor="title">Title</label>
              <input id="title" name="title" defaultValue={report.title} required />
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="periodStart">Period start</label>
                <input
                  id="periodStart"
                  name="periodStart"
                  type="date"
                  defaultValue={report.periodStart}
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="periodEnd">Period end</label>
                <input id="periodEnd" name="periodEnd" type="date" defaultValue={report.periodEnd} required />
              </div>
            </div>
            <div>
              <button type="submit">Save changes</button>
            </div>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {report.status === "draft"
              ? "Restore this report to edit it."
              : "This report has left Draft and can no longer be edited here."}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Expense lines</h2>

        {report.lines.length === 0 ? (
          <p className="muted">No lines yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Amount</th>
                  {editable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => {
                  const formId = `line-${line.id}`;
                  return (
                    <tr key={line.id}>
                      {editable ? (
                        <>
                          <td>
                            <input
                              form={formId}
                              type="date"
                              name="incurredOn"
                              defaultValue={line.incurredOn}
                              required
                            />
                          </td>
                          <td>
                            <select form={formId} name="category" defaultValue={line.category} required>
                              {CATEGORIES.map((category) => (
                                <option key={category} value={category}>
                                  {capitalize(category)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              form={formId}
                              name="description"
                              defaultValue={line.description}
                              required
                            />
                          </td>
                          <td style={{ width: "8rem" }}>
                            <input
                              form={formId}
                              name="amount"
                              inputMode="decimal"
                              defaultValue={line.amount}
                              required
                            />
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button form={formId} type="submit">
                              Save
                            </button>{" "}
                            <button form={`delete-${line.id}`} type="submit" className="secondary">
                              Delete
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{formatDate(line.incurredOn)}</td>
                          <td>{capitalize(line.category)}</td>
                          <td>{line.description}</td>
                          <td>{formatAmount(line.amount)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatAmount(report.total)}</td>
                  {editable ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {editable
          ? report.lines.map((line) => (
              <Fragment key={line.id}>
                <form id={`line-${line.id}`} action={updateLine.bind(null, line.id)} />
                <form id={`delete-${line.id}`} action={deleteLine.bind(null, line.id)} />
              </Fragment>
            ))
          : null}

        {editable ? (
          <form
            action={addLine.bind(null, report.id)}
            className="stack"
            style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}
          >
            <h2 style={{ fontSize: "0.95rem" }}>Add a line</h2>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 10rem" }}>
                <label htmlFor="new-incurredOn">Date</label>
                <input id="new-incurredOn" name="incurredOn" type="date" required />
              </div>
              <div style={{ flex: "1 1 10rem" }}>
                <label htmlFor="new-category">Category</label>
                <select id="new-category" name="category" defaultValue={CATEGORIES[0]} required>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {capitalize(category)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "2 1 16rem" }}>
                <label htmlFor="new-description">Description</label>
                <input id="new-description" name="description" required />
              </div>
              <div style={{ flex: "1 1 8rem" }}>
                <label htmlFor="new-amount">Amount</label>
                <input id="new-amount" name="amount" inputMode="decimal" placeholder="0.00" required />
              </div>
            </div>
            <div>
              <button type="submit">Add line</button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  );
}
