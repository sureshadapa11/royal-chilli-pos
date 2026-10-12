import { quarterStart } from "@/lib/dashboard-extra";

describe("quarterStart", () => {
  it("finds the calendar quarter's first day", () => {
    expect(quarterStart("2026-10-12")).toBe("2026-10-01");
    expect(quarterStart("2026-12-31")).toBe("2026-10-01");
    expect(quarterStart("2026-02-14")).toBe("2026-01-01");
    expect(quarterStart("2026-06-30")).toBe("2026-04-01");
    expect(quarterStart("2026-07-01")).toBe("2026-07-01");
  });
});
