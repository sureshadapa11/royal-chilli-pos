import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: () => ({ insert: () => Promise.resolve({ error: null }) }) },
}));

import { DELETE, GET, POST } from "@/app/api/till/device/route";
import { authedRequest } from "@/app/api/_test-helpers";
import { TILL_COOKIE } from "@/lib/till-device";

const manager: SessionUser = { id: 1, name: "Mo", role: "manager", businessId: 1 };
const employee: SessionUser = { id: 2, name: "Eve", role: "employee", businessId: 1 };
const url = "http://localhost/api/till/device";

describe("/api/till/device — Make this device a till", () => {
  it("lets a manager make this device a till of their business", async () => {
    const res = await POST(await authedRequest(url, manager, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.cookies.get(TILL_COOKIE)?.value).toBeTruthy();
  });

  it("refuses an employee", async () => {
    const res = await POST(await authedRequest(url, employee, { method: "POST" }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(TILL_COOKIE)).toBeFalsy();
  });

  it("refuses without a sign-in", async () => {
    expect((await POST(await authedRequest(url, null, { method: "POST" }))).status).toBe(401);
  });

  it("reports whether this device is a till, and can stop it being one", async () => {
    expect(await (await GET(await authedRequest(url, manager))).json()).toEqual({ paired: false, otherBusiness: false });
    const off = await DELETE(await authedRequest(url, manager, { method: "DELETE" }));
    expect(off.status).toBe(200);
    expect(off.cookies.get(TILL_COOKIE)?.value).toBe("");
  });
});
