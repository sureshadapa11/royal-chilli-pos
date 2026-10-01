import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase,
}));

import { fakeDb } from "@/app/api/_test-helpers/fake-supabase";
import { authedRequest } from "@/app/api/_test-helpers";
import { GET as listEmployees } from "@/app/api/employees/route";
import { GET as getEmployee } from "@/app/api/employees/[id]/route";
import { PATCH, POST } from "@/app/api/staff/[id]/locations/route";
import { DELETE } from "@/app/api/staff/[id]/locations/[locationId]/route";

// Manager 10 works at Kitchen only; manager 11 isn't tied to any location.
const kitchenManager: SessionUser = { id: 10, name: "Kitchen Manager", role: "manager", businessId: 1 };
const floatingManager: SessionUser = { id: 11, name: "Floating Manager", role: "manager", businessId: 1 };
const owner: SessionUser = { id: 12, name: "Owner", role: "admin", businessId: 1, owner: true };

async function patch(user: SessionUser | null, staffId: string, body: unknown) {
  const req = await authedRequest(`http://localhost/api/staff/${staffId}/locations`, user, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: staffId }) });
}

async function post(user: SessionUser | null, staffId: string, body: unknown) {
  const req = await authedRequest(`http://localhost/api/staff/${staffId}/locations`, user, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: staffId }) });
}

async function del(user: SessionUser | null, staffId: string, locationId: string) {
  const req = await authedRequest(`http://localhost/api/staff/${staffId}/locations/${locationId}`, user, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id: staffId, locationId }) });
}

const assigned = (staffId: number) =>
  fakeDb.rows("staff_locations").filter((r) => r.staff_id === staffId).map((r) => r.location_id as number).sort();

beforeEach(() => {
  fakeDb.reset({
    locations: [
      { id: 1, business_id: 1, name: "Kitchen", active: 1 },
      { id: 2, business_id: 1, name: "Warehouse", active: 1 },
      { id: 3, business_id: 2, name: "Melt House", active: 1 },
    ],
    staff: [
      { id: 10, business_id: 1, name: "Kitchen Manager", role: "manager", active: 1 },
      { id: 11, business_id: 1, name: "Floating Manager", role: "manager", active: 1 },
      { id: 12, business_id: 1, name: "Owner", role: "admin", active: 1, is_owner: true },
      { id: 13, business_id: 1, name: "Cook", role: "employee", active: 1 },
      { id: 20, business_id: 2, name: "Other biz", role: "employee", active: 1 },
    ],
    staff_locations: [
      { staff_id: 10, location_id: 1, assigned_at: "2026-09-01T00:00:00.000Z" },
      { staff_id: 13, location_id: 1, assigned_at: "2026-09-01T00:00:00.000Z" },
    ],
    audit_logs: [],
    role_permissions: [],
  });
});

describe("PATCH /api/staff/[id]/locations", () => {
  it("lets a manager assign staff to multiple locations and writes an audit log", async () => {
    const res = await patch(owner, "13", { location_ids: [2, 1, 2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, staff: { id: 13, name: "Cook", location_ids: [1, 2] } });
    expect(assigned(13)).toEqual([1, 2]);
    expect(fakeDb.rows("audit_logs")).toEqual([
      expect.objectContaining({
        business_id: 1,
        staff_id: 12,
        action: "staff_location_assignment",
        entity_type: "staff",
        entity_id: 13,
        changes: { from: [1], to: [1, 2] },
      }),
    ]);
  });

  it("an empty array unassigns the staff member", async () => {
    const res = await patch(kitchenManager, "13", { location_ids: [] });
    expect(res.status).toBe(200);
    expect(assigned(13)).toEqual([]);
    expect(fakeDb.rows("audit_logs")[0].changes).toEqual({ from: [1], to: [] });
  });

  it("won't let a manager remove their own only location", async () => {
    const res = await patch(kitchenManager, "10", { location_ids: [] });
    expect(res.status).toBe(400);
    expect(assigned(10)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("rejects another business's location with 400 and changes nothing", async () => {
    const res = await patch(owner, "13", { location_ids: [1, 3] });
    expect(res.status).toBe(400);
    expect(assigned(13)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("stops a location-limited manager handing out a location they don't work at", async () => {
    expect((await patch(kitchenManager, "13", { location_ids: [1, 2] })).status).toBe(403);
    expect((await patch(kitchenManager, "10", { location_ids: [1, 2] })).status).toBe(403);
    expect(assigned(13)).toEqual([1]);
    expect(assigned(10)).toEqual([1]);
  });

  it("stops an unassigned manager handing out any location, their own included", async () => {
    expect((await patch(floatingManager, "13", { location_ids: [1, 2] })).status).toBe(403);
    expect((await patch(floatingManager, "11", { location_ids: [1] })).status).toBe(403);
    expect(assigned(13)).toEqual([1]);
    expect(assigned(11)).toEqual([]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("404s for staff of another business", async () => {
    expect((await patch(owner, "20", { location_ids: [1] })).status).toBe(404);
  });

  it("validates the body and the session", async () => {
    expect((await patch(owner, "13", { location_ids: "1" })).status).toBe(400);
    expect((await patch(owner, "13", { location_ids: [0] })).status).toBe(400);
    expect((await patch(null, "13", { location_ids: [1] })).status).toBe(401);
    expect((await patch({ ...floatingManager, role: "employee" }, "13", { location_ids: [1] })).status).toBe(401);
  });
});

describe("POST /api/staff/[id]/locations", () => {
  it("lets a manager add a location they're assigned to and writes an audit log", async () => {
    fakeDb.rows("staff_locations").splice(0, fakeDb.rows("staff_locations").length, { staff_id: 10, location_id: 1 });
    const res = await post(kitchenManager, "13", { location_id: 1 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, staffId: 13, locationId: 1 });
    expect(assigned(13)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toEqual([
      expect.objectContaining({
        business_id: 1,
        staff_id: 10,
        action: "staff_location_assignment",
        entity_type: "staff",
        entity_id: 13,
        changes: { from: [], to: [1] },
      }),
    ]);
  });

  it("409s when the staff member already has the location", async () => {
    const res = await post(kitchenManager, "10", { location_id: 1 });
    expect(res.status).toBe(409);
    expect(assigned(10)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("stops a manager adding a location they aren't assigned to, for anyone including themselves", async () => {
    const res = await post(kitchenManager, "10", { location_id: 2 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You can only assign locations you're assigned to");
    expect((await post(kitchenManager, "13", { location_id: 2 })).status).toBe(403);
    expect(assigned(10)).toEqual([1]);
    expect(assigned(13)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("stops an unassigned manager adding any location", async () => {
    expect((await post(floatingManager, "11", { location_id: 1 })).status).toBe(403);
    expect((await post(floatingManager, "13", { location_id: 2 })).status).toBe(403);
    expect(assigned(11)).toEqual([]);
    expect(assigned(13)).toEqual([1]);
  });

  it("lets the owner add any location", async () => {
    expect((await post(owner, "13", { location_id: 2 })).status).toBe(201);
    expect((await post(owner, "11", { location_id: 2 })).status).toBe(201);
    expect(assigned(13)).toEqual([1, 2]);
    expect(assigned(11)).toEqual([2]);
    expect(fakeDb.rows("audit_logs")[0].changes).toEqual({ from: [1], to: [1, 2] });
  });

  it("400s for a missing or another business's location", async () => {
    expect((await post(owner, "13", { location_id: 3 })).status).toBe(400);
    expect((await post(owner, "13", { location_id: 99 })).status).toBe(400);
    expect(assigned(13)).toEqual([1]);
  });

  it("validates the body, the staff member and the session", async () => {
    expect((await post(owner, "13", { location_id: 0 })).status).toBe(400);
    expect((await post(owner, "13", {})).status).toBe(400);
    expect((await post(owner, "20", { location_id: 1 })).status).toBe(404);
    expect((await post(null, "13", { location_id: 1 })).status).toBe(401);
    expect((await post({ ...kitchenManager, role: "employee" }, "13", { location_id: 1 })).status).toBe(401);
  });
});

describe("DELETE /api/staff/[id]/locations/[locationId]", () => {
  it("lets a manager remove a location they're assigned to and writes an audit log", async () => {
    fakeDb.rows("staff_locations").push({ staff_id: 10, location_id: 2 }, { staff_id: 13, location_id: 2 });
    const res = await del(kitchenManager, "13", "2");
    expect(res.status).toBe(200);
    expect(assigned(13)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toEqual([
      expect.objectContaining({
        business_id: 1,
        staff_id: 10,
        action: "staff_location_assignment",
        entity_type: "staff",
        entity_id: 13,
        changes: { from: [1, 2], to: [1] },
      }),
    ]);
  });

  it("stops a manager removing a location they aren't assigned to", async () => {
    fakeDb.rows("staff_locations").push({ staff_id: 13, location_id: 2 });
    const res = await del(kitchenManager, "13", "2");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You can only remove locations you're assigned to");
    expect(assigned(13)).toEqual([1, 2]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("stops an unassigned manager removing any location", async () => {
    expect((await del(floatingManager, "13", "1")).status).toBe(403);
    expect(assigned(13)).toEqual([1]);
  });

  it("lets the owner remove any location", async () => {
    fakeDb.rows("staff_locations").push({ staff_id: 13, location_id: 2 });
    expect((await del(owner, "13", "2")).status).toBe(200);
    expect((await del(owner, "10", "1")).status).toBe(200);
    expect(assigned(13)).toEqual([1]);
    expect(assigned(10)).toEqual([]);
  });

  it("won't let a manager remove their own only location", async () => {
    const res = await del(kitchenManager, "10", "1");
    expect(res.status).toBe(400);
    expect(assigned(10)).toEqual([1]);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("404s when the assignment, location or staff member doesn't exist", async () => {
    expect((await del(owner, "13", "2")).status).toBe(404);
    expect((await del(owner, "13", "3")).status).toBe(404);
    expect((await del(owner, "20", "1")).status).toBe(404);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("validates ids and the session", async () => {
    expect((await del(owner, "13", "x")).status).toBe(400);
    expect((await del(null, "13", "1")).status).toBe(401);
    expect((await del({ ...kitchenManager, role: "employee" }, "13", "1")).status).toBe(401);
  });
});

describe("employee APIs include location_ids", () => {
  it("GET /api/employees", async () => {
    const res = await listEmployees(await authedRequest("http://localhost/api/employees", owner));
    expect(res.status).toBe(200);
    const { employees } = await res.json();
    const byId = Object.fromEntries(employees.map((e: { id: number; location_ids: number[] }) => [e.id, e.location_ids]));
    expect(byId).toMatchObject({ 10: [1], 11: [], 13: [1] });
    expect(byId[20]).toBeUndefined();
  });

  it("GET /api/employees/:id", async () => {
    const res = await getEmployee(await authedRequest("http://localhost/api/employees/13", owner), { params: Promise.resolve({ id: "13" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).employee).toMatchObject({ id: 13, location_ids: [1] });
  });
});
