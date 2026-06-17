import { describe, it, expect } from "vitest";
import { fmtTime } from "../src/html";

describe("fmtTime", () => {
  it("formats epoch seconds as readable Asia/Taipei YYYY/MM/DD HH:MM", () => {
    const out = fmtTime("1781697247.1117027"); // ~2026-06-17 (UTC)
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(out.startsWith("2026/06/")).toBe(true);
  });
  it("accepts an ISO string", () => {
    expect(fmtTime("2026-06-17T00:00:00Z")).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
  it("empty/blank → dash; unparseable → raw", () => {
    expect(fmtTime("")).toBe("-");
    expect(fmtTime(null)).toBe("-");
    expect(fmtTime("not-a-date")).toBe("not-a-date");
  });
});
