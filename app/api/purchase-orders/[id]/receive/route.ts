import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr } from "@/lib/london-date";
import { resolveInventoryLocation } from "@/lib/locations";
import { attachReceipts, checkReceiptsForSave } from "@/lib/receipts";

// Marks a PO received, moves stock via stock_movements (so it's audit-tracked like everything
// else), updates each ingredient's last-known cost, and records batch expiry dates.
// The supplier's invoice must be photographed first (migration 110).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    const { id } = await params;
    const { items, receipt_ids, confirm_amount } = await req.json(); // items: [{ item_id, received_quantity, expiry_date }]

    const { data: po, error: poErr } = await db.from("purchase_orders").select("*").eq("id", id).single();
    if (poErr || !po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (po.status === "received") return NextResponse.json({ error: "Already received" }, { status: 400 });
    if (po.status === "cancelled") return NextResponse.json({ error: "Cannot receive a cancelled order" }, { status: 400 });

    const { data: poItems, error: itemsErr } = await db.from("purchase_order_items").select("*").eq("purchase_order_id", id);
    if (itemsErr) throw itemsErr;

    const overrides = new Map((items || []).map((i: { item_id: number; received_quantity?: number; expiry_date?: string }) => [i.item_id, i]));

    // What the delivery actually cost — this is the ingredient cost in the P&L,
    // so a short delivery mustn't still count at the ordered total.
    type Override = { received_quantity?: number; expiry_date?: string } | undefined;
    const qtyOf = (item: { id: number; quantity: number }) =>
      Math.max(0, Number((overrides.get(item.id) as Override)?.received_quantity ?? item.quantity));
    const receivedCost = Math.round((poItems || []).reduce((sum, item) => sum + qtyOf(item) * Number(item.unit_cost), 0) * 100) / 100;

    // Checked before anything moves, so a missing photo leaves the PO untouched.
    const receipts = await checkReceiptsForSave(db, receipt_ids, receivedCost, confirm_amount === true);
    if (!receipts.ok) return NextResponse.json({ error: receipts.error, mismatch: receipts.mismatch }, { status: receipts.status });

    for (const item of poItems || []) {
      const override = overrides.get(item.id) as Override;
      const receivedQty = qtyOf(item);

      await db.from("purchase_order_items").update({
        received_quantity: receivedQty,
        expiry_date: override?.expiry_date || null,
      }).eq("id", item.id);

      await db.from("stock_movements").insert({
        ingredient_id: item.ingredient_id,
        movement_type: "purchase",
        quantity_delta: receivedQty,
        reference_type: "purchase_order",
        reference_id: po.id,
        reason: `Received on PO ${po.order_number}`,
        staff_id: session.id,
        location_id: location.locationId,
      });

      // Last-known cost, used for recipe costing.
      await db.from("ingredients").update({ cost_per_unit: item.unit_cost }).eq("id", item.ingredient_id);
    }

    const { data: updatedPo, error: updateErr } = await db
      .from("purchase_orders")
      .update({ status: "received", received_date: londonDateStr(), total_cost: receivedCost })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) throw updateErr;
    await attachReceipts(db, receipts.ids, "purchase_order", po.id, receipts.mismatch);

    return NextResponse.json({ success: true, purchaseOrder: updatedPo });
  } catch (error) {
    console.error("Purchase order receive error:", error);
    return NextResponse.json({ error: "Failed to receive purchase order" }, { status: 500 });
  }
}
