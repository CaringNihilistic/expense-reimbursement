/**
 * Formatting helpers for display only. Money is never summed here — every
 * total arrives pre-summed from SQL (see src/lib/reports.ts) and Number() is
 * called on the single final value just to format it, not to add anything.
 */

export function formatAmount(amount: string | number): string {
  return Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(value: string): string {
  // `value` is a Postgres `date` column, e.g. "2026-03-05" — parse it as a
  // plain calendar date rather than through `new Date()`, which would treat
  // it as UTC midnight and can roll it back a day in a negative-offset zone.
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** For `timestamptz` columns, which Drizzle returns as a real Date — unlike `date` columns. */
export function formatTimestamp(value: Date): string {
  return value.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
