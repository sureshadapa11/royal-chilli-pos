import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

let staffRow: Record<string, unknown> | null;
const auditRows: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: () => ({
      insert: (row: Record<string, unknown>) => { auditRows.push(row); return Promise.resolve({ error: null }); },
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve(staffRow ? { data: staffRow, error: null } : { data: null, error: new Error("not found") }),
          }),
        }),
      }),
    }),
  },
}));

let businessId: number | null = 1;
let isOwner = false;
const BUSINESSES = [
  { id: 1, name: "The Royal Chilli", login_code: "RC", domain: "theroyalchilli.com" },
  { id: 2, name: "Melt House", login_code: "MH", domain: "melthouse.co.uk" },
];
jest.mock("@/lib/business", () => ({
  __esModule: true,
  loginBusinessId: () => Promise.resolve(businessId),
  staffHome: () => Promise.resolve({ businessId, isOwner }),
  businessForHost: (host: string | null) => Promise.resolve(host === "melthouse.co.uk" ? { id: 2 } : null),
  businessByLoginCode: (code: string) => Promise.resolve(BUSINESSES.find((b) => b.login_code === String(code).trim().toUpperCase()) ?? null),
  getBusiness: (id: number) => Promise.resolve(BUSINESSES.find((b) => b.id === id) ?? null),
}));

import { POST } from "@/app/api/auth/login/route";

function jsonRequest(body: unknown, url = "http://localhost/api/auth/login") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: new URL(url).host },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  businessId = 1;
  isOwner = false;
  auditRows.length = 0;
  staffRow = {
    id: 1, name: "Test Manager", role: "manager", active: 1,
    password_hash: await bcrypt.hash("correct-horse", 10),
  };
});

describe("POST /api/auth/login", () => {
  it("400s when username or password is missing", async () => {
    const res = await POST(jsonRequest({ username: "manager1" }));
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and sets the session cookie", async () => {
    const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 1, name: "Test Manager", role: "manager", businessId: 1 });
    expect(res.cookies.get("pos_session")).toBeTruthy();
  });

  it("refuses an employee's password sign-in — the till is PIN-only on paired devices", async () => {
    staffRow = { id: 3, name: "Eve Employee", role: "employee", active: 1, password_hash: await bcrypt.hash("correct-horse", 10) };
    const res = await POST(jsonRequest({ username: "eve", password: "correct-horse" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/PIN/);
    expect(res.cookies.get("pos_session")).toBeFalsy();
  });

  it("shares the session cookie across a business's subdomains, but not on vercel.app", async () => {
    const sub = await POST(jsonRequest({ username: "manager1", password: "correct-horse" }, "https://staff.melthouse.co.uk/api/auth/login"));
    expect(sub.headers.get("set-cookie")).toMatch(/Domain=melthouse\.co\.uk/i);
    const vercel = await POST(jsonRequest({ username: "manager1", password: "correct-horse" }, "https://royal-chilli-pos.vercel.app/api/auth/login"));
    expect(vercel.headers.get("set-cookie")).not.toMatch(/Domain=/i);
  });

  it("401s on a wrong password", async () => {
    const res = await POST(jsonRequest({ username: "manager1", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("401s on an unknown username with the SAME message as a wrong password (no username enumeration)", async () => {
    staffRow = null;
    const unknownRes = await POST(jsonRequest({ username: "nobody", password: "whatever" }));
    const unknownBody = await unknownRes.json();

    staffRow = { id: 1, name: "Test Manager", role: "manager", active: 1, password_hash: await bcrypt.hash("correct-horse", 10) };
    const wrongPassRes = await POST(jsonRequest({ username: "manager1", password: "wrong" }));
    const wrongPassBody = await wrongPassRes.json();

    expect(unknownRes.status).toBe(401);
    expect(unknownBody.error).toBe(wrongPassBody.error);
  });

  it("403s when the account isn't set up at any business", async () => {
    businessId = null;
    const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse" }));
    expect(res.status).toBe(403);
    expect(res.cookies.get("pos_session")).toBeFalsy();
  });

  it("signs staff into their own business on another business's domain, and records the domain", async () => {
    const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse" }, "http://melthouse.co.uk/api/auth/login"));
    expect(res.status).toBe(200);
    expect((await res.json()).user.businessId).toBe(1);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "staff_login", staff_id: 1, business_id: 1,
        changes: { host: "melthouse.co.uk", domain_business_id: 2, business_id: 1 },
      }),
    ]);
  });

  describe("shared sign-in with a business code", () => {
    it("signs a manager into the business of the code they typed", async () => {
      const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse", business_code: "rc" }));
      expect(res.status).toBe(200);
      expect((await res.json()).user.businessId).toBe(1);
    });

    it("gives the wrong-password message (not 'wrong business') when they don't work there", async () => {
      const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse", business_code: "MH" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/Username or password is incorrect.*contact your manager for account recovery/);
      expect(res.cookies.get("pos_session")).toBeFalsy();
    });

    it("lets the owner into whichever business's code they typed", async () => {
      isOwner = true;
      businessId = null;
      const res = await POST(jsonRequest({ username: "owner", password: "correct-horse", business_code: "MH" }));
      expect(res.status).toBe(200);
      expect((await res.json()).user.businessId).toBe(2);
    });

    it("400s on a business code that doesn't exist", async () => {
      const res = await POST(jsonRequest({ username: "manager1", password: "correct-horse", business_code: "ZZ" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Business code not found/);
    });

    it("points an employee to their own attendance app", async () => {
      staffRow = { id: 3, name: "Eve", role: "employee", active: 1, password_hash: await bcrypt.hash("correct-horse", 10) };
      const res = await POST(jsonRequest({ username: "eve", password: "correct-horse", business_code: "RC" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/attendance\.theroyalchilli\.com/);
    });
  });
});
