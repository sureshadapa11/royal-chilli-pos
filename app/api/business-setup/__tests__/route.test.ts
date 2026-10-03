import type { SessionUser } from "@/lib/types";

// Records every write so the tests can see exactly what reached the database.
const writes: { table: string; op: string; value: unknown }[] = [];
jest.mock("@/lib/supabase", () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c, eq: () => c, neq: () => c,
      single: async () => ({ data: table === "businesses" ? { id: 1, name: "The Royal Chilli", modules: {} } : null, error: null }),
      maybeSingle: async () => ({ data: table === "business_private" ? { stripe_secret_key_enc: "v1:x:y:z" } : null, error: null }),
      update: (value: unknown) => { writes.push({ table, op: "update", value }); return c; },
      upsert: async (value: unknown) => { writes.push({ table, op: "upsert", value }); return { error: null }; },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
    return c;
  };
  return { __esModule: true, default: { from: chain } };
});
jest.mock("@/lib/business-db", () => ({ __esModule: true, bizDb: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));
jest.mock("@/lib/business", () => ({ __esModule: true, clearBusinessCache: () => {} }));
jest.mock("@/lib/permissions", () => ({ __esModule: true, canAccess: (role: string) => role === "admin" || role === "manager", areaAllows: (role: string) => role === "admin" || role === "manager" }));

import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/business-setup/route";
import { authedRequest } from "@/app/api/_test-helpers";

const owner: SessionUser = { id: 26, name: "Owner", role: "admin", businessId: 1, owner: true };
const admin: SessionUser = { id: 1, name: "Royalchilli", role: "admin", businessId: 1 };
const put = async (user: SessionUser, section: string, values: Record<string, unknown>) =>
  PUT((await authedRequest("http://localhost/api/business-setup", user, { method: "PUT", body: JSON.stringify({ section, values }) })) as NextRequest);

beforeAll(() => { process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); });
beforeEach(() => { writes.length = 0; });

describe("Business setup API", () => {
  it("a business's own admin can change contact details", async () => {
    const res = await put(admin, "details", { phone: "020 8797 3044" });
    expect(res.status).toBe(200);
    expect(writes[0]).toMatchObject({ table: "businesses", op: "update" });
  });

  it("only the owner can change tax, bank, modules or payments", async () => {
    for (const [section, values] of [["tax", { utr: "1234567890" }], ["bank", { bank_name: "X" }], ["modules", { "modules.tables": false }], ["payments", { sumup_merchant_code: "MCRNF79M" }]] as const) {
      expect((await put(admin, section, values)).status).toBe(403);
    }
    expect(writes).toHaveLength(0);
  });

  it("stores a payment key only encrypted", async () => {
    const res = await put(owner, "payments", { stripe_secret_key: "sk_live_abcdefghijklmnop" });
    expect(res.status).toBe(200);
    const saved = JSON.stringify(writes[0].value);
    expect(saved).not.toContain("sk_live");
    expect(saved).toContain("stripe_secret_key_enc");
  });

  it("never sends bank details or keys to a business admin, and never sends keys to anyone", async () => {
    const asAdmin = await (await GET((await authedRequest("http://localhost/api/business-setup", admin)) as NextRequest)).json();
    expect(asAdmin.private).toBeNull();
    const asOwner = await (await GET((await authedRequest("http://localhost/api/business-setup", owner)) as NextRequest)).json();
    expect(asOwner.private.connected.stripe_secret_key).toBe(true);
    expect(JSON.stringify(asOwner)).not.toContain("v1:x:y:z");
  });

  it("refuses badly formatted values", async () => {
    const res = await put(owner, "tax", { vat_number: "123" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields.vat_number).toMatch(/GB/);
  });
});
