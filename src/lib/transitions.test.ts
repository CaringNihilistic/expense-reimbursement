import { describe, expect, it } from "vitest";

import { canTransition, type TransitionAction } from "./transitions";
import type { Status } from "@/db/schema";

/**
 * The one test suite that never gets cut (docs/plan.md).
 *
 * Goal 4 is the part of this brief where being wrong is expensive: an
 * approver deciding their own report is the exact failure the scenario
 * describes. canTransition is pure, so every rule is testable here without a
 * database — which is most of why it is pure.
 */

const OWNER = { id: "owner-1", role: "employee" as const };
const APPROVER = { id: "approver-1", role: "approver" as const };
/** Sandeep: holds the approver role and also submits his own reports. */
const APPROVER_OWNER = { id: "owner-1", role: "approver" as const };

const report = (status: Status, overrides: { archivedAt?: Date | null } = {}) => ({
  ownerId: "owner-1",
  status,
  archivedAt: overrides.archivedAt ?? null,
});

const DECISIONS: TransitionAction[] = ["approve", "reject", "mark_paid"];
const reject = { reason: "Missing the hotel receipt." };

describe("submit", () => {
  it("lets the owner submit a draft that has lines", () => {
    expect(canTransition(report("draft"), OWNER, "submit", { lineCount: 2 })).toEqual({
      ok: true,
      from: "draft",
      to: "submitted",
    });
  });

  it("refuses anyone who is not the owner, approver role included", () => {
    const verdict = canTransition(report("draft"), APPROVER, "submit", { lineCount: 2 });
    expect(verdict).toMatchObject({ ok: false, code: "NOT_OWNER" });
  });

  it("refuses a report with no lines", () => {
    const verdict = canTransition(report("draft"), OWNER, "submit", { lineCount: 0 });
    expect(verdict).toMatchObject({ ok: false, code: "NO_LINES" });
  });

  it("refuses a report that is already submitted", () => {
    const verdict = canTransition(report("submitted"), OWNER, "submit", { lineCount: 2 });
    expect(verdict).toMatchObject({ ok: false, code: "WRONG_STATUS" });
  });

  it("refuses an archived draft", () => {
    const verdict = canTransition(report("draft", { archivedAt: new Date() }), OWNER, "submit", {
      lineCount: 2,
    });
    expect(verdict).toMatchObject({ ok: false, code: "ARCHIVED" });
  });
});

describe("approve and mark paid", () => {
  it("lets an approver approve someone else's submitted report", () => {
    expect(canTransition(report("submitted"), APPROVER, "approve")).toEqual({
      ok: true,
      from: "submitted",
      to: "approved",
    });
  });

  it("lets an approver mark someone else's approved report paid", () => {
    expect(canTransition(report("approved"), APPROVER, "mark_paid")).toEqual({
      ok: true,
      from: "approved",
      to: "paid",
    });
  });

  it("refuses an employee holding no approver role", () => {
    const other = { id: "employee-2", role: "employee" as const };
    expect(canTransition(report("submitted"), other, "approve")).toMatchObject({
      ok: false,
      code: "NOT_APPROVER",
    });
  });
});

describe("nobody decides their own report — goal 1 and goal 4", () => {
  it.each(DECISIONS)("refuses %s by the report's own owner", (action) => {
    const status = action === "mark_paid" ? "approved" : "submitted";
    const verdict = canTransition(report(status), APPROVER_OWNER, action, reject);
    expect(verdict).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
  });

  it("reports ownership as the reason even when the status is also wrong", () => {
    // Goal 7 needs a bulk action to name the reports refused *specifically*
    // because the approver owned them, so ownership outranks every other
    // refusal that applies at the same time.
    const verdict = canTransition(report("draft"), APPROVER_OWNER, "approve");
    expect(verdict).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
  });
});

describe("rejection", () => {
  it("returns the report to draft rather than to a rejected status", () => {
    // Decision 3: there is no stored `rejected` status.
    expect(canTransition(report("submitted"), APPROVER, "reject", reject)).toEqual({
      ok: true,
      from: "submitted",
      to: "draft",
    });
  });

  it.each([undefined, null, "", "   "])("requires a reason (%p)", (reason) => {
    const verdict = canTransition(report("submitted"), APPROVER, "reject", { reason });
    expect(verdict).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
  });
});

describe("every illegal transition is refused with a message", () => {
  const STATUSES: Status[] = ["draft", "submitted", "approved", "paid"];

  const LEGAL: Record<TransitionAction, Status> = {
    submit: "draft",
    approve: "submitted",
    reject: "submitted",
    mark_paid: "approved",
  };

  const cases = (["submit", ...DECISIONS] as TransitionAction[]).flatMap((action) =>
    STATUSES.filter((status) => status !== LEGAL[action]).map((status) => ({ action, status })),
  );

  it.each(cases)("refuses $action from $status", ({ action, status }) => {
    const actor = action === "submit" ? OWNER : APPROVER;
    const verdict = canTransition(report(status), actor, action, reject);
    expect(verdict.ok).toBe(false);
    // Goal 4: "rejected by the server with a message explaining why".
    if (!verdict.ok) expect(verdict.message.length).toBeGreaterThan(0);
  });

  it("treats paid as terminal", () => {
    for (const action of ["submit", ...DECISIONS] as TransitionAction[]) {
      const actor = action === "submit" ? OWNER : APPROVER;
      expect(canTransition(report("paid"), actor, action, reject).ok).toBe(false);
    }
  });
});
