import { describe, expect, it } from "vitest";

import { fillWeeks, weekLabel, weekStart } from "./weeks";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("weekStart", () => {
  it("returns the Monday of that week", () => {
    // 2026-09-05 is a Saturday; its week began Monday the 31st of August.
    expect(weekStart(at("2026-09-05"))).toBe("2026-08-31");
  });

  it("treats Monday as its own week start", () => {
    expect(weekStart(at("2026-08-31"))).toBe("2026-08-31");
  });

  it("puts Sunday in the week that began six days earlier, not the next one", () => {
    // The off-by-one that ISO weeks exist to cause.
    expect(weekStart(at("2026-09-06"))).toBe("2026-08-31");
  });

  it("crosses a month and a year boundary", () => {
    expect(weekStart(at("2026-01-01"))).toBe("2025-12-29");
  });
});

describe("fillWeeks", () => {
  const now = at("2026-09-05"); // week of 2026-08-31

  it("returns exactly the number of weeks asked for, oldest first", () => {
    const weeks = fillWeeks([], 8, now);
    expect(weeks).toHaveLength(8);
    expect(weeks[0].weekStart).toBe("2026-07-13");
    expect(weeks[7].weekStart).toBe("2026-08-31");
  });

  it("zero-fills weeks the query returned nothing for", () => {
    // The bug this module exists to prevent: a quiet fortnight must occupy
    // space in the chart, not vanish and slide the later bars left.
    const weeks = fillWeeks(
      [
        { weekStart: "2026-08-31", total: "15400.00" },
        { weekStart: "2026-08-10", total: "4820.00" },
      ],
      8,
      now,
    );
    expect(weeks.map((w) => w.total)).toEqual([
      "0",
      "0",
      "0",
      "0",
      "4820.00",
      "0",
      "0",
      "15400.00",
    ]);
  });

  it("ignores rows outside the window rather than shifting them in", () => {
    const weeks = fillWeeks([{ weekStart: "2020-01-06", total: "999.00" }], 8, now);
    expect(weeks.every((w) => w.total === "0")).toBe(true);
    expect(weeks).toHaveLength(8);
  });

  it("keeps amounts as strings, never summing them in JavaScript", () => {
    const weeks = fillWeeks([{ weekStart: "2026-08-31", total: "0.10" }], 1, now);
    expect(weeks[0].total).toBe("0.10");
  });
});

describe("weekLabel", () => {
  it("formats without drifting a day across time zones", () => {
    expect(weekLabel("2026-08-31")).toBe("Aug 31");
    expect(weekLabel("2026-01-05")).toBe("Jan 5");
  });
});
