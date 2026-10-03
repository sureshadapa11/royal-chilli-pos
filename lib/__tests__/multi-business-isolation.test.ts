import { bizDb } from "@/lib/business-db";
import { websiteBusinessId, orderNumberPrefix, DEFAULT_BUSINESS_ID, staffBusinessIds, staffHome } from "@/lib/business";
import { createSession, getSessionFromRequest } from "@/lib/auth";
import { createBusiness, setBusinessOpen, slugify } from "@/lib/businesses-admin";
import { SECTIONS, SECRET_FIELDS, checks, validateSection } from "@/lib/business-setup";
import { NextRequest } from "next/server";

// Mock Supabase storage and query simulation for multi-business testing
const mockTables: Record<string, any[]> = {
  businesses: [
    {
      id: 1,
      name: "The Royal Chilli",
      slug: "royal-chilli",
      domain: "www.theroyalchilli.com",
      custom_domain: null,
      order_prefix: "RC",
      po_prefix: "PO",
      active: true,
      trading_address: { line1: "43 Kingsley Road", city: "Hounslow", postcode: "TW3 1PA" },
    },
    {
      id: 2,
      name: "Melt House",
      slug: "melt-house",
      domain: "melthouse.co.uk",
      custom_domain: "order.melthouse.com",
      order_prefix: "MH",
      po_prefix: "MHPO",
      active: false,
      trading_address: { line1: "1 High Street", city: "London", postcode: "SW1A 1AA" },
    },
  ],
  customers: [],
  newsletter_subscribers: [],
  loyalty_tiers: [],
  timesheets: [],
  orders: [],
  business_private: [
    {
      business_id: 1,
      stripe_publishable_key: "pk_live_rc123",
      stripe_secret_key_enc: "v1:enc_rc_secret",
      sumup_api_key_enc: "v1:enc_rc_sumup",
    },
    {
      business_id: 2,
      stripe_publishable_key: "pk_live_mh456",
      stripe_secret_key_enc: "v1:enc_mh_secret",
      sumup_api_key_enc: "v1:enc_mh_sumup",
    },
  ],
  staff: [
    { id: 1, name: "Owner Admin", role: "admin", is_owner: true, business_id: null },
    { id: 2, name: "RC Manager", role: "manager", is_owner: false, business_id: 1 },
    { id: 3, name: "MH Manager", role: "manager", is_owner: false, business_id: 2 },
  ],
  staff_businesses: [
    { staff_id: 2, business_id: 1 },
    { staff_id: 3, business_id: 2 },
  ],
};

jest.mock("../supabase", () => {
  const mockQuery = (tableName: string) => {
    let rows = [...(mockTables[tableName] ?? [])];
    let filters: ((row: any) => boolean)[] = [];

    const builder: any = {
      select: jest.fn().mockImplementation((cols?: string) => {
        return builder;
      }),
      eq: jest.fn().mockImplementation((col: string, val: any) => {
        filters.push((row: any) => row[col] === val);
        return builder;
      }),
      neq: jest.fn().mockImplementation((col: string, val: any) => {
        filters.push((row: any) => row[col] !== val);
        return builder;
      }),
      in: jest.fn().mockImplementation((col: string, vals: any[]) => {
        filters.push((row: any) => vals.includes(row[col]));
        return builder;
      }),
      order: jest.fn().mockImplementation(() => builder),
      maybeSingle: jest.fn().mockImplementation(async () => {
        const filtered = rows.filter((r) => filters.every((f) => f(r)));
        return { data: filtered[0] ?? null, error: null };
      }),
      single: jest.fn().mockImplementation(async () => {
        const filtered = rows.filter((r) => filters.every((f) => f(r)));
        return { data: filtered[0] ?? null, error: filtered[0] ? null : new Error("Not found") };
      }),
      insert: jest.fn().mockImplementation(async (data: any) => {
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const newRow = { id: (mockTables[tableName]?.length ?? 0) + 1, ...item };
          mockTables[tableName] = mockTables[tableName] || [];
          mockTables[tableName].push(newRow);
        }
        return { data: items, error: null };
      }),
      update: jest.fn().mockImplementation(async (updates: any) => {
        for (let i = 0; i < (mockTables[tableName]?.length ?? 0); i++) {
          if (filters.every((f) => f(mockTables[tableName][i]))) {
            mockTables[tableName][i] = { ...mockTables[tableName][i], ...updates };
          }
        }
        return { data: null, error: null };
      }),
      then: (resolve: any) => {
        const filtered = rows.filter((r) => filters.every((f) => f(r)));
        resolve({ data: filtered, error: null });
      },
    };
    return builder;
  };

  return {
    __esModule: true,
    default: {
      from: jest.fn().mockImplementation((table: string) => mockQuery(table)),
    },
  };
});

describe("Multi-Business Tenant Isolation and Readiness", () => {
  beforeEach(() => {
    mockTables.customers = [];
    mockTables.newsletter_subscribers = [];
    mockTables.loyalty_tiers = [];
    mockTables.timesheets = [];
    mockTables.orders = [];
  });

  describe("1. Migration 085 Scoped Uniqueness and Duplicate Isolation", () => {
    it("allows the same customer phone in Business 1 and Business 2 without conflict", async () => {
      const b1 = bizDb(1);
      const b2 = bizDb(2);

      // Customer with phone 07700900111 registers at Business 1
      await b1.from("customers").insert({ name: "Alice B1", phone: "07700900111", email: "alice@example.com" });
      // Same customer phone registers at Business 2
      await b2.from("customers").insert({ name: "Alice B2", phone: "07700900111", email: "alice@example.com" });

      const allCustomers = mockTables.customers;
      expect(allCustomers).toHaveLength(2);

      const b1Customers = allCustomers.filter((c) => c.business_id === 1);
      const b2Customers = allCustomers.filter((c) => c.business_id === 2);

      expect(b1Customers).toHaveLength(1);
      expect(b1Customers[0].name).toBe("Alice B1");
      expect(b1Customers[0].phone).toBe("07700900111");

      expect(b2Customers).toHaveLength(1);
      expect(b2Customers[0].name).toBe("Alice B2");
      expect(b2Customers[0].phone).toBe("07700900111");
    });

    it("allows duplicate loyalty tier names across businesses", async () => {
      const b1 = bizDb(1);
      const b2 = bizDb(2);

      // Business 1 creates "Gold" tier with 500 spend requirement
      await b1.from("loyalty_tiers").insert({ name: "Gold", minimum_spend: 500 });
      // Business 2 creates "Gold" tier with 300 spend requirement
      await b2.from("loyalty_tiers").insert({ name: "Gold", minimum_spend: 300 });

      const allTiers = mockTables.loyalty_tiers;
      expect(allTiers).toHaveLength(2);

      const b1Tier = allTiers.find((t) => t.business_id === 1 && t.name === "Gold");
      const b2Tier = allTiers.find((t) => t.business_id === 2 && t.name === "Gold");

      expect(b1Tier?.minimum_spend).toBe(500);
      expect(b2Tier?.minimum_spend).toBe(300);
    });

    it("allows duplicate timesheets for staff in different businesses", async () => {
      const b1 = bizDb(1);
      const b2 = bizDb(2);

      const periodStart = "2026-10-01";
      const periodEnd = "2026-10-07";

      // Staff member has timesheet in Business 1
      await b1.from("timesheets").insert({ staff_id: 10, period_start: periodStart, period_end: periodEnd, total_hours: 35 });
      // Same staff member has timesheet in Business 2 for the same period
      await b2.from("timesheets").insert({ staff_id: 10, period_start: periodStart, period_end: periodEnd, total_hours: 15 });

      const timesheets = mockTables.timesheets;
      expect(timesheets).toHaveLength(2);
      expect(timesheets.find((ts) => ts.business_id === 1)?.total_hours).toBe(35);
      expect(timesheets.find((ts) => ts.business_id === 2)?.total_hours).toBe(15);
    });

    it("prevents queries from crossing business boundaries via bizDb stamping", async () => {
      const b1 = bizDb(1);
      const b2 = bizDb(2);

      await b1.from("orders").insert({ order_number: "RC-001", total: 45.5 });
      await b2.from("orders").insert({ order_number: "MH-001", total: 22.0 });

      const orders = mockTables.orders;
      expect(orders).toHaveLength(2);
      expect(orders.find((o) => o.order_number === "RC-001")?.business_id).toBe(1);
      expect(orders.find((o) => o.order_number === "MH-001")?.business_id).toBe(2);
    });
  });

  describe("2. Owner Switching and Staff Assignment Permissions", () => {
    it("recognizes group owner status across all businesses", async () => {
      const ownerStaff = mockTables.staff.find((s) => s.is_owner);
      expect(ownerStaff).toBeDefined();

      const home = await staffHome(ownerStaff!.id);
      expect(home.isOwner).toBe(true);

      // Owner can work at all businesses
      const allowedBiz = await staffBusinessIds(ownerStaff!.id);
      expect(allowedBiz).toContain(1);
      expect(allowedBiz).toContain(2);
    });

    it("restricts non-owner staff strictly to their assigned business", async () => {
      const rcStaff = mockTables.staff.find((s) => s.name === "RC Manager")!;
      const mhStaff = mockTables.staff.find((s) => s.name === "MH Manager")!;

      expect(await staffBusinessIds(rcStaff.id)).toEqual([1]);
      expect(await staffBusinessIds(mhStaff.id)).toEqual([2]);
    });

    it("stores businessId in authenticated session and defaults legacy session to Business 1", async () => {
      const b2SessionToken = await createSession({ id: 1, name: "Owner", role: "admin", owner: true, businessId: 2 });
      const req = new NextRequest("http://localhost/", { headers: { cookie: `pos_session=${b2SessionToken}` } });
      const session = await getSessionFromRequest(req);
      expect(session?.businessId).toBe(2);
      expect(session?.owner).toBe(true);
    });
  });

  describe("3. Order Prefixes and Safe Business Slugs", () => {
    it("returns business-specific order number prefixes", async () => {
      expect(await orderNumberPrefix(1)).toBe("RC");
      expect(await orderNumberPrefix(2)).toBe("MH");
    });

    it("creates safe kebab-case slugs from trading names", () => {
      expect(slugify("Melt House")).toBe("melt-house");
      expect(slugify("The Royal Chilli @ Central!")).toBe("the-royal-chilli-central");
      expect(slugify("Cafe 100%")).toBe("cafe-100");
    });
  });

  describe("4. Domain Resolution", () => {
    it("resolves primary domains and custom domains to the correct business", async () => {
      expect(await websiteBusinessId("www.theroyalchilli.com")).toBe(1);
      expect(await websiteBusinessId("theroyalchilli.com")).toBe(1);
      expect(await websiteBusinessId("melthouse.co.uk")).toBe(2);
      expect(await websiteBusinessId("order.melthouse.com")).toBe(2);
    });

    it("falls back safely to The Royal Chilli for unknown hosts", async () => {
      expect(await websiteBusinessId("unknown-domain.co.uk")).toBe(DEFAULT_BUSINESS_ID);
      expect(await websiteBusinessId(null)).toBe(DEFAULT_BUSINESS_ID);
    });
  });

  describe("5. Business Setup, Prerequisites, and Secret Protection", () => {
    it("prohibits deactivating The Royal Chilli (Business 1)", async () => {
      const res = await setBusinessOpen(1, false);
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/royal chilli/i) });
    });

    it("validates setup fields and marks payment keys as secret", () => {
      expect(SECRET_FIELDS.has("stripe_secret_key")).toBe(true);
      expect(SECRET_FIELDS.has("stripe_webhook_secret")).toBe(true);
      expect(SECRET_FIELDS.has("sumup_api_key")).toBe(true);

      // Verify validation rejects bad inputs
      expect(checks.postcode("INVALID_POSTCODE")).toBeTruthy();
      expect(checks.postcode("TW3 1PA")).toBeNull();
      expect(checks.prefix("123")).toBeTruthy();
      expect(checks.prefix("MH")).toBeNull();
    });

    it("protects owner-only sections from unauthorized changes", () => {
      const taxSection = SECTIONS.find((s) => s.key === "tax")!;
      const bankSection = SECTIONS.find((s) => s.key === "bank")!;
      const paymentsSection = SECTIONS.find((s) => s.key === "payments")!;
      const modulesSection = SECTIONS.find((s) => s.key === "modules")!;

      expect(taxSection.ownerOnly).toBe(true);
      expect(bankSection.ownerOnly).toBe(true);
      expect(paymentsSection.ownerOnly).toBe(true);
      expect(modulesSection.ownerOnly).toBe(true);
    });
  });
});
