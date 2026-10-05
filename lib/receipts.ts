import type { BizDb } from "@/lib/business-db";

// Photo proof for money going out (migration 110). A photo is uploaded on its
// own first — checked on the phone for blur, darkness and glare — and attached
// to its expense / supplier payment / purchase order when that is saved.

export const RECEIPT_BUCKET = "receipts";
export type ReceiptEntity = "expense" | "supplier_payment" | "purchase_order";
export const RECEIPT_ENTITIES: ReceiptEntity[] = ["expense", "supplier_payment", "purchase_order"];

type PhotoRow = { id: number; entity_type: string | null };

/**
 * Check the photos picked for an entry before saving it: at least one, all
 * this business's, and not already used on another entry.
 */
export async function checkReceiptsForSave(
  db: BizDb, ids: unknown,
): Promise<{ ok: true; ids: number[] } | { ok: false; status: number; error: string }> {
  const list = Array.isArray(ids) ? [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (list.length === 0) return { ok: false, status: 400, error: "Add a photo of the receipt or invoice first." };
  if (list.length > 10) return { ok: false, status: 400, error: "Up to 10 photos per entry." };

  const { data, error } = await db.from("receipt_photos").select("id, entity_type").in("id", list);
  if (error) return { ok: false, status: 500, error: "Couldn't check the photos" };
  const rows = (data ?? []) as PhotoRow[];
  if (rows.length !== list.length) return { ok: false, status: 400, error: "A photo is missing. Please add it again." };
  if (rows.some((r) => r.entity_type)) return { ok: false, status: 400, error: "A photo is already used on another entry. Please take a new one." };
  return { ok: true, ids: list };
}

/** Link checked photos to the entry that was just saved. */
export async function attachReceipts(db: BizDb, ids: number[], entity: ReceiptEntity, entityId: number) {
  const { error } = await db
    .from("receipt_photos")
    .update({ entity_type: entity, entity_id: entityId, attached_at: new Date().toISOString() })
    .in("id", ids)
    .is("entity_type", null);
  if (error) console.error("Attach receipts failed:", error);
}

/** Photos for a set of entries, grouped by entry id — for the lists. */
export async function receiptsFor(db: BizDb, entity: ReceiptEntity, entityIds: number[]) {
  const map = new Map<number, { id: number }[]>();
  if (entityIds.length === 0) return map;
  const { data } = await db
    .from("receipt_photos")
    .select("id, entity_id")
    .eq("entity_type", entity)
    .in("entity_id", entityIds)
    .order("id");
  for (const r of (data ?? []) as { id: number; entity_id: number }[]) {
    const arr = map.get(r.entity_id) ?? [];
    arr.push({ id: r.id });
    map.set(r.entity_id, arr);
  }
  return map;
}
