import Anthropic from "@anthropic-ai/sdk";
import type { BizDb } from "@/lib/business-db";

// Photo proof for money going out (migration 110). A photo is uploaded on its
// own first — blur-checked on the phone, then read by AI here — and attached
// to its expense / supplier payment / purchase order when that is saved.

export const RECEIPT_BUCKET = "receipts";
export type ReceiptEntity = "expense" | "supplier_payment" | "purchase_order";
export const RECEIPT_ENTITIES: ReceiptEntity[] = ["expense", "supplier_payment", "purchase_order"];

export type ReceiptCheck = {
  status: "passed" | "failed" | "unchecked";
  supplier: string | null;
  date: string | null;
  total: number | null;
  reason: string | null;
};

const SCHEMA = {
  type: "object",
  properties: {
    is_payment_proof: { type: "boolean" },
    readable: { type: "boolean" },
    supplier: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    total: { anyOf: [{ type: "number" }, { type: "null" }] },
    reason: { type: "string" },
  },
  required: ["is_payment_proof", "readable", "supplier", "date", "total", "reason"],
  additionalProperties: false,
};

const PROMPT = `This photo was taken by restaurant staff as proof of money the business paid out: a supplier invoice, delivery note with prices, till receipt, utility bill, or a bank transfer / payment confirmation.

Answer:
- is_payment_proof: true if it is one of those documents. False for anything else (a blank page, a menu, food, a person, a random object).
- readable: true only if a person could clearly read who was paid and the total from this photo. False if it is blurred, cut off, too dark, glared or too far away to read the total.
- supplier: who was paid, as printed, or null.
- date: the document's date as YYYY-MM-DD, or null.
- total: the final total paid or payable in pounds as a number (the grand total including VAT, not a subtotal or a single line), or null if you can't read it.
- reason: one short sentence a member of staff would understand. If something is wrong, say what to do (e.g. "The total is cut off — retake with the whole receipt in the photo").`;

/**
 * Read a receipt photo with Claude. Never throws: if the AI can't be reached
 * (no key, outage) the photo is "unchecked" and staff aren't blocked.
 */
export async function checkReceiptWithAI(image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<ReceiptCheck> {
  const unchecked: ReceiptCheck = { status: "unchecked", supplier: null, date: null, total: null, reason: null };
  if (!process.env.ANTHROPIC_API_KEY) return unchecked;

  try {
    const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    });
    if (response.stop_reason === "refusal") return unchecked;

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return unchecked;
    const out = JSON.parse(text.text) as {
      is_payment_proof: boolean; readable: boolean; supplier: string | null; date: string | null; total: number | null; reason: string;
    };

    const date = out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date) && !Number.isNaN(Date.parse(out.date)) ? out.date : null;
    const total = typeof out.total === "number" && Number.isFinite(out.total) && out.total >= 0 && out.total < 10_000_000
      ? Math.round(out.total * 100) / 100 : null;
    const passed = out.is_payment_proof && out.readable && total !== null;
    let reason = (out.reason || "").slice(0, 300) || null;
    if (!passed && !reason) reason = "This photo can't be read as a receipt. Please retake it.";
    return {
      status: passed ? "passed" : "failed",
      supplier: out.supplier ? out.supplier.slice(0, 200) : null,
      date,
      total,
      reason,
    };
  } catch (err) {
    console.error("Receipt AI check failed:", err);
    return unchecked;
  }
}

type PhotoRow = { id: number; entity_type: string | null; ai_status: string; ai_total: number | null };

const money = (n: number) => `£${n.toFixed(2)}`;

/**
 * Check the photos picked for an entry before saving it: at least one, all
 * this business's, not already used on another entry, and none the AI
 * rejected. If the receipts' total doesn't match the amount typed, the save
 * needs `confirmMismatch` (staff pressed "Save anyway").
 */
export async function checkReceiptsForSave(
  db: BizDb, ids: unknown, amount: number, confirmMismatch: boolean,
): Promise<{ ok: true; ids: number[]; mismatch: boolean } | { ok: false; status: number; error: string; mismatch?: boolean }> {
  const list = Array.isArray(ids) ? [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (list.length === 0) return { ok: false, status: 400, error: "Add a photo of the receipt or invoice first." };
  if (list.length > 10) return { ok: false, status: 400, error: "Up to 10 photos per entry." };

  const { data, error } = await db.from("receipt_photos").select("id, entity_type, ai_status, ai_total").in("id", list);
  if (error) return { ok: false, status: 500, error: "Couldn't check the photos" };
  const rows = (data ?? []) as PhotoRow[];
  if (rows.length !== list.length) return { ok: false, status: 400, error: "A photo is missing. Please add it again." };
  if (rows.some((r) => r.entity_type)) return { ok: false, status: 400, error: "A photo is already used on another entry. Please take a new one." };
  if (rows.some((r) => r.ai_status === "failed")) return { ok: false, status: 400, error: "A photo didn't pass the readability check. Remove it and retake." };

  const totals = rows.map((r) => r.ai_total).filter((t): t is number => t !== null).map(Number);
  let mismatch = false;
  if (totals.length > 0) {
    const sum = totals.reduce((a, b) => a + b, 0);
    const near = (t: number) => Math.abs(t - amount) < 0.015;
    mismatch = !totals.some(near) && !near(sum);
    if (mismatch && !confirmMismatch) {
      const said = totals.length === 1 ? money(totals[0]) : totals.map(money).join(" + ");
      return { ok: false, status: 409, mismatch: true, error: `The receipt says ${said}, but you entered ${money(amount)}.` };
    }
  }
  return { ok: true, ids: list, mismatch };
}

/** Link checked photos to the entry that was just saved. */
export async function attachReceipts(db: BizDb, ids: number[], entity: ReceiptEntity, entityId: number, mismatch: boolean) {
  const { error } = await db
    .from("receipt_photos")
    .update({ entity_type: entity, entity_id: entityId, attached_at: new Date().toISOString(), amount_mismatch: mismatch })
    .in("id", ids)
    .is("entity_type", null);
  if (error) console.error("Attach receipts failed:", error);
}

/** Photos for a set of entries, grouped by entry id — for the lists. */
export async function receiptsFor(db: BizDb, entity: ReceiptEntity, entityIds: number[]) {
  const map = new Map<number, { id: number; ai_status: string; amount_mismatch: boolean }[]>();
  if (entityIds.length === 0) return map;
  const { data } = await db
    .from("receipt_photos")
    .select("id, entity_id, ai_status, amount_mismatch")
    .eq("entity_type", entity)
    .in("entity_id", entityIds)
    .order("id");
  for (const r of (data ?? []) as { id: number; entity_id: number; ai_status: string; amount_mismatch: boolean }[]) {
    const arr = map.get(r.entity_id) ?? [];
    arr.push({ id: r.id, ai_status: r.ai_status, amount_mismatch: r.amount_mismatch });
    map.set(r.entity_id, arr);
  }
  return map;
}
