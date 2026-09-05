/**
 * RFC 4180 CSV, with one addition that matters for this application.
 *
 * Report titles and line descriptions are user input, and this file is meant
 * to be opened in Excel or Sheets. A cell beginning `=`, `+`, `-` or `@` is
 * treated as a *formula* by both, so a title like `=HYPERLINK(...)` becomes
 * executable content in finance's spreadsheet. Prefixing such cells with an
 * apostrophe is the standard mitigation and is invisible once opened.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let cell = String(value);
  if (FORMULA_START.test(cell)) cell = `'${cell}`;

  // Quote when the cell contains a delimiter, a quote or a newline — and also
  // when it has surrounding whitespace, which some parsers otherwise trim.
  if (NEEDS_QUOTING.test(cell) || cell !== cell.trim()) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  // CRLF per RFC 4180; Excel is happier with it than with bare LF.
  return `${lines.join("\r\n")}\r\n`;
}
