import type { SessionUser } from "@/lib/types";

type Row = Record<string, unknown>;
let saved: Row | null = null;
const upserts: Row[] = [];
const audits: Row[] = [];

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q,
        maybeSingle: () => Promise.resolve({ data: table === "daily_accounts" ? saved : null, error: null }),
        upsert: (r: Row) => { upserts.push(r); return Promise.resolve({ error: null }); },
        insert: (r: Row) => { audits.push(r); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
}));
jest.mock("@/lib/permissions", () => ({ __esModule: true, canManageFinance: (role: string) => role !== "employee" }));
jest.mock("@/lib/daily-accounts", () => ({ __esModule: true, tillFigures: () => Promise.resolve({ z_report: 480.5 }) }));

import { GET, PUT } from "@/app/api/staff/daily-accounts/route";
import { authedRequest } from "@/app/api/_test-helpers";

const manager: SessionUser = { id: 1, name: "Mo", role: "manager", businessId: 1 };
const admin: SessionUser = { id: 2, name: "Ada", role: "admin", businessId: 1 };
const url = "http://localhost/api/staff/daily-accounts";
const put = async (user: SessionUser, body: Row) => PUT(await authedRequest(url, user, { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => { saved = null; upserts.length = 0; audits.length = 0; });

describe("/api/staff/daily-accounts", () => {
  it("returns the till's figures for a day not entered yet", async () => {
    const res = await GET(await authedRequest(`${url}?date=2026-10-02`, manager));
    expect(await res.json()).toMatchObject({ saved: null, till: { z_report: 480.5 }, locked: false });
  });

  it("saves a draft, rounding to pennies and keeping blanks empty", async () => {
    const res = await put(manager, { date: "2026-10-02", values: { z_report: "480.499", bank_in: "", catering_paid: 50 }, notes: " all good ", submit: false });
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ trading_date: "2026-10-02", z_report: 480.5, bank_in: null, catering_paid: 50, notes: "all good", status: "draft" });
    expect(audits[0]).toMatchObject({ action: "daily_accounts_saved" });
  });

  it("submits, recording who and when", async () => {
    await put(manager, { date: "2026-10-02", values: {}, submit: true });
    expect(upserts[0]).toMatchObject({ status: "submitted", submitted_by: 1 });
  });

  it("locks a submitted day for managers, but an admin can correct it", async () => {
    saved = { status: "submitted" };
    expect((await put(manager, { date: "2026-10-02", values: {}, submit: false })).status).toBe(403);
    expect(upserts).toHaveLength(0);
    expect((await put(admin, { date: "2026-10-02", values: { bank_in: 100 }, submit: false })).status).toBe(200);
    expect(upserts[0]).toMatchObject({ status: "submitted", bank_in: 100 });
    expect(audits[0]).toMatchObject({ action: "daily_accounts_corrected" });
  });

  it("refuses negative amounts and bad dates", async () => {
    expect((await put(manager, { date: "2026-10-02", values: { cash: -5 } })).status).toBe(400);
    expect((await put(manager, { date: "yesterday", values: {} })).status).toBe(400);
  });
});
