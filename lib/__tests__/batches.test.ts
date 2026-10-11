import { expiryStatus, useFirstUntil } from "../batches";

describe("expiryStatus", () => {
  const today = "2026-10-08";
  it("past the use-by is expired", () => expect(expiryStatus("2026-10-07", today)).toBe("expired"));
  it("today and tomorrow are use first", () => {
    expect(expiryStatus("2026-10-08", today)).toBe("use_first");
    expect(expiryStatus("2026-10-09", today)).toBe("use_first");
  });
  it("later is fine", () => expect(expiryStatus("2026-10-10", today)).toBe("ok"));
  it("crosses month ends", () => {
    expect(useFirstUntil("2026-10-31")).toBe("2026-11-01");
    expect(expiryStatus("2026-11-01", "2026-10-31")).toBe("use_first");
  });
});
