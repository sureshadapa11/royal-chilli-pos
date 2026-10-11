import { birthdayLabel, birthdayTargetDate, birthdayToDate, isBirthdayOn } from "@/lib/birthday";

describe("birthdays", () => {
  it("stores day and month only (year 2000), rejecting dates that don't exist", () => {
    expect(birthdayToDate(12, 3)).toBe("2000-03-12");
    expect(birthdayToDate(29, 2)).toBe("2000-02-29");
    expect(birthdayToDate(31, 4)).toBeNull();
    expect(birthdayToDate("", 4)).toBeNull();
  });
  it("shows it as '12 March'", () => {
    expect(birthdayLabel("2000-03-12")).toBe("12 March");
    expect(birthdayLabel(null)).toBeNull();
  });
  it("matches on day and month in any year", () => {
    expect(isBirthdayOn("2000-03-12", "2026-03-12")).toBe(true);
    expect(isBirthdayOn("1990-03-12", "2026-03-12")).toBe(true);
    expect(isBirthdayOn("2000-03-12", "2026-03-13")).toBe(false);
  });
  it("29 February birthdays are on 28 February in other years", () => {
    expect(isBirthdayOn("2000-02-29", "2027-02-28")).toBe(true);
    expect(isBirthdayOn("2000-02-29", "2028-02-29")).toBe(true);
    expect(isBirthdayOn("2000-02-29", "2028-02-28")).toBe(false);
  });
  it("the treat goes out 7 days before, across month and year ends", () => {
    expect(birthdayTargetDate("2026-10-11")).toBe("2026-10-18");
    expect(birthdayTargetDate("2026-12-28")).toBe("2027-01-04");
  });
});
