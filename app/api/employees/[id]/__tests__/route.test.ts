// Regression coverage for the privilege-escalation guard: only Super admin,
// Supervisor and HR may change role/active/password (never on their own
// account), nobody else can be made Super admin, and only Super admin may
// edit the Super admin account. Everything else on the profile stays open to
// any canManageStaff role.
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

let updatedRow: Record<string, unknown> | null;
// Current role/active of each staff id the route looks up first.
const people: Record<string, { role: string; active: number }> = {
  "1": { role: "admin", active: 1 },
  "2": { role: "manager", active: 1 },
  "3": { role: "hr", active: 1 },
  "5": { role: "employee", active: 1 },
};

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: (table: string) => {
      if (table === "staff") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: () => Promise.resolve({ data: people[String(id)] ?? null, error: null }),
            }),
          }),
          update: (vals: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  updatedRow = vals;
                  return Promise.resolve({ data: { id: 5, ...vals }, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      // lib/permissions.ts warms its role_permissions cache at import time
      // (refreshPermissionsCache()) — no live DB in a unit test, so let it
      // fall back to the hardcoded default matrix, same as permissions.test.ts.
      if (table === "role_permissions") {
        return { select: () => Promise.resolve({ data: null, error: new Error("no db in unit tests") }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

let worksHere = true;
jest.mock("@/lib/business-db", () => ({ __esModule: true, bizDb: (id: number) => ({ businessId: id }), staffWorksAt: () => Promise.resolve(worksHere) }));

import { PATCH } from "@/app/api/employees/[id]/route";
import { authedRequest } from "@/app/api/_test-helpers";

const manager: SessionUser = { id: 2, name: "A Manager", role: "manager", businessId: 1 };
const admin: SessionUser = { id: 1, name: "Super admin", role: "admin", businessId: 1 };
const hr: SessionUser = { id: 3, name: "An HR", role: "hr", businessId: 1 };
const supervisor: SessionUser = { id: 4, name: "A Supervisor", role: "supervisor", businessId: 1 };

async function patch(user: SessionUser | null, targetId: string, body: unknown) {
  const req = await authedRequest(`http://localhost/api/employees/${targetId}`, user, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req as NextRequest, { params: Promise.resolve({ id: targetId }) });
}

beforeEach(() => {
  updatedRow = null;
});

describe("PATCH /api/employees/[id] — privilege-escalation guard", () => {
  it("403s a manager trying to change their own role", async () => {
    const res = await patch(manager, "2", { role: "admin" });
    expect(res.status).toBe(403);
    expect(updatedRow).toBeNull();
  });

  it("403s a manager trying to change another employee's active status", async () => {
    const res = await patch(manager, "5", { active: 0 });
    expect(res.status).toBe(403);
  });

  it("403s a manager trying to reset another employee's password", async () => {
    const res = await patch(manager, "1", { password: "newpassword123" });
    expect(res.status).toBe(403);
  });

  it("still lets a manager update ordinary profile fields", async () => {
    const res = await patch(manager, "5", { phone: "07700900000" });
    expect(res.status).toBe(200);
    expect(updatedRow).toEqual({ phone: "07700900000" });
  });

  it("lets a manager save a form that re-sends the unchanged role", async () => {
    const res = await patch(manager, "5", { role: "employee", phone: "07700900001" });
    expect(res.status).toBe(200);
  });

  it("lets HR and a Supervisor change someone's role", async () => {
    expect((await patch(hr, "5", { role: "kitchen" })).status).toBe(200);
    expect((await patch(supervisor, "5", { role: "manager" })).status).toBe(200);
  });

  it("403s HR changing their own role", async () => {
    expect((await patch(hr, "3", { role: "supervisor" })).status).toBe(403);
  });

  it("never makes anyone Super admin, not even the Super admin", async () => {
    expect((await patch(hr, "5", { role: "admin" })).status).toBe(403);
    expect((await patch(admin, "5", { role: "admin" })).status).toBe(403);
    expect(updatedRow).toBeNull();
  });

  it("403s anyone but the Super admin editing the Super admin account", async () => {
    expect((await patch(supervisor, "1", { phone: "07700900002" })).status).toBe(403);
    expect(updatedRow).toBeNull();
  });

  it("lets the Super admin change role", async () => {
    const res = await patch(admin, "5", { role: "hr" });
    expect(res.status).toBe(200);
    expect(updatedRow).toEqual({ role: "hr" });
  });

  it("401s when there's no session at all", async () => {
    const res = await patch(null, "5", { phone: "07700900000" });
    expect(res.status).toBe(401);
  });

  it("404s for someone who doesn't work at this business, and changes nothing", async () => {
    worksHere = false;
    const res = await patch(admin, "5", { phone: "07700900000" });
    worksHere = true;
    expect(res.status).toBe(404);
    expect(updatedRow).toBeNull();
  });
});
