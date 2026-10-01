import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase,
}));

import { fakeDb } from "@/app/api/_test-helpers/fake-supabase";
import { authedRequest } from "@/app/api/_test-helpers";
import { GET as listEmployees } from "@/app/api/employees/route";
import { GET as getEmployee } from "@/app/api/employees/[id]/route";
import { PATCH } from "@/app/api/staff/[id]/locations/route";

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
    const res = await patch(floatingManager, "13", { location_ids: [2, 1, 2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, staff: { id: 13, name: "Cook", location_ids: [1, 2] } });
    expect(assigned(13)).toEqual([1, 2]);
    expect(fakeDb.rows("audit_logs")).toEqual([
      expect.objectContaining({
        business_id: 1,
        staff_id: 11,
        action: "staff_location_assignment",
        entity_type: "staff",
        entity_id: 13,
        changes: { from: [1], to: [1, 2] },
      }),
    ]);
  });

  it("an empty array unassigns the staff member", async () => {
    const res = await patch(floatingManager, "13", { location_ids: [] });
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
