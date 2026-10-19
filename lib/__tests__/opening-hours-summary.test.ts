jest.mock("@/lib/supabase", () => ({ __esModule: true, default: {} }));
import { summarizeOpeningHours, type DayHours } from "../opening-hours";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const week = (f: (day: string) => [string, string] | null): DayHours[] =>
  DAYS.flatMap((day) => { const t = f(day); return t ? [{ day, open: t[0], close: t[1] }] : []; });

describe("opening hours summary", () => {
  it("one line when every day is the same", () => {
    expect(summarizeOpeningHours(week(() => ["09:00", "00:00"]))).toEqual([{ day: "Every day", time: "9:00 AM – 12:00 AM" }]);
  });
  it("weekdays and weekend grouped (The Royal Chilli, October 2026)", () => {
    expect(summarizeOpeningHours(week((d) => (d.startsWith("S") ? ["08:00", "00:00"] : ["09:00", "00:00"])))).toEqual([
      { day: "Monday – Friday", time: "9:00 AM – 12:00 AM" },
      { day: "Saturday – Sunday", time: "8:00 AM – 12:00 AM" },
    ]);
  });
  it("a closed day breaks a run", () => {
    expect(summarizeOpeningHours(week((d) => (d === "Wednesday" ? null : ["12:00", "22:00"]))).map((r) => r.day))
      .toEqual(["Monday – Tuesday", "Thursday – Sunday"]);
  });
});
