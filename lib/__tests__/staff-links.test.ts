import { money } from "@/lib/staff-links";
import { drawerCheck } from "@/lib/day-end-report";

describe("staff link amounts", () => {
  it("blank is nothing, numbers are rounded to the penny, nonsense is refused", () => {
    expect(money("")).toBeNull();
    expect(money(undefined)).toBeNull();
    expect(money("12.345")).toBe(12.35);
    expect(money("0")).toBe(0);
    expect(money("-5")).toBe("bad");
    expect(money("abc")).toBe("bad");
  });
});

describe("cash drawer check (morning email)", () => {
  it("expected = opening + cash sales + money in − money out; difference = counted − expected", () => {
    expect(drawerCheck(200, 265.4, 100, 150, 410.4)).toEqual({ expected: 415.4, variance: -5 });
  });
  it("no opening or nothing counted: can't say", () => {
    expect(drawerCheck(null, 100, 0, 0, 100)).toEqual({ expected: null, variance: null });
    expect(drawerCheck(50, 100, 0, 0, null)).toEqual({ expected: 150, variance: null });
  });
});
