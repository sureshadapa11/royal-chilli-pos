import { minSpendProblem, redemptionProblem } from "@/lib/loyalty";

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

describe("minSpendProblem (rewards need a £15 bill)", () => {
  it("refuses a bill under the minimum, saying how much it is", () => {
    expect(minSpendProblem(15, 2.95)).toEqual({
      error: "MINIMUM_SPEND_NOT_MET",
      message: "Rewards need a spend of at least £15.00: this bill is £2.95",
    });
  });
  it("allows exactly the minimum and anything over it", () => {
    expect(minSpendProblem(15, 15)).toBeNull();
    expect(minSpendProblem(15, 14.999)).toBeNull(); // rounding
    expect(minSpendProblem(15, 42.5)).toBeNull();
  });
  it("no minimum set (0) allows any bill", () => {
    expect(minSpendProblem(0, 1)).toBeNull();
  });
});
