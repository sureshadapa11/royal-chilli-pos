import { staffLinkUrl } from "@/lib/staff-link-url";

describe("staffLinkUrl", () => {
  const origin = "https://staff.theroyalchilli.com";
  it("uses the business's own staff address", () => {
    expect(staffLinkUrl("1-abc", "theroyalchilli.com", origin)).toBe("https://staff.theroyalchilli.com/l/1-abc");
    expect(staffLinkUrl("5-abc", "melthouse.co.uk", origin)).toBe("https://staff.melthouse.co.uk/l/5-abc");
  });
  it("falls back to the shared staff sign-in when there's no live domain", () => {
    expect(staffLinkUrl("7-abc", null, origin)).toBe("https://crewportal.vercel.app/l/7-abc");
    expect(staffLinkUrl("6-abc", "www.pizza2night.co.uk", origin)).toBe("https://crewportal.vercel.app/l/6-abc");
  });
  it("keeps localhost while developing", () => {
    expect(staffLinkUrl("7-abc", null, "http://localhost:3000")).toBe("http://localhost:3000/l/7-abc");
  });
});
