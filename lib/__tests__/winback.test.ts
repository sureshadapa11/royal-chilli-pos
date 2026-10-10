import { winBackDue, isWinBackReason, WINBACK_REASONS } from "@/lib/winback-reasons";

describe("who gets the 'why did you stop coming?' email", () => {
  const today = "2026-10-11";
  it("after 21 days away, not before", () => {
    expect(winBackDue("2026-09-20", null, today)).toBe(true);   // 21 days
    expect(winBackDue("2026-09-21", null, today)).toBe(false);  // 20 days
  });
  it("never for someone with no visit, or gone over 180 days", () => {
    expect(winBackDue(null, null, today)).toBe(false);
    expect(winBackDue("2026-04-01", null, today)).toBe(false);
  });
  it("once per lapse, and never more than every 90 days", () => {
    expect(winBackDue("2026-09-01", "2026-09-25", today)).toBe(false); // asked after this visit already
    expect(winBackDue("2026-09-01", "2026-06-20", today)).toBe(true);  // asked 113 days ago, came back since
    expect(winBackDue("2026-09-01", "2026-08-20", today)).toBe(false); // came back since, but asked only 52 days ago
  });
  it("knows the six reasons", () => {
    expect(WINBACK_REASONS.map((r) => r.key)).toEqual(["food", "service", "price", "distance", "waiting", "busy"]);
    expect(isWinBackReason("busy")).toBe(true);
    expect(isWinBackReason("other")).toBe(false);
  });
});
