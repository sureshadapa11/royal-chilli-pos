// checkReceiptsForSave: the rules for photo proof when saving money going out.
let photos: Record<string, unknown>[] = [];

jest.mock("@anthropic-ai/sdk", () => ({ __esModule: true, default: jest.fn() }));

import { checkReceiptsForSave } from "@/lib/receipts";
import type { BizDb } from "@/lib/business-db";

const db = {
  from: () => ({
    select: () => ({
      in: (_col: string, ids: number[]) => Promise.resolve({ data: photos.filter((p) => ids.includes(p.id as number)), error: null }),
    }),
  }),
} as unknown as BizDb;

const photo = (id: number, extra: Record<string, unknown> = {}) => ({ id, entity_type: null, ai_status: "passed", ai_total: 84.5, ...extra });

beforeEach(() => { photos = [photo(1), photo(2, { ai_total: 15.5 }), photo(3, { ai_status: "unchecked", ai_total: null })]; });

describe("photo proof for money going out", () => {
  it("won't save without a photo", async () => {
    const r = await checkReceiptsForSave(db, [], 84.5, false);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(await checkReceiptsForSave(db, undefined, 84.5, false)).toMatchObject({ ok: false });
  });

  it("saves when the receipt total matches", async () => {
    expect(await checkReceiptsForSave(db, [1], 84.5, false)).toEqual({ ok: true, ids: [1], mismatch: false });
  });

  it("matches the total of several pages added together", async () => {
    expect(await checkReceiptsForSave(db, [1, 2], 100, false)).toEqual({ ok: true, ids: [1, 2], mismatch: false });
  });

  it("stops on a different amount until confirmed, then saves it flagged", async () => {
    const r = await checkReceiptsForSave(db, [1], 48.5, false);
    expect(r).toMatchObject({ ok: false, status: 409, mismatch: true });
    expect((r as { error: string }).error).toContain("£84.50");
    expect(await checkReceiptsForSave(db, [1], 48.5, true)).toEqual({ ok: true, ids: [1], mismatch: true });
  });

  it("allows a photo the AI couldn't check (AI down) — nothing to compare", async () => {
    expect(await checkReceiptsForSave(db, [3], 12, false)).toEqual({ ok: true, ids: [3], mismatch: false });
  });

  it("won't reuse a photo already on another entry", async () => {
    photos = [photo(1, { entity_type: "expense" })];
    expect(await checkReceiptsForSave(db, [1], 84.5, false)).toMatchObject({ ok: false, status: 400 });
  });

  it("won't accept a photo from another business (not found in this business)", async () => {
    expect(await checkReceiptsForSave(db, [99], 84.5, false)).toMatchObject({ ok: false, status: 400 });
  });

  it("won't accept a photo the AI rejected", async () => {
    photos = [photo(1, { ai_status: "failed" })];
    expect(await checkReceiptsForSave(db, [1], 84.5, false)).toMatchObject({ ok: false, status: 400 });
  });
});
