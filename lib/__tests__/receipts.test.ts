// checkReceiptsForSave: the rules for photo proof when saving money going out.
let photos: Record<string, unknown>[] = [];

import { checkReceiptsForSave } from "@/lib/receipts";
import type { BizDb } from "@/lib/business-db";

const db = {
  from: () => ({
    select: () => ({
      in: (_col: string, ids: number[]) => Promise.resolve({ data: photos.filter((p) => ids.includes(p.id as number)), error: null }),
    }),
  }),
} as unknown as BizDb;

const photo = (id: number, extra: Record<string, unknown> = {}) => ({ id, entity_type: null, ...extra });

beforeEach(() => { photos = [photo(1), photo(2)]; });

describe("photo proof for money going out", () => {
  it("won't save without a photo", async () => {
    expect(await checkReceiptsForSave(db, [])).toMatchObject({ ok: false, status: 400 });
    expect(await checkReceiptsForSave(db, undefined)).toMatchObject({ ok: false, status: 400 });
  });

  it("saves with one or more photos", async () => {
    expect(await checkReceiptsForSave(db, [1])).toEqual({ ok: true, ids: [1] });
    expect(await checkReceiptsForSave(db, [1, 2, 2])).toEqual({ ok: true, ids: [1, 2] });
  });

  it("won't reuse a photo already on another entry", async () => {
    photos = [photo(1, { entity_type: "expense" })];
    expect(await checkReceiptsForSave(db, [1])).toMatchObject({ ok: false, status: 400 });
  });

  it("won't accept a photo from another business (not found in this business)", async () => {
    expect(await checkReceiptsForSave(db, [99])).toMatchObject({ ok: false, status: 400 });
  });
});
