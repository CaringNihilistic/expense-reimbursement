/**
 * What counts as a valid money amount, in one place.
 *
 * This exists because the validator and the database disagreed. The column is
 * `numeric(12, 2)` with a CHECK that the amount is positive, but the input
 * regex accepted `0` and accepted any number of digits — so both were rejected
 * by Postgres *after* passing validation, which surfaces as an unhandled 500
 * rather than "check this field". A form should refuse what the database would
 * refuse, and say so.
 *
 * The comparison against zero deliberately avoids parsing to a number: a
 * decimal string is greater than zero exactly when it contains a non-zero
 * digit, which is exact for any length. See the note on expense_lines.amount
 * in src/db/schema.ts.
 */

/** `numeric(12, 2)` — twelve significant digits, two after the point. */
export const MAX_INTEGER_DIGITS = 10;
export const MAX_DECIMAL_PLACES = 2;

const SHAPE = new RegExp(`^\\d{1,${MAX_INTEGER_DIGITS}}(\\.\\d{1,${MAX_DECIMAL_PLACES}})?$`);

export function isValidAmount(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!SHAPE.test(value)) return false;
  return /[1-9]/.test(value);
}

/** The largest amount the column can hold, for use in messages. */
export const MAX_AMOUNT = `${"9".repeat(MAX_INTEGER_DIGITS)}.99`;
