import { areaOfPath } from "@/lib/auth-sync";

describe("which sign-in a page belongs to", () => {
  it("Staff Hub, till, PIN pad, kitchen and staff sign-in are staff pages", () => {
    for (const p of ["/staff", "/staff/inventory", "/pos", "/pos/kitchen", "/pin", "/login", "/print-station"]) {
      expect(areaOfPath(p)).toBe("staff");
    }
  });

  it("the website and customer accounts are customer pages", () => {
    for (const p of ["/", "/menu", "/account", "/account/loyalty", "/order/checkout", "/staffing", "/positions"]) {
      expect(areaOfPath(p)).toBe("customer");
    }
  });
});
