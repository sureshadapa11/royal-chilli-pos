import { NextRequest } from "next/server";
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
});
