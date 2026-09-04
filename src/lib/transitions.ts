import type { ExpenseReport, Status, User } from "@/db/schema";

/**
 * The workflow engine (goal 4).
 *
 * This is the only thing in the codebase permitted to authorise a change to
 * a report's status. It is deliberately pure — no database, no session, no
 * I/O of any kind — for three reasons:
 *
 *   1. Goal 4's rules are about *who* and *from what state*, which is exactly
 *      what a function of (report, actor, action) can answer.
 *   2. Goal 7 needs a per-report verdict for a bulk action. Bulk approval is
 *      this function in a loop; a refusal has to be a value that can be
 *      collected into an array, not an exception that unwinds the batch.
 *   3. It is the one piece of this system where being wrong is expensive, and
 *      a pure function is the one piece that can be exhaustively tested
 *      without a database. See transitions.test.ts.
 *
 * A CHECK constraint cannot do this job: the rules depend on who is asking,
 * and the database cannot see the actor. See docs/schema.md.
 */

export const TRANSITION_ACTIONS = ["submit", "approve", "reject", "mark_paid"] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

export type RefusalCode =
  | "NOT_OWNER"
  | "NOT_APPROVER"
  | "SELF_APPROVAL"
  | "WRONG_STATUS"
  | "ARCHIVED"
  | "REASON_REQUIRED"
  | "NO_LINES";

export type Verdict =
  | { ok: true; from: Status; to: Status }
  | { ok: false; code: RefusalCode; message: string };

type TransitionReport = Pick<ExpenseReport, "ownerId" | "status" | "archivedAt">;
type TransitionActor = Pick<User, "id" | "role">;

type TransitionContext = {
  /** Required for "reject" — goal 4 says rejecting requires a reason. */
  reason?: string | null;
  /**
   * Number of lines on the report. Passed in rather than fetched, to keep
   * this function free of I/O. Only "submit" consults it.
   */
  lineCount?: number;
};

/** The single source of truth for the shape of the lifecycle. */
const TRANSITIONS: Record<TransitionAction, { from: Status; to: Status }> = {
  submit: { from: "draft", to: "submitted" },
  approve: { from: "submitted", to: "approved" },
  // Rejection returns the report to draft rather than parking it in a
  // `rejected` status — the reason survives as a permanent timeline event.
  // See docs/decisions.md, Decision 3.
  reject: { from: "submitted", to: "draft" },
  mark_paid: { from: "approved", to: "paid" },
};

/** "submit" is the owner's move; the other three are an approver's. */
const IS_DECISION: Record<TransitionAction, boolean> = {
  submit: false,
  approve: true,
  reject: true,
  mark_paid: true,
};

const STATUS_LABELS: Record<Status, string> = {
  draft: "a draft",
  submitted: "awaiting a decision",
  approved: "approved",
  paid: "paid",
};

const ACTION_LABELS: Record<TransitionAction, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  mark_paid: "marked as paid",
};

export function canTransition(
  report: TransitionReport,
  actor: TransitionActor,
  action: TransitionAction,
  context: TransitionContext = {},
): Verdict {
  const { from, to } = TRANSITIONS[action];
  const isOwner = report.ownerId === actor.id;

  if (IS_DECISION[action]) {
    if (actor.role !== "approver") {
      return {
        ok: false,
        code: "NOT_APPROVER",
        message: `Only an approver can mark a report ${ACTION_LABELS[action]}.`,
      };
    }
    // Checked before status on purpose. Goal 7 requires a bulk action to name
    // the reports it refused *specifically because the approver owned them*,
    // so ownership must win over any other reason that also applies.
    if (isOwner) {
      return {
        ok: false,
        code: "SELF_APPROVAL",
        message: "You submitted this report, so it needs a different approver.",
      };
    }
  } else if (!isOwner) {
    return {
      ok: false,
      code: "NOT_OWNER",
      message: "Only the report's owner can submit it.",
    };
  }

  if (report.archivedAt !== null) {
    return {
      ok: false,
      code: "ARCHIVED",
      message: "This report is archived. Restore it first.",
    };
  }

  if (report.status !== from) {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `This report is ${STATUS_LABELS[report.status]}, so it cannot be ${ACTION_LABELS[action]}.`,
    };
  }

  if (action === "reject" && !context.reason?.trim()) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "Rejecting a report requires a reason.",
    };
  }

  // Not in the brief, and a judgement call: an empty report reaching an
  // approver's queue asking for 0.00 is a defect, not a decision worth
  // making. One line to reverse if a reviewer disagrees.
  if (action === "submit" && context.lineCount === 0) {
    return {
      ok: false,
      code: "NO_LINES",
      message: "Add at least one expense line before submitting.",
    };
  }

  return { ok: true, from, to };
}
