import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr } from "@/lib/london-date";
import { resolveInventoryLocation } from "@/lib/locations";
import { checkReceiptsForSave } from "@/lib/receipts";
import { cleanReceivedLine } from "@/lib/purchase-orders";

// Marks a PO received: stock goes in via stock_movements (so it's audit-tracked
// like everything else), each ingredient's last-known cost is updated, batch
// expiry dates are recorded and the supplier's invoice photos (migration 110)
// are attached.
//
// All of it is one database transaction (receive_purchase_order, migration
// 115): the status flips to 'received' first, so a double-click, a retry or
// two devices at once can only ever add the delivery to stock once.
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
    const poId = Number(id);
    if (!Number.isInteger(poId) || poId < 1) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const { items, receipt_ids } = await req.json(); // items: [{ item_id, received_quantity, expiry_date }]
    const lines = Array.isArray(items) ? items.map(cleanReceivedLine) : [];
    if (lines.some((l) => l === null)) {
      return NextResponse.json({ error: "Check the quantities and dates — each must be 0 or more, with a valid date." }, { status: 400 });
    }

    // Checked before anything moves, so a missing photo leaves the PO untouched.
    const receipts = await checkReceiptsForSave(db, receipt_ids);
    if (!receipts.ok) return NextResponse.json({ error: receipts.error }, { status: receipts.status });

    const { data, error } = await supabase.rpc("receive_purchase_order", {
      p_business_id: session.businessId,
      p_po_id: poId,
      p_items: lines,
      p_receipt_ids: receipts.ids,
      p_staff_id: session.id,
      p_location_id: location.locationId,
      p_received_on: londonDateStr(),
    });
    if (error) throw error;
    const result = data as { outcome: string; status?: string; purchase_order?: Record<string, unknown> };

    if (result.outcome === "not_found") return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (result.outcome === "wrong_status") {
      const error = result.status === "cancelled" ? "Cannot receive a cancelled order" : "Already received";
      return NextResponse.json({ error }, { status: result.status === "received" ? 409 : 400 });
    }
    if (result.outcome === "photos_taken") {
      return NextResponse.json({ error: "A photo is already used on another entry. Please take a new one." }, { status: 409 });
    }

    return NextResponse.json({ success: true, purchaseOrder: result.purchase_order });
  } catch (error) {
    console.error("Purchase order receive error:", error);
    return NextResponse.json({ error: "Failed to receive purchase order" }, { status: 500 });
  }
}
