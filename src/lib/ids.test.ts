import { describe, expect, it } from "vitest";

import { isUuid } from "./ids";

describe("isUuid", () => {
  it("accepts a real uuid, in either case", () => {
    expect(isUuid("6c576d62-bee1-4cb5-a5af-f8401a8f0558")).toBe(true);
    expect(isUuid("6C576D62-BEE1-4CB5-A5AF-F8401A8F0558")).toBe(true);
  });

  it.each([
    ["a word", "not-a-uuid"],
    ["a number", "1"],
    ["empty", ""],
    ["a SQL fragment", "'; drop table users;--"],
    ["too short", "6c576d62-bee1-4cb5-a5af-f8401a8f055"],
    ["too long", "6c576d62-bee1-4cb5-a5af-f8401a8f05588"],
    ["wrong separators", "6c576d62bee14cb5a5aff8401a8f0558"],
    ["non-hex characters", "zzzzzzzz-bee1-4cb5-a5af-f8401a8f0558"],
    ["whitespace padded", " 6c576d62-bee1-4cb5-a5af-f8401a8f0558 "],
  ])("rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
