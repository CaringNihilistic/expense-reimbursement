import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import {
  expenseLines,
  expenseReports,
  reportApprovers,
  reportEvents,
  users,
  type Category,
  type Status,
} from "../src/db/schema";

/**
 * Realistic demo data (session 6).
 *
 * `scripts/seed.ts` creates the eight accounts and nothing else. This adds the
 * eight weeks of history that make the application legible: a dashboard with a
 * populated chart, an approval queue with real work in it, alerts that have
 * genuinely gone stale, and reports whose timelines show rejection and
 * resubmission rather than a single tidy hop from draft to paid.
 *
 * Two constraints shape how this is written:
 *
 *   `report_events` is append-only and `expense_reports` uses ON DELETE
 *   RESTRICT, so seeded history cannot be deleted afterwards. The script is
 *   therefore guarded: it refuses to run twice unless --force is passed.
 *
 *   Every timestamp is backdated deliberately. Goal 8's chart reads the event
 *   timeline, and goal 10's alerts read `submitted_at`, so data created "now"
 *   would produce an empty chart and no alerts — a demo that technically works
 *   and shows nothing.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, hour = 10) => {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, 0, 0, 0);
  return date;
};
const dateOnly = (days: number) => ago(days).toISOString().slice(0, 10);

type LineSpec = { category: Category; description: string; amount: string; dayOffset?: number };

type ReportSpec = {
  title: string;
  owner: string;
  /** Days ago the period began. */
  period: number;
  lines: LineSpec[];
  /** Final state, and how many days ago each step happened. */
  status: Status;
  submittedDaysAgo?: number;
  decidedDaysAgo?: number;
  paidDaysAgo?: number;
  /** Approver who decided, and who is assigned. */
  decidedBy?: string;
  approvers?: string[];
  /** A rejection that happened before the current submission. */
  rejection?: { daysAgo: number; by: string; reason: string };
  comment?: { daysAgo: number; by: string; body: string };
  archived?: boolean;
};

const MEERA = "meera@northwind.test";
const RAJAT = "rajat@northwind.test";
const SANDEEP = "sandeep@northwind.test";
const AYUSH = "ayush@northwind.test";
const NEHA = "neha@northwind.test";
const TOMAS = "tomas@northwind.test";
const GRACE = "grace@northwind.test";
const WEI = "wei@northwind.test";

/**
 * Eight weeks of history. Paid reports are spread across the weeks so the
 * chart has a shape, with two deliberately quiet weeks so the zero-fill is
 * visible rather than theoretical.
 */
const REPORTS: ReportSpec[] = [
  // ---- paid, spread across the eight-week window -----------------------
  {
    title: "Chennai supplier audit",
    owner: TOMAS,
    period: 58,
    status: "paid",
    submittedDaysAgo: 54,
    decidedDaysAgo: 52,
    paidDaysAgo: 51,
    decidedBy: MEERA,
    approvers: [MEERA],
    lines: [
      { category: "travel", description: "Flight MAA return", amount: "14250.00" },
      { category: "accommodation", description: "Hotel, 3 nights", amount: "16800.00" },
      { category: "meals", description: "Meals during audit", amount: "3420.00" },
    ],
  },
  {
    title: "Q3 partner conference",
    owner: NEHA,
    period: 51,
    status: "paid",
    submittedDaysAgo: 47,
    decidedDaysAgo: 45,
    paidDaysAgo: 44,
    decidedBy: RAJAT,
    approvers: [RAJAT],
    lines: [
      { category: "travel", description: "Conference travel", amount: "9800.00" },
      { category: "other", description: "Delegate pass", amount: "22000.00" },
    ],
  },
  {
    title: "Design tooling renewal",
    owner: GRACE,
    period: 44,
    status: "paid",
    submittedDaysAgo: 40,
    decidedDaysAgo: 38,
    paidDaysAgo: 37,
    decidedBy: MEERA,
    approvers: [MEERA, RAJAT],
    lines: [{ category: "software", description: "Annual licence, 3 seats", amount: "38400.00" }],
  },
  // Week gap here on purpose — the chart must show a zero, not close up.
  {
    title: "Pune client workshop",
    owner: AYUSH,
    period: 30,
    status: "paid",
    submittedDaysAgo: 26,
    decidedDaysAgo: 24,
    paidDaysAgo: 23,
    decidedBy: MEERA,
    approvers: [MEERA],
    rejection: {
      daysAgo: 25,
      by: MEERA,
      reason: "The hotel line is missing its receipt — please attach and resubmit.",
    },
    lines: [
      { category: "travel", description: "Train, Mumbai–Pune return", amount: "2400.00" },
      { category: "accommodation", description: "Hotel, 2 nights", amount: "11200.00" },
      { category: "meals", description: "Workshop catering", amount: "6750.00" },
    ],
  },
  {
    title: "Field visit, Nashik",
    owner: WEI,
    period: 23,
    status: "paid",
    submittedDaysAgo: 19,
    decidedDaysAgo: 17,
    paidDaysAgo: 16,
    decidedBy: RAJAT,
    approvers: [RAJAT],
    lines: [
      { category: "mileage", description: "Own vehicle, 310 km", amount: "3720.00" },
      { category: "meals", description: "Site meals", amount: "1180.00" },
    ],
  },
  {
    title: "Recruitment travel",
    owner: TOMAS,
    period: 16,
    status: "paid",
    submittedDaysAgo: 12,
    decidedDaysAgo: 10,
    paidDaysAgo: 9,
    decidedBy: MEERA,
    approvers: [MEERA],
    comment: { daysAgo: 9, by: MEERA, body: "Paid in the fortnightly run." },
    lines: [
      { category: "travel", description: "Flight BLR return", amount: "12600.00" },
      { category: "meals", description: "Candidate lunches", amount: "4300.00" },
    ],
  },

  // ---- approved, awaiting payment: this is the CSV export --------------
  {
    title: "Hyderabad delivery review",
    owner: NEHA,
    period: 14,
    status: "approved",
    submittedDaysAgo: 10,
    decidedDaysAgo: 7,
    decidedBy: MEERA,
    approvers: [MEERA],
    lines: [
      { category: "travel", description: "Flight HYD return", amount: "11900.00" },
      { category: "accommodation", description: "Hotel, 2 nights", amount: "9400.00" },
    ],
  },
  {
    title: "Team laptops and peripherals",
    owner: GRACE,
    period: 12,
    status: "approved",
    submittedDaysAgo: 9,
    decidedDaysAgo: 6,
    decidedBy: RAJAT,
    approvers: [RAJAT],
    lines: [
      { category: "supplies", description: "Docking stations, 4 units", amount: "21600.00" },
      { category: "supplies", description: "Monitor arms", amount: "7350.00" },
    ],
  },
  {
    title: "Security audit engagement",
    owner: WEI,
    period: 11,
    status: "approved",
    submittedDaysAgo: 8,
    decidedDaysAgo: 5,
    decidedBy: MEERA,
    approvers: [MEERA, RAJAT],
    lines: [{ category: "other", description: "External audit fee", amount: "45000.00" }],
  },

  // ---- stale: submitted long enough to raise alerts (goal 10) ---------
  {
    title: "Kolkata trade fair",
    owner: TOMAS,
    period: 24,
    status: "submitted",
    submittedDaysAgo: 19,
    approvers: [MEERA],
    lines: [
      { category: "travel", description: "Flight CCU return", amount: "13400.00" },
      { category: "accommodation", description: "Hotel, 3 nights", amount: "14100.00" },
      { category: "meals", description: "Stand catering", amount: "5250.00" },
    ],
  },
  {
    title: "Warehouse equipment",
    owner: GRACE,
    period: 18,
    status: "submitted",
    submittedDaysAgo: 12,
    approvers: [RAJAT],
    lines: [{ category: "supplies", description: "Pallet trucks, 2 units", amount: "28800.00" }],
  },
  {
    title: "Analytics platform trial",
    owner: NEHA,
    period: 13,
    status: "submitted",
    submittedDaysAgo: 8,
    // Deliberately unassigned: dismissing its alert must be refused.
    lines: [{ category: "software", description: "Three-month trial", amount: "17250.00" }],
  },

  // ---- fresh in the queue ---------------------------------------------
  {
    title: "Customer onsite, Ahmedabad",
    owner: AYUSH,
    period: 6,
    status: "submitted",
    submittedDaysAgo: 2,
    approvers: [MEERA, RAJAT],
    lines: [
      { category: "travel", description: "Flight AMD return", amount: "10750.00" },
      { category: "meals", description: "Client dinner", amount: "3900.00" },
    ],
  },

  // ---- the segregation-of-duties demo ----------------------------------
  {
    title: "Approver's own travel claim",
    owner: SANDEEP,
    period: 9,
    status: "submitted",
    submittedDaysAgo: 6,
    approvers: [MEERA],
    comment: {
      daysAgo: 5,
      by: SANDEEP,
      body: "Raised by me — I hold the approver role, so somebody else has to decide this one.",
    },
    lines: [
      { category: "travel", description: "Flight DEL return", amount: "15300.00" },
      { category: "meals", description: "Team dinner, 6 people", amount: "8200.00" },
    ],
  },

  // ---- drafts, including one returned for changes ----------------------
  {
    title: "Mumbai office supplies",
    owner: AYUSH,
    period: 8,
    status: "draft",
    submittedDaysAgo: 5,
    rejection: {
      daysAgo: 3,
      by: RAJAT,
      reason: "Please split the software licence onto its own line before resubmitting.",
    },
    approvers: [RAJAT],
    lines: [
      { category: "supplies", description: "Stationery and consumables", amount: "4150.00" },
      { category: "software", description: "Collaboration tool, 5 seats", amount: "12500.00" },
    ],
  },
  {
    title: "September travel (in progress)",
    owner: WEI,
    period: 4,
    status: "draft",
    lines: [{ category: "travel", description: "Airport transfer", amount: "1850.00" }],
  },

  // ---- archived: present, but out of the default view ------------------
  {
    title: "Cancelled Goa offsite",
    owner: NEHA,
    period: 40,
    status: "draft",
    archived: true,
    lines: [{ category: "accommodation", description: "Deposit, refunded", amount: "9000.00" }],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const force = process.argv.includes("--force");
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  const people = await db.select().from(users);
  const byEmail = new Map(people.map((person) => [person.email, person]));
  if (byEmail.size === 0) {
    throw new Error("No accounts found. Run `npm run db:seed` first.");
  }
  const id = (email: string) => {
    const person = byEmail.get(email);
    if (!person) throw new Error(`Seed account missing: ${email}. Run \`npm run db:seed\` first.`);
    return person.id;
  };

  // report_events is append-only and reports with history cannot be deleted,
  // so running this twice would double the demo rather than replace it.
  const [{ existing }] = await db
    .select({ existing: sql<number>`count(*)::int` })
    .from(expenseReports)
    .where(eq(expenseReports.title, REPORTS[0].title));

  if (existing > 0 && !force) {
    console.log("Demo data is already present — nothing to do.");
    console.log("(report_events is append-only, so re-seeding would duplicate it.)");
    console.log("Pass --force if you genuinely want a second copy.");
    await client.end();
    return;
  }

  for (const spec of REPORTS) {
    const ownerId = id(spec.owner);

    await db.transaction(async (tx) => {
      const [report] = await tx
        .insert(expenseReports)
        .values({
          ownerId,
          title: spec.title,
          periodStart: dateOnly(spec.period),
          periodEnd: dateOnly(Math.max(0, spec.period - 4)),
          status: spec.status,
          submittedAt: spec.submittedDaysAgo != null && spec.status !== "draft"
            ? ago(spec.submittedDaysAgo)
            : null,
          decidedAt: spec.decidedDaysAgo != null ? ago(spec.decidedDaysAgo) : null,
          decidedById: spec.decidedBy ? id(spec.decidedBy) : null,
          paidAt: spec.paidDaysAgo != null ? ago(spec.paidDaysAgo) : null,
          archivedAt: spec.archived ? ago(spec.period - 2) : null,
          createdAt: ago(spec.period),
          updatedAt: ago(Math.max(0, spec.decidedDaysAgo ?? spec.submittedDaysAgo ?? spec.period)),
        })
        .returning({ id: expenseReports.id });

      await tx.insert(expenseLines).values(
        spec.lines.map((line) => ({
          reportId: report.id,
          incurredOn: dateOnly(spec.period - (line.dayOffset ?? 1)),
          amount: line.amount,
          category: line.category,
          description: line.description,
          createdAt: ago(spec.period),
        })),
      );

      if (spec.approvers?.length) {
        await tx.insert(reportApprovers).values(
          spec.approvers.map((email) => ({
            reportId: report.id,
            userId: id(email),
            assignedAt: ago(spec.period),
          })),
        );
      }

      // The timeline, in the order it actually happened.
      const events: (typeof reportEvents.$inferInsert)[] = [];

      if (spec.rejection) {
        // An earlier submission that came back, before the current one.
        events.push({
          reportId: report.id,
          actorId: ownerId,
          kind: "status_change",
          fromStatus: "draft",
          toStatus: "submitted",
          createdAt: ago(spec.rejection.daysAgo + 2),
        });
        events.push({
          reportId: report.id,
          actorId: id(spec.rejection.by),
          kind: "status_change",
          fromStatus: "submitted",
          toStatus: "draft",
          reason: spec.rejection.reason,
          createdAt: ago(spec.rejection.daysAgo),
        });
      }

      if (spec.submittedDaysAgo != null && spec.status !== "draft") {
        events.push({
          reportId: report.id,
          actorId: ownerId,
          kind: "status_change",
          fromStatus: "draft",
          toStatus: "submitted",
          createdAt: ago(spec.submittedDaysAgo),
        });
      }

      if (spec.decidedDaysAgo != null && spec.decidedBy) {
        events.push({
          reportId: report.id,
          actorId: id(spec.decidedBy),
          kind: "status_change",
          fromStatus: "submitted",
          toStatus: "approved",
          createdAt: ago(spec.decidedDaysAgo),
        });
      }

      if (spec.paidDaysAgo != null && spec.decidedBy) {
        events.push({
          reportId: report.id,
          actorId: id(spec.decidedBy),
          kind: "status_change",
          fromStatus: "approved",
          toStatus: "paid",
          createdAt: ago(spec.paidDaysAgo),
        });
      }

      if (spec.comment) {
        events.push({
          reportId: report.id,
          actorId: id(spec.comment.by),
          kind: "comment",
          body: spec.comment.body,
          createdAt: ago(spec.comment.daysAgo),
        });
      }

      if (events.length) await tx.insert(reportEvents).values(events);
    });
  }

  const [summary] = await db
    .select({
      reports: sql<number>`count(*)::int`,
      submitted: sql<number>`count(*) filter (where ${expenseReports.status} = 'submitted')::int`,
      approved: sql<number>`count(*) filter (where ${expenseReports.status} = 'approved')::int`,
      paid: sql<number>`count(*) filter (where ${expenseReports.status} = 'paid')::int`,
    })
    .from(expenseReports);

  console.log(`Seeded ${REPORTS.length} demo reports with lines, approvers and timelines.`);
  console.log(
    `Database now holds ${summary.reports} reports — ${summary.submitted} awaiting a decision, ` +
      `${summary.approved} approved and unpaid, ${summary.paid} paid.`,
  );
  console.log("\nWorth looking at:");
  console.log("  /dashboard  eight weeks of payments, with two deliberately quiet weeks");
  console.log("  /alerts     three reports past the staleness threshold, one unassigned");
  console.log("  /approvals  a queue including one report owned by an approver");

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
