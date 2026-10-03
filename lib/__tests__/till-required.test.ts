import { NextRequest } from "next/server";

// lib/permissions reads role_permissions at import — no DB here, so it uses
// its built-in defaults (Front House and Manager have the till, HR doesn't).
jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: () => ({ select: () => Promise.resolve({ data: null, error: new Error("no db in unit tests") }) }) },
}));
import { createTillToken, tillRequired, TILL_COOKIE } from "../till-device";

const req = (cookie?: string) =>
  new NextRequest("http://localhost/api/orders/1/payment", { method: "POST", headers: cookie ? { cookie } : {} });

describe("tillRequired", () => {
  it("allows a paired till of the same business", async () => {
    const token = await createTillToken(1, 5);
    expect(await tillRequired(req(`${TILL_COOKIE}=${token}`), { businessId: 5, role: "employee" })).toBeNull();
  });

  it("refuses a device that isn't a till, even for a manager", async () => {
    const res = await tillRequired(req(), { businessId: 1, role: "manager" });
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toMatch(/paired till/);
  });

  it("refuses another business's till", async () => {
    const token = await createTillToken(1, 1);
    expect((await tillRequired(req(`${TILL_COOKIE}=${token}`), { businessId: 5, role: "manager" }))?.status).toBe(403);
  });

  it("refuses Kitchen staff even on the business's own till", async () => {
    const token = await createTillToken(1, 5);
    const res = await tillRequired(req(`${TILL_COOKIE}=${token}`), { businessId: 5, role: "kitchen" });
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toMatch(/Kitchen staff/);
  });

  it("refuses a role without the Till tick (HR by default)", async () => {
    const token = await createTillToken(1, 5);
    const res = await tillRequired(req(`${TILL_COOKIE}=${token}`), { businessId: 5, role: "hr" });
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toMatch(/can't take orders/);
  });
});
