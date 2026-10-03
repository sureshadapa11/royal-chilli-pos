import { appPrefix, appUrl, baseDomain, isPortalHost, sessionCookieDomain } from "../app-hosts";

describe("app-hosts", () => {
  it("finds the app subdomain", () => {
    expect(appPrefix("pos.melthouse.co.uk")).toBe("pos");
    expect(appPrefix("STAFF.theroyalchilli.com:443")).toBe("staff");
    expect(appPrefix("attendance.theroyalchilli.com")).toBe("attendance");
    expect(appPrefix("www.theroyalchilli.com")).toBe("www");
    expect(appPrefix("royal-chilli-pos.vercel.app")).toBeNull();
    expect(appPrefix(null)).toBeNull();
  });

  it("strips one app prefix to get the business domain", () => {
    expect(baseDomain("pos.melthouse.co.uk")).toBe("melthouse.co.uk");
    expect(baseDomain("www.theroyalchilli.com")).toBe("theroyalchilli.com");
    expect(baseDomain("theroyalchilli.com")).toBe("theroyalchilli.com");
    expect(baseDomain("royal-chilli-pos.vercel.app")).toBe("royal-chilli-pos.vercel.app");
  });

  it("shares the session cookie across one business's subdomains only", () => {
    expect(sessionCookieDomain("pos.melthouse.co.uk")).toBe("melthouse.co.uk");
    expect(sessionCookieDomain("staff.theroyalchilli.com")).toBe("theroyalchilli.com");
    expect(sessionCookieDomain("royal-chilli-pos.vercel.app")).toBeUndefined();
    expect(sessionCookieDomain("pos.something.vercel.app")).toBeUndefined();
    expect(sessionCookieDomain("localhost:3000")).toBeUndefined();
    expect(sessionCookieDomain(null)).toBeUndefined();
  });

  it("links to a business's app subdomain only once its domain is saved without www.", () => {
    expect(appUrl("melthouse.co.uk", "attendance")).toBe("https://attendance.melthouse.co.uk");
    expect(appUrl("theroyalchilli.com", "staff")).toBe("https://staff.theroyalchilli.com");
    expect(appUrl("www.theroyalchilli.com", "attendance")).toBeNull();
    expect(appUrl(null, "pos")).toBeNull();
    expect(appUrl("royal-chilli-pos.vercel.app", "pos")).toBeNull();
  });

  it("knows the shared staff sign-in address", () => {
    expect(isPortalHost("crewportal.vercel.app")).toBe(true);
    expect(isPortalHost("CREWPORTAL.vercel.app:443")).toBe(true);
    expect(isPortalHost("staff.theroyalchilli.com")).toBe(false);
    expect(isPortalHost(null)).toBe(false);
  });
});
