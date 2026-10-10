import { hoursMinutes } from "@/lib/utils";

describe("staff hours as hours and minutes", () => {
  it("never shows a decimal", () => {
    expect(hoursMinutes(9 + 49 / 60)).toBe("9h 49m");
    expect(hoursMinutes(9.82)).toBe("9h 49m");
  });
  it("whole hours, minutes only, zero, nothing", () => {
    expect(hoursMinutes(8)).toBe("8h");
    expect(hoursMinutes(0.5)).toBe("30m");
    expect(hoursMinutes(0)).toBe("0m");
    expect(hoursMinutes(null)).toBe("0m");
  });
  it("rounds 59.6 minutes up to the next hour, not 60m", () => {
    expect(hoursMinutes(3599 / 3600)).toBe("1h");
  });
});
