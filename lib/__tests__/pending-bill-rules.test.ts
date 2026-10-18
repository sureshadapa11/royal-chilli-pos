import { billDateProblem, earliestBillDate, zMissingBills } from "../pending-bill-rules";

describe("an unpaid bill's date on the Day End link", () => {
  it("the Day End's own day, or earlier (Rajesh 4 Oct on the 16 Oct Day End)", () => {
    expect(billDateProblem("2026-10-16", "2026-10-16")).toBeNull();
    expect(billDateProblem("2026-10-04", "2026-10-16")).toBeNull();
  });
  it("not after the Day End day", () => {
    expect(billDateProblem("2026-10-17", "2026-10-16")).toMatch(/after/);
  });
  it("up to two months back", () => {
    expect(earliestBillDate("2026-10-16")).toBe("2026-08-15");
    expect(billDateProblem("2026-08-15", "2026-10-16")).toBeNull();
    expect(billDateProblem("2026-08-14", "2026-10-16")).toMatch(/two months/);
  });
});

describe("Z should include today's unpaid bills", () => {
  it("adds up: no warning", () => {
    expect(zMissingBills(401.98, 326.04, 35.94, 40)).toBeNull();
  });
  it("Z = card + cash with a bill today: warn, it should be £401.98", () => {
    expect(zMissingBills(361.98, 326.04, 35.94, 40)).toBe(401.98);
  });
  it("no bills dated today: never warns", () => {
    expect(zMissingBills(361.98, 300, 0, 0)).toBeNull();
  });
});
