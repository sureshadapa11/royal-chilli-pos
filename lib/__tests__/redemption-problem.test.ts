import { redemptionProblem } from "@/lib/loyalty";

describe("can this code be used now?", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const code = (o: Partial<{ status: string; valid_from: string | null; expires_at: string }>) =>
    ({ status: "issued", valid_from: null, expires_at: "2026-11-10T12:00:00Z", ...o });
  it("an issued, in-date code is fine", () => expect(redemptionProblem(code({}), now)).toBeNull());
  it("used, cancelled, locked or expired codes are refused", () => {
    expect(redemptionProblem(code({ status: "redeemed" }), now)?.error).toBe("ALREADY_REDEEMED");
    expect(redemptionProblem(code({ status: "cancelled" }), now)?.error).toBe("CANCELLED");
    expect(redemptionProblem(code({ status: "locked" }), now)?.error).toBe("LOCKED");
    expect(redemptionProblem(code({ expires_at: "2026-10-01T00:00:00Z" }), now)?.error).toBe("REWARD_EXPIRED");
  });
  it("a next-visit voucher isn't usable yet", () => {
    expect(redemptionProblem(code({ valid_from: "2026-10-12T04:00:00Z" }), now)?.error).toBe("NOT_YET_VALID");
  });
});
