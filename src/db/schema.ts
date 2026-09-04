import { sql, relations } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Domain vocabularies
 *
 * These live as const arrays rather than Postgres enums: an enum needs a
 * migration and a table rewrite to change, a text column with a CHECK
 * constraint needs one line. Same guarantee, cheaper to evolve.
 * ------------------------------------------------------------------ */

export const ROLES = ["employee", "approver"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Note there is no "rejected" status.
 *
 * The brief says a report moves to Approved *or Rejected*, and then that a
 * rejected report "returns to Draft, where its owner can edit it and submit it
 * again". Both cannot be true of a stored value at once — if the report is
 * back in Draft, nothing is ever left sitting in Rejected.
 *
 * So rejection is modelled as an *event*, not a state: it moves the report
 * back to `draft` and writes a permanent timeline row carrying the reason. A
 * draft whose most recent event is a rejection renders as "Returned for
 * changes", which is what a user actually needs to see.
 *
 * See docs/decisions.md. Reversing this is a one-line change here plus one
 * branch in canTransition().
 */
export const STATUSES = ["draft", "submitted", "approved", "paid"] as const;
export type Status = (typeof STATUSES)[number];

export const CATEGORIES = [
  "travel",
  "meals",
  "accommodation",
  "supplies",
  "software",
  "mileage",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const EVENT_KINDS = ["status_change", "comment"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Renders a const array as a SQL `in (...)` list for CHECK constraints. */
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/* ------------------------------------------------------------------ *
 * users
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    // `$type` is the type-level half of the CHECK constraint below. Without
    // it these columns are plain `string` in TypeScript, and the domain
    // vocabularies are enforced only at the database. With it the two agree.
    role: text("role").$type<Role>().notNull().default("employee"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive uniqueness without needing the citext extension.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in (${oneOf(ROLES)})`),
  ],
);

/* ------------------------------------------------------------------ *
 * expense_reports
 *
 * There is deliberately no `total` column. Goal 3 says the total is always the
 * sum of the lines and never a value the client can set; with no column to
 * write, that is structurally true rather than merely enforced.
 * ------------------------------------------------------------------ */

export const expenseReports = pgTable(
  "expense_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").$type<Status>().notNull().default("draft"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    // Archive is a flag on any status, not a status of its own: it hides the
    // report from default views without destroying its history (goal 2).
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("expense_reports_status_check", sql`${t.status} in (${oneOf(STATUSES)})`),
    check("expense_reports_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("expense_reports_title_check", sql`length(btrim(${t.title})) > 0`),
    index("expense_reports_owner_idx").on(t.ownerId),
    index("expense_reports_status_idx").on(t.status),
    // Supports the approval queue and the stale-alert predicate (goal 10).
    index("expense_reports_submitted_idx").on(t.status, t.submittedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * expense_lines
 * ------------------------------------------------------------------ */

export const expenseLines = pgTable(
  "expense_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => expenseReports.id, { onDelete: "cascade" }),
    incurredOn: date("incurred_on").notNull(),
    // numeric, never a float. Drizzle hands this back as a string on purpose;
    // all arithmetic happens in SQL via sum(). Never parseFloat() money.
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    category: text("category").$type<Category>().notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("expense_lines_category_check", sql`${t.category} in (${oneOf(CATEGORIES)})`),
    check("expense_lines_amount_check", sql`${t.amount} > 0`),
    index("expense_lines_report_idx").on(t.reportId),
  ],
);

/* ------------------------------------------------------------------ *
 * report_approvers — the only many-to-many in the schema (goal 5)
 *
 * Assignment is routing and visibility, not permission: any approver may
 * decide any submitted report they do not own. Assignment drives the
 * "assigned to me" queue and gates alert dismissal. See docs/decisions.md.
 * ------------------------------------------------------------------ */

export const reportApprovers = pgTable(
  "report_approvers",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => expenseReports.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.userId] }),
    index("report_approvers_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * report_events — append-only (goal 9)
 *
 * Status changes and comments share one table so the timeline is a single
 * ordered query. UPDATE and DELETE are blocked by a database trigger, not by
 * application convention — see drizzle/0001_append_only_events.sql.
 *
 * The foreign key is `restrict`, not `cascade`: a report that has history can
 * never be hard-deleted, only archived. A pristine draft with no events still
 * can be.
 * ------------------------------------------------------------------ */

export const reportEvents = pgTable(
  "report_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => expenseReports.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").$type<EventKind>().notNull(),
    fromStatus: text("from_status").$type<Status>(),
    toStatus: text("to_status").$type<Status>(),
    /** Required when an approver rejects; null otherwise. */
    reason: text("reason"),
    /** The comment body; null on status changes. */
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("report_events_kind_check", sql`${t.kind} in (${oneOf(EVENT_KINDS)})`),
    // A status change carries statuses and no body; a comment is the reverse.
    check(
      "report_events_shape_check",
      sql`(${t.kind} = 'status_change' and ${t.toStatus} is not null and ${t.body} is null)
       or (${t.kind} = 'comment' and ${t.body} is not null and ${t.toStatus} is null)`,
    ),
    index("report_events_report_idx").on(t.reportId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * alert_dismissals (goal 10)
 *
 * One row per dismissal, never updated. The alert returns simply because the
 * dismissal row ages out of the snooze window — no scheduler required.
 * ------------------------------------------------------------------ */

export const alertDismissals = pgTable(
  "alert_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => expenseReports.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_dismissals_lookup_idx").on(t.reportId, t.dismissedAt)],
);

/* ------------------------------------------------------------------ *
 * Relations (for the drizzle query API)
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  reports: many(expenseReports),
  assignments: many(reportApprovers),
}));

export const expenseReportsRelations = relations(expenseReports, ({ one, many }) => ({
  owner: one(users, { fields: [expenseReports.ownerId], references: [users.id] }),
  lines: many(expenseLines),
  approvers: many(reportApprovers),
  events: many(reportEvents),
}));

export const expenseLinesRelations = relations(expenseLines, ({ one }) => ({
  report: one(expenseReports, {
    fields: [expenseLines.reportId],
    references: [expenseReports.id],
  }),
}));

export const reportApproversRelations = relations(reportApprovers, ({ one }) => ({
  report: one(expenseReports, {
    fields: [reportApprovers.reportId],
    references: [expenseReports.id],
  }),
  user: one(users, { fields: [reportApprovers.userId], references: [users.id] }),
}));

export const reportEventsRelations = relations(reportEvents, ({ one }) => ({
  report: one(expenseReports, {
    fields: [reportEvents.reportId],
    references: [expenseReports.id],
  }),
  actor: one(users, { fields: [reportEvents.actorId], references: [users.id] }),
}));

/* ------------------------------------------------------------------ *
 * Inferred types
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ExpenseReport = typeof expenseReports.$inferSelect;
export type NewExpenseReport = typeof expenseReports.$inferInsert;
export type ExpenseLine = typeof expenseLines.$inferSelect;
export type NewExpenseLine = typeof expenseLines.$inferInsert;
export type ReportEvent = typeof reportEvents.$inferSelect;
