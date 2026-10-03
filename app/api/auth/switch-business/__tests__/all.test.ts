import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: () => ({ insert: () => Promise.resolve({ error: null }) }) },
}));
jest.mock("@/lib/business", () => ({
  __esModule: true,
  getBusiness: (id: number) => Promise.resolve(id === 5 ? { id: 5, name: "Melt House" } : null),
}));

import { POST } from "@/app/api/auth/switch-business/route";
import { authedRequest } from "@/app/api/_test-helpers";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";

const owner = { id: 26, name: "Owner", role: "admin", businessId: 1, owner: true } as SessionUser;
const manager: SessionUser = { id: 2, name: "Mo", role: "manager", businessId: 1 };
const url = "http://localhost/api/auth/switch-business";
const post = async (user: SessionUser, businessId: unknown) =>
  POST(await authedRequest(url, user, { method: "POST", body: JSON.stringify({ businessId }) }));

describe("Working in: All businesses", () => {
  it("turns the owner's dashboard to all businesses without changing their login", async () => {
    const res = await post(owner, "all");
    expect(res.status).toBe(200);
    expect(res.cookies.get(ALL_BUSINESSES_COOKIE)?.value).toBe("1");
    expect(res.cookies.get("pos_session")).toBeFalsy();
  });

  it("picking one business ends the All view and switches the login", async () => {
    const res = await post(owner, 5);
    expect(res.status).toBe(200);
    expect(res.cookies.get(ALL_BUSINESSES_COOKIE)?.value).toBe("");
    expect(res.cookies.get("pos_session")?.value).toBeTruthy();
  });

  it("is owner-only", async () => {
    expect((await post(manager, "all")).status).toBe(403);
  });
});
