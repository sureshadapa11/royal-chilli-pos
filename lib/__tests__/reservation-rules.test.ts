import { canMarkNoShow, canSeatNow, shortDate } from "../reservation-rules";

// 7 Oct 2026, 19:30 in London (BST, UTC+1)
const evening = new Date("2026-10-07T18:30:00Z");
// 8 Oct 2026, 00:30 in London — still the 7th's trading day
const afterMidnight = new Date("2026-10-07T23:30:00Z");

describe("reservation rules", () => {
  it("seats a booking only on its own day", () => {
    expect(canSeatNow("2026-10-07", evening)).toBe(true);
    expect(canSeatNow("2026-10-29", evening)).toBe(false);
    expect(canSeatNow("2026-10-06", evening)).toBe(false);
  });

  it("after midnight, both the late booking and the new day's can be seated", () => {
    expect(canSeatNow("2026-10-07", afterMidnight)).toBe(true);
    expect(canSeatNow("2026-10-08", afterMidnight)).toBe(true);
  });

  it("a no-show only once the booked time has come", () => {
    expect(canMarkNoShow("2026-10-07", "19:00:00", evening)).toBe(true);
    expect(canMarkNoShow("2026-10-07", "20:00:00", evening)).toBe(false);
    expect(canMarkNoShow("2026-10-29", "09:00:00", evening)).toBe(false);
    expect(canMarkNoShow("2026-10-06", "21:00:00", evening)).toBe(true);
  });

  it("formats a short date", () => {
    expect(shortDate("2026-10-29")).toBe("29 Oct");
  });
});
