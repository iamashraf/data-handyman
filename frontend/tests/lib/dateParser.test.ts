import { describe, expect, it } from "vitest";
import { formatPreviewDate, parseTypedDate, toIsoDate } from "../../src/lib/dateParser";

const REFERENCE_DATE = new Date(2026, 9, 31); // 2026-10-31, a fixed "today" for determinism

function parsedIso(input: string): string | null {
  const parsed = parseTypedDate(input, REFERENCE_DATE);
  return parsed ? toIsoDate(parsed) : null;
}

describe("parseTypedDate - absolute formats", () => {
  it("parses ISO", () => {
    expect(parsedIso("2026-11-15")).toBe("2026-11-15");
  });

  it("parses M/d/yyyy", () => {
    expect(parsedIso("11/15/2026")).toBe("2026-11-15");
  });

  it("parses M/d/yy", () => {
    expect(parsedIso("11/15/26")).toBe("2026-11-15");
  });

  it("parses M-d-yyyy", () => {
    expect(parsedIso("11-15-2026")).toBe("2026-11-15");
  });

  it("parses M/d using the current year", () => {
    expect(parsedIso("11/15")).toBe("2026-11-15");
  });

  it("parses abbreviated month + day", () => {
    expect(parsedIso("Nov 15")).toBe("2026-11-15");
  });

  it("parses abbreviated month + day + year", () => {
    expect(parsedIso("Nov 15 2026")).toBe("2026-11-15");
  });

  it("parses full month name, day, comma, year", () => {
    expect(parsedIso("November 15, 2026")).toBe("2026-11-15");
  });

  it("parses day + abbreviated month + year", () => {
    expect(parsedIso("15 Nov 2026")).toBe("2026-11-15");
  });
});

describe("parseTypedDate - relative forms", () => {
  it("parses today", () => {
    expect(parsedIso("today")).toBe("2026-10-31");
  });

  it("parses tomorrow", () => {
    expect(parsedIso("tomorrow")).toBe("2026-11-01");
  });

  it("parses yesterday", () => {
    expect(parsedIso("yesterday")).toBe("2026-10-30");
  });

  it("parses a bare +N as days", () => {
    expect(parsedIso("+3")).toBe("2026-11-03");
  });

  it("parses +Nd as days", () => {
    expect(parsedIso("+3d")).toBe("2026-11-03");
  });

  it("parses -Nw as weeks", () => {
    expect(parsedIso("-2w")).toBe("2026-10-17");
  });

  it("parses +Nm as months", () => {
    expect(parsedIso("+1m")).toBe("2026-11-30");
  });

  it("is case-insensitive for keywords", () => {
    expect(parsedIso("TODAY")).toBe("2026-10-31");
    expect(parsedIso("Tomorrow")).toBe("2026-11-01");
  });
});

describe("parseTypedDate - invalid input", () => {
  it("rejects an out-of-range month/day", () => {
    expect(parseTypedDate("13/45/2026", REFERENCE_DATE)).toBeNull();
  });

  it("rejects gibberish", () => {
    expect(parseTypedDate("abc", REFERENCE_DATE)).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    expect(parseTypedDate("2026-02-30", REFERENCE_DATE)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseTypedDate("", REFERENCE_DATE)).toBeNull();
  });

  it("rejects whitespace-only input", () => {
    expect(parseTypedDate("   ", REFERENCE_DATE)).toBeNull();
  });
});

describe("formatPreviewDate", () => {
  it("includes the weekday", () => {
    const parsed = parseTypedDate("2026-11-15", REFERENCE_DATE)!;
    expect(formatPreviewDate(parsed)).toBe("Sun, Nov 15, 2026");
  });
});
