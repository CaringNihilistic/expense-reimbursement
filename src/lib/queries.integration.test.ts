import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integration tests against a real PostgreSQL.
 *
 * The other suites cover pure functions, which is where the *rules* live. This
 * one covers the queries, which is where the rules are actually enforced —
 * visibility is a `where` clause, and a `where` clause cannot be unit tested.
 * Three things are checked here because all three would fail silently:
 *
 *   1. An employee's list contains nobody else's reports, and an approver's
 *      contains everyone's *except* other people's drafts.
 *   2. A report's total does not multiply when several approvers are assigned
 *      to it — the join fan-out that produces a plausible wrong number.
 *   3. A dismissed stale alert comes back when the dismissal ages out, with
 *      nothing scheduled.
 *
 * Skipped rather than failed when DATABASE_URL is absent, so `npm test` still
 * works on a machine with no database. Fixtures create no `report_events`,
 * because that table is append-only and could not then be cleaned up.
 */

const TAG = `ITEST-${Date.now().toString(36)}`;
const hasDatabase = Boolean(process.env.DATABASE_URL);

type Mod = {
  db: typeof import("@/db")["db"];
  schema: typeof import("@/db/schema");
  searchReports: typeof import("@/lib/reports")["searchReports"];
  canView: typeof import("@/lib/reports")["canView"];
  listStaleAlerts: typeof import("@/lib/alerts")["listStaleAlerts"];
  eq: typeof import("drizzle-orm")["eq"];
  like: typeof import("drizzle-orm")["like"];
  inArray: typeof import("drizzle-orm")["inArray"];
  sql: typeof import("drizzle-orm")["sql"];
};

let m: Mod;
let approver: { id: string; role: "approver" };
let employeeA: { id: string; role: "employee" };
let employeeB: { id: string; role: "employee" };
let ids: Record<string, string> = {};

/**
 * Removes fixture reports and everything hanging off them, children first.
 * Only possible because these fixtures create no `report_events` — that table
 * is append-only, and a report with history cannot be deleted at all.
 */
async function sweep(titlePattern: string): Promise<void> {
  const doomed = await m.db
    .select({ id: m.schema.expenseReports.id })
    .from(m.schema.expenseReports)
    .where(m.like(m.schema.expenseReports.title, titlePattern));

  const reportIds = doomed.map((row) => row.id);
  if (reportIds.length === 0) return;

  await m.db
    .delete(m.schema.alertDismissals)
    .where(m.inArray(m.schema.alertDismissals.reportId, reportIds));
  await m.db
    .delete(m.schema.reportApprovers)
    .where(m.inArray(m.schema.reportApprovers.reportId, reportIds));
  await m.db
    .delete(m.schema.expenseLines)
    .where(m.inArray(m.schema.expenseLines.reportId, reportIds));
  await m.db
    .delete(m.schema.expenseReports)
    .where(m.inArray(m.schema.expenseReports.id, reportIds));
}

const search = (viewer: { id: string; role: "approver" | "employee" }, q: string) =>
  m.searchReports(viewer, {
    q,
    archived: false,
    sort: "submitted",
    dir: "desc",
    page: 1,
    perPage: 50,
  });

describe.skipIf(!hasDatabase)("queries against a real database", () => {
  beforeAll(async () => {
    const [dbMod, schemaMod, reportsMod, alertsMod, drizzle] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("@/lib/reports"),
      import("@/lib/alerts"),
      import("drizzle-orm"),
    ]);
    m = {
      db: dbMod.db,
      schema: schemaMod,
      searchReports: reportsMod.searchReports,
      canView: reportsMod.canView,
      listStaleAlerts: alertsMod.listStaleAlerts,
      eq: drizzle.eq,
      like: drizzle.like,
      inArray: drizzle.inArray,
      sql: drizzle.sql,
    };

    // Self-healing: a run that crashes before afterAll leaves fixtures behind,
    // and they would then be picked up by later searches. Sweep any stragglers
    // from previous runs before creating this run's.
    await sweep(`ITEST-%`);

    const people = await m.db.select().from(m.schema.users);
    const pick = (email: string) => {
      const person = people.find((p) => p.email === email);
      if (!person) throw new Error(`missing seed account ${email} — run npm run db:seed`);
      return person;
    };
    approver = { id: pick("meera@northwind.test").id, role: "approver" };
    employeeA = { id: pick("tomas@northwind.test").id, role: "employee" };
    employeeB = { id: pick("grace@northwind.test").id, role: "employee" };

    const day = 24 * 60 * 60 * 1000;
    const make = async (
      key: string,
      ownerId: string,
      status: "draft" | "submitted",
      submittedDaysAgo?: number,
    ) => {
      const [row] = await m.db
        .insert(m.schema.expenseReports)
        .values({
          ownerId,
          title: `${TAG} ${key}`,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-05",
          status,
          submittedAt: submittedDaysAgo ? new Date(Date.now() - submittedDaysAgo * day) : null,
        })
        .returning({ id: m.schema.expenseReports.id });
      ids[key] = row.id;
      return row.id;
    };

    await make("draft-a", employeeA.id, "draft");
    await make("submitted-a", employeeA.id, "submitted", 1);
    const fanout = await make("fanout", employeeA.id, "submitted", 1);
    await make("stale", employeeA.id, "submitted", 30);
    await make("fresh", employeeA.id, "submitted", 1);

    // Two lines totalling 300.00, and three approvers assigned. If the query
    // joined instead of sub-querying, the total would come back as 900.00.
    await m.db.insert(m.schema.expenseLines).values([
      { reportId: fanout, incurredOn: "2026-01-02", amount: "100.00", category: "travel", description: "one" },
      { reportId: fanout, incurredOn: "2026-01-03", amount: "200.00", category: "meals", description: "two" },
    ]);
    const approverIds = people.filter((p) => p.role === "approver").slice(0, 3).map((p) => p.id);
    await m.db.insert(m.schema.reportApprovers).values(
      approverIds.map((userId) => ({ reportId: fanout, userId })),
    );
    await m.db
      .insert(m.schema.reportApprovers)
      .values({ reportId: ids.stale, userId: approver.id });
  });

  afterAll(async () => {
    if (m) await sweep(`${TAG}%`);
  });

  describe("visibility is enforced in the query, not the interface", () => {
    it("shows an employee their own reports", async () => {
      const { rows } = await search(employeeA, TAG);
      expect(rows.map((r) => r.title).sort()).toContain(`${TAG} draft-a`);
    });

    it("shows another employee none of them", async () => {
      const { rows, matchCount } = await search(employeeB, TAG);
      expect(rows).toHaveLength(0);
      expect(matchCount).toBe(0);
    });

    it("shows an approver everything except other people's drafts", async () => {
      const { rows } = await search(approver, TAG);
      const titles = rows.map((r) => r.title);
      expect(titles).toContain(`${TAG} submitted-a`);
      // The draft belongs to someone else and must not appear.
      expect(titles).not.toContain(`${TAG} draft-a`);
    });

    it("agrees with canView, which the detail page uses", async () => {
      // Two implementations of one rule; they must not drift apart.
      const draft = { ownerId: employeeA.id, status: "draft" as const };
      const submitted = { ownerId: employeeA.id, status: "submitted" as const };
      expect(m.canView(draft, approver)).toBe(false);
      expect(m.canView(submitted, approver)).toBe(true);
      expect(m.canView(draft, employeeA)).toBe(true);
      expect(m.canView(submitted, employeeB)).toBe(false);
    });
  });

  describe("totals", () => {
    it("does not multiply the total by the number of assigned approvers", async () => {
      const { rows } = await search(approver, `${TAG} fanout`);
      expect(rows).toHaveLength(1);
      // Three approvers assigned; the answer is still 300, not 900.
      expect(Number(rows[0].total)).toBe(300);
    });
  });

  describe("stale alerts", () => {
    it("lists a report past the threshold and not one inside it", async () => {
      const titles = (await m.listStaleAlerts(approver.id)).map((a) => a.title);
      expect(titles).toContain(`${TAG} stale`);
      expect(titles).not.toContain(`${TAG} fresh`);
    });

    it("hides it once dismissed, and brings it back when the dismissal ages out", async () => {
      await m.db
        .insert(m.schema.alertDismissals)
        .values({ reportId: ids.stale, userId: approver.id });

      const afterDismiss = (await m.listStaleAlerts(approver.id)).map((a) => a.title);
      expect(afterDismiss).not.toContain(`${TAG} stale`);

      // Age the dismissal past ALERT_SNOOZE_DAYS. Nothing else runs — no job,
      // no flag to clear. The alert returns because the clock moved.
      await m.db
        .update(m.schema.alertDismissals)
        .set({ dismissedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
        .where(m.eq(m.schema.alertDismissals.reportId, ids.stale));

      const afterExpiry = (await m.listStaleAlerts(approver.id)).map((a) => a.title);
      expect(afterExpiry).toContain(`${TAG} stale`);
    });
  });
});
