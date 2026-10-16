import { cashToSafe } from "@/lib/daily-accounts-fields";

// Everything above the float left in the till goes to the Safe (agreed 2026-10-16).
describe("cash taken to the Safe", () => {
  it("is the count minus the float", () => {
    expect(cashToSafe(113.8, 77)).toEqual({ toSafe: 36.8, short: 0 });
    expect(cashToSafe(130.74, 77)).toEqual({ toSafe: 53.74, short: 0 });
  });

  it("is nothing when only the float is in the till", () => {
    expect(cashToSafe(77, 77)).toEqual({ toSafe: 0, short: 0 });
  });

  it("follows a changed float", () => {
    expect(cashToSafe(200, 100)).toEqual({ toSafe: 100, short: 0 });
  });

  it("sends nothing and warns when the till is below the float", () => {
    expect(cashToSafe(60, 77)).toEqual({ toSafe: 0, short: 17 });
  });

  it("can't say without a count or a float", () => {
    expect(cashToSafe(null, 77)).toEqual({ toSafe: null, short: 0 });
    expect(cashToSafe(100, null)).toEqual({ toSafe: null, short: 0 });
  });
});
