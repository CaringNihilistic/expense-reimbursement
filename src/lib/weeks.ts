/**
 * Week bucketing for goal 8's eight-week chart.
 *
 * This is separated from the query because the interesting failure is not in
 * the SQL. `group by date_trunc('week', …)` returns rows only for weeks that
 * *have* data, so a quiet fortnight silently disappears from the chart and the
 * remaining bars slide left — a chart that looks fine and lies about the shape
 * of the trend. Filling the gaps is the part worth testing.
 *
 * Weeks are Monday-based, matching Postgres's `date_trunc('week', …)`.
 */

export type WeekBucket = { weekStart: string; total: string };

/** Monday 00:00 UTC of the week containing `date`, as YYYY-MM-DD. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): Sunday is 0, so Sunday belongs to the week that began 6 days ago.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns exactly `count` consecutive weeks ending with the week containing
 * `now`, oldest first, with zeroes where the data had nothing.
 *
 * Amounts stay strings: they arrive from SQL as `numeric` and are only ever
 * displayed. Nothing here adds them up — see the note on expense_lines.amount
 * in src/db/schema.ts.
 */
export function fillWeeks(
  rows: readonly { weekStart: string; total: string }[],
  count: number,
  now: Date,
): WeekBucket[] {
  const found = new Map(rows.map((row) => [row.weekStart, row.total]));

  const current = new Date(`${weekStart(now)}T00:00:00Z`);
  const buckets: WeekBucket[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const week = new Date(current);
    week.setUTCDate(week.getUTCDate() - i * 7);
    const key = week.toISOString().slice(0, 10);
    buckets.push({ weekStart: key, total: found.get(key) ?? "0" });
  }

  return buckets;
}

/** Short axis label, e.g. "4 Aug". */
export function weekLabel(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
