import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NavBar } from "@/components/nav-bar";
import { Timeline } from "@/components/timeline";
import { CATEGORIES } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { capitalize, formatAmount, formatDate, formatTimestamp } from "@/lib/format";
import {
  getAssignedApprovers,
  getTimeline,
  getVisibleReport,
  isEditable,
  listApprovers,
} from "@/lib/reports";
import { canTransition } from "@/lib/transitions";

import { addLine, archiveReport, deleteLine, restoreReport, updateLine, updateReport } from "../actions";
import {
  addComment,
  approveReport,
  markPaid,
  rejectReport,
  setApprovers,
  submitReport,
} from "../workflow";

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
  searchParams: Promise<{ error?: string; refused?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error, refused } = await searchParams;

  const report = await getVisibleReport(id, user);
  if (!report) notFound();

  const isOwner = report.ownerId === user.id;
  const canEdit = isOwner && isEditable(report);

  const [events, assigned, assignable] = await Promise.all([
    getTimeline(id),
    getAssignedApprovers(id),
    canEdit ? listApprovers() : Promise.resolve([]),
  ]);

  // The UI asks exactly the function the server will ask, so a button appears
  // only when the action behind it would actually be allowed.
  //
  // Submit is gated in two parts on purpose. Ownership, status and archiving
  // decide whether the button exists at all; the "needs at least one line"
  // rule does not, because hiding the button would hide the reason with it.
  // The button shows, the hint explains, and the server refuses either way.
  const submitGate = canTransition(report, user, "submit");
  const submitVerdict = canTransition(report, user, "submit", { lineCount: report.lines.length });
  const maySubmit = submitGate.ok;
  const mayApprove = canTransition(report, user, "approve").ok;
  // A placeholder reason, so the form is offered on every ground except the
  // one the form itself exists to collect.
  const mayReject = canTransition(report, user, "reject", { reason: "?" }).ok;
  const mayPay = canTransition(report, user, "mark_paid").ok;
  const hasDecision = mayApprove || mayReject || mayPay;

  // There is no stored `rejected` status (Decision 3): a draft is "returned
  // for changes" when its most recent status change was a rejection. Events
  // are newest first, so the first status change found is the latest one.
  const lastStatusChange = events.find((event) => event.kind === "status_change");
  const returned =
    report.status === "draft" &&
    lastStatusChange?.fromStatus === "submitted" &&
    lastStatusChange?.toStatus === "draft";

  return (
    <main>
      <NavBar user={user} />

      {refused ? (
        <p className="error" style={{ marginBottom: "1.5rem" }}>
          {refused}
        </p>
      ) : null}

      {error && ERROR_MESSAGES[error] ? (
        <p className="error" style={{ marginBottom: "1.5rem" }}>
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      {returned ? (
        <div className="notice" style={{ marginBottom: "1.5rem" }}>
          <strong>Returned for changes.</strong>{" "}
          {lastStatusChange?.reason ? lastStatusChange.reason : null}{" "}
          <span className="muted">Edit it and submit again.</span>
        </div>
      ) : null}

      {report.archivedAt ? (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <span className="muted">Archived on {formatTimestamp(report.archivedAt)}.</span>
            {isOwner ? (
              <form action={restoreReport.bind(null, report.id)}>
                <button type="submit" className="secondary">
                  Restore
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>{report.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <span className="pill">{returned ? "returned" : report.status}</span> ·{" "}
            {isOwner ? null : <>{report.ownerName} · </>}
            {formatDate(report.periodStart)} – {formatDate(report.periodEnd)} · total{" "}
            {formatAmount(report.total)}
          </p>
        </div>
        {isOwner && !report.archivedAt ? (
          <form action={archiveReport.bind(null, report.id)}>
            <button type="submit" className="secondary">
              Archive
            </button>
          </form>
        ) : null}
      </div>

      {maySubmit || hasDecision ? (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2>{isOwner ? "Ready to submit" : "Your decision"}</h2>

          {maySubmit ? (
            <form action={submitReport.bind(null, report.id)}>
              <p className="muted" style={{ marginTop: 0 }}>
                {submitVerdict.ok
                  ? "Once submitted the report is locked for editing until an approver decides on it."
                  : submitVerdict.message}
              </p>
              <button type="submit">Submit for approval</button>
            </form>
          ) : null}

          {mayApprove || mayPay ? (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {mayApprove ? (
                <form action={approveReport.bind(null, report.id)}>
                  <button type="submit">Approve</button>
                </form>
              ) : null}
              {mayPay ? (
                <form action={markPaid.bind(null, report.id)}>
                  <button type="submit">Mark as paid</button>
                </form>
              ) : null}
            </div>
          ) : null}

          {mayReject ? (
            <form
              action={rejectReport.bind(null, report.id)}
              className="stack"
              style={{ marginTop: "1rem" }}
            >
              <div>
                <label htmlFor="reason">Reason for rejection (required)</label>
                <input id="reason" name="reason" required placeholder="What needs to change?" />
              </div>
              <div>
                <button type="submit" className="secondary">
                  Reject and return to draft
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Details</h2>
        {canEdit ? (
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
            {!isOwner
              ? `Submitted by ${report.ownerName}.`
              : report.archivedAt
                ? "Restore this report to edit it."
                : "This report has left Draft and can no longer be edited."}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Approvers</h2>
        {canEdit ? (
          <form action={setApprovers.bind(null, report.id)} className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Assigning approvers routes this report into their queue. Any approver other than you
              can still decide on it.
            </p>
            {assignable.filter((approver) => approver.id !== report.ownerId).length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No other approvers exist yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {assignable
                  .filter((approver) => approver.id !== report.ownerId)
                  .map((approver) => (
                    <label
                      key={approver.id}
                      style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "inherit" }}
                    >
                      <input
                        type="checkbox"
                        name="approverIds"
                        value={approver.id}
                        defaultChecked={assigned.some((a) => a.id === approver.id)}
                        style={{ width: "auto" }}
                      />
                      {approver.name} <span className="muted">{approver.email}</span>
                    </label>
                  ))}
              </div>
            )}
            <div>
              <button type="submit" className="secondary">
                Save approvers
              </button>
            </div>
          </form>
        ) : assigned.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody is assigned. Any approver may still decide on this report.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {assigned.map((approver) => approver.name).join(", ")}
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
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => {
                  const formId = `line-${line.id}`;
                  return (
                    <tr key={line.id}>
                      {canEdit ? (
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
                  {canEdit ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {canEdit
          ? report.lines.map((line) => (
              <Fragment key={line.id}>
                <form id={`line-${line.id}`} action={updateLine.bind(null, line.id)} />
                <form id={`delete-${line.id}`} action={deleteLine.bind(null, line.id)} />
              </Fragment>
            ))
          : null}

        {canEdit ? (
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

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>History</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Every status change and comment, permanently. Nothing here can be edited or deleted.
        </p>

        <form action={addComment.bind(null, report.id)} className="stack" style={{ marginBottom: "1.5rem" }}>
          <div>
            <label htmlFor="body">Add a comment</label>
            <textarea id="body" name="body" rows={2} required maxLength={2000} />
          </div>
          <div>
            <button type="submit" className="secondary">
              Comment
            </button>
          </div>
        </form>

        <Timeline events={events} />
      </div>
    </main>
  );
}
