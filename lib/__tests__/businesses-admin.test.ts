// A tiny in-memory database for the few query shapes lib/businesses-admin uses.
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let nextId = 1000;

jest.mock("@/lib/supabase", () => {
  const from = (table: string) => {
    const rows = () => (db[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let count = false;
    let op: "select" | "update" | null = null;
    let patch: Row = {};
    const matched = () => rows().filter((r) => filters.every((f) => f(r)));
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (op !== "update") op = "select"; count = !!o?.count; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      like: (c: string, p: string) => { const pre = p.split(String.fromCharCode(92)).join("").replace("%", ""); filters.push((r) => String(r[c]).startsWith(pre)); return q; },
      order: () => q, limit: () => q,
      single: async () => ({ data: matched()[0] ?? null, error: matched()[0] ? null : { message: "none" } }),
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      insert: (v: Row | Row[]) => {
        const list = (Array.isArray(v) ? v : [v]).map((r) => ({ id: nextId++, ...r }));
        rows().push(...list);
        const ins = { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (res: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(res) };
        return ins;
      },
      upsert: async (v: Row[]) => {
        for (const r of v) if (!rows().some((x) => x.business_id === r.business_id && x.key === r.key)) rows().push(r);
        return { error: null };
      },
      update: (v: Row) => { op = "update"; patch = v; return q; },
      then: (res: (x: unknown) => unknown) => {
        if (op === "update") { matched().forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }).then(res); }
        return Promise.resolve(count ? { count: matched().length, error: null } : { data: matched(), error: null }).then(res);
      },
    };
    return q;
  };
  return { __esModule: true, default: { from } };
});
jest.mock("@/lib/business", () => ({ __esModule: true, DEFAULT_BUSINESS_ID: 1, clearBusinessCache: () => {} }));

import { copyRewardsScheme, createBusiness, setBusinessOpen, slugify } from "@/lib/businesses-admin";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.businesses = [
    {
      id: 1,
      name: "The Royal Chilli",
      slug: "royal-chilli",
      order_prefix: "RC",
      active: true,
      display_order: 1,
      trading_address: { line1: "43 Kingsley Road", city: "Hounslow", postcode: "TW3 1PA" },
    },
    {
      id: 2,
      name: "Melt House",
      slug: "melt-house",
      order_prefix: "MH",
      active: false,
      display_order: 2,
      trading_address: { line1: "1 High Street", city: "London", postcode: "SW1A 1AA" },
    },
  ];
  db.loyalty_tiers = [{ id: 10, business_id: 1, name: "Gold", min_lifetime_spend: 500, points_multiplier: 1, sort_order: 2, active: 1 }];
  db.loyalty_rewards = [
    { id: 20, business_id: 1, name: "Welcome 20%", is_welcome_reward: true, eligible_tier_id: null, points_cost: 0 },
    { id: 21, business_id: 1, name: "Gold treat", is_welcome_reward: false, eligible_tier_id: 10, points_cost: 500 },
  ];
  db.business_settings = [
    { business_id: 1, key: "loyalty_points_per_pound", value: 10 },
    { business_id: 1, key: "opening_hours", value: {} },
  ];
});

describe("copying Royal Chilli's rewards scheme", () => {
  it("copies tiers, rewards (tier links remapped) and only the points rules", async () => {
    const r = await copyRewardsScheme(1, 2);
    expect(r).toEqual({ ok: true, value: { tiers: 1, rewards: 2, rules: 1 } });
    const newTier = db.loyalty_tiers.find((t) => t.business_id === 2)!;
    const gold = db.loyalty_rewards.find((x) => x.business_id === 2 && x.name === "Gold treat")!;
    expect(gold.eligible_tier_id).toBe(newTier.id);
    expect(gold.eligible_tier_id).not.toBe(10);
    expect(db.business_settings.filter((s) => s.business_id === 2).map((s) => s.key)).toEqual(["loyalty_points_per_pound"]);
  });

  it("never overwrites a business that already has a scheme", async () => {
    await copyRewardsScheme(1, 2);
    expect(await copyRewardsScheme(1, 2)).toMatchObject({ ok: false, error: /already has a rewards scheme/ });
  });
});

describe("adding a business", () => {
  it("starts closed, with its own prefix and a copied rewards scheme", async () => {
    const r = await createBusiness({ name: "Melt House Richmond", orderPrefix: "mr" });
    expect(r.ok).toBe(true);
    const b = db.businesses.find((x) => x.slug === "melt-house-richmond")!;
    expect(b).toMatchObject({ active: false, order_prefix: "MR" });
    expect(db.loyalty_rewards.some((x) => x.business_id === b.id)).toBe(true);
  });

  it("refuses a prefix or name already in use", async () => {
    expect(await createBusiness({ name: "New Place", orderPrefix: "MH" })).toMatchObject({ ok: false, field: "order_prefix" });
    expect(await createBusiness({ name: "melt house", orderPrefix: "ZZ" })).toMatchObject({ ok: false, field: "name" });
    expect(await createBusiness({ name: "X", orderPrefix: "12" })).toMatchObject({ ok: false, field: "order_prefix" });
  });

  it("refuses reserved slugs", async () => {
    expect(await createBusiness({ name: "admin", orderPrefix: "AD" })).toMatchObject({ ok: false, field: "name", error: /reserved/ });
    expect(await createBusiness({ name: "api", orderPrefix: "AP" })).toMatchObject({ ok: false, field: "name", error: /reserved/ });
    expect(await createBusiness({ name: "staff", orderPrefix: "ST" })).toMatchObject({ ok: false, field: "name", error: /reserved/ });
  });

  it("makes a tidy web name", () => {
    expect(slugify("Melt House — Richmond!")).toBe("melt-house-richmond");
  });
});

describe("opening and closing", () => {
  it("opens a business, and won't close The Royal Chilli", async () => {
    expect(await setBusinessOpen(2, true)).toMatchObject({ ok: true });
    expect(db.businesses.find((b) => b.id === 2)!.active).toBe(true);
    expect(await setBusinessOpen(1, false)).toMatchObject({ ok: false });
  });

  it("refuses to open a business if setup prerequisites are missing", async () => {
    db.businesses[1].trading_address = null;
    const res = await setBusinessOpen(2, true);
    expect(res).toMatchObject({ ok: false, error: /trading address/i });
    expect(db.businesses.find((b) => b.id === 2)!.active).toBe(false);

    db.businesses[1].trading_address = { line1: "1 High St", postcode: "INVALID" };
    const res2 = await setBusinessOpen(2, true);
    expect(res2).toMatchObject({ ok: false, error: /valid UK postcode/i });

    db.businesses[1].order_prefix = "";
    const res3 = await setBusinessOpen(2, true);
    expect(res3).toMatchObject({ ok: false, error: /order prefix/i });
  });
});
