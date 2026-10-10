import { parseFeedback, summariseFeedback, type FeedbackRow } from "@/lib/feedback";
import { lastWeek } from "@/lib/weekly-report";

jest.mock("@/lib/email", () => ({ sendWeeklyReportEmail: jest.fn() }));

describe("feedback form", () => {
  it("needs 1–5 stars", () => {
    expect(parseFeedback({ rating: 0 }).ok).toBe(false);
    expect(parseFeedback({ rating: 6 }).ok).toBe(false);
    expect(parseFeedback({ rating: 4 }).ok).toBe(true);
  });

  it("keeps only known topics, once each; contact only with a way to contact", () => {
    const r = parseFeedback({ rating: 2, improve: ["wait", "wait", "hack"], liked: ["food"], contact_ok: true, phone: "", comment: "  biryani was cold  ", source: "table", table: "5" });
    expect(r.ok && r.value).toMatchObject({ improve: ["wait"], liked: ["food"], contact_ok: false, comment: "biryani was cold", source: "table", table_label: "5" });
    const withPhone = parseFeedback({ rating: 2, contact_ok: true, phone: "07766 177108" });
    expect(withPhone.ok && withPhone.value.contact_ok).toBe(true);
  });

  it("checks email and phone", () => {
    expect(parseFeedback({ rating: 5, email: "nope" }).ok).toBe(false);
    expect(parseFeedback({ rating: 5, phone: "123" }).ok).toBe(false);
  });
});

describe("feedback summary", () => {
  const row = (rating: number, liked: string[], improve: string[], handled = false): FeedbackRow => ({
    id: rating, created_at: "2026-10-09T19:00:00Z", rating, liked, improve, comment: null, name: null, phone: null, email: null,
    contact_ok: false, customer_id: null, source: "table", table_label: null, handled_at: handled ? "2026-10-10T10:00:00Z" : null, handled_note: null,
  });
  it("averages, counts stars, ranks topics and counts who still needs a call", () => {
    const s = summariseFeedback([row(5, ["food", "service"], []), row(4, ["food"], ["wait"]), row(2, [], ["wait", "price"]), row(1, [], ["food"], true)]);
    expect(s.count).toBe(4);
    expect(s.average).toBe(3);
    expect(s.stars).toEqual([1, 1, 0, 1, 1]);
    expect(s.liked[0]).toMatchObject({ key: "food", count: 2 });
    expect(s.improve[0]).toMatchObject({ key: "wait", count: 2 });
    expect(s.open).toBe(1);
  });
});

describe("Monday report", () => {
  it("covers last Monday to Sunday", () => {
    expect(lastWeek("2026-10-12")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" }); // a Monday
    expect(lastWeek("2026-10-14")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
  });
});
