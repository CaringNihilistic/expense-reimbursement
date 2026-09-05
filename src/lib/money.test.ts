import { describe, expect, it } from "vitest";

import { MAX_AMOUNT, isValidAmount } from "./money";

describe("isValidAmount", () => {
  it.each(["1", "0.01", "120.50", "9999999999.99", MAX_AMOUNT, "10.5", "007"])(
    "accepts %s",
    (value) => {
      expect(isValidAmount(value)).toBe(true);
    },
  );

  describe("rejects what the database would reject", () => {
    // Each of these previously passed validation and then failed in Postgres,
    // which surfaces as a 500 rather than a message on the field.
    it.each([
      ["zero", "0"],
      ["zero with decimals", "0.00"],
      ["zero, many decimals", "0.0"],
      ["more digits than numeric(12,2) holds", "99999999999.99"],
      ["far more digits", "99999999999999.99"],
    ])("rejects %s", (_label, value) => {
      expect(isValidAmount(value)).toBe(false);
    });
  });

  describe("rejects malformed input", () => {
    it.each([
      ["negative", "-5"],
      ["three decimal places", "1.999"],
      ["empty", ""],
      ["a word", "abc"],
      ["comma grouping", "1,000.00"],
      ["currency symbol", "$10"],
      ["whitespace", " 10 "],
      ["exponent", "1e5"],
      ["a lone point", "."],
      ["trailing point", "10."],
      ["leading point", ".5"],
      ["infinity", "Infinity"],
    ])("rejects %s", (_label, value) => {
      expect(isValidAmount(value)).toBe(false);
    });

    it("rejects non-strings without throwing", () => {
      for (const value of [null, undefined, 10, {}, []]) {
        expect(isValidAmount(value)).toBe(false);
      }
    });
  });

  it("accepts the largest value the column can hold, and rejects one digit more", () => {
    expect(isValidAmount(MAX_AMOUNT)).toBe(true);
    expect(isValidAmount(`9${MAX_AMOUNT}`)).toBe(false);
  });
});
