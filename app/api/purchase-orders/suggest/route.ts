import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import { OPEN_PO_STATUSES, suggestOrder, type SuggestIngredient } from "@/lib/purchase-orders";

// GET — what to order: items at or below their reorder level, less what's
// already on an open order. Fills a draft order; nothing is ordered until a
// manager creates it.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });

    const [{ data: ingredients, error: ingErr }, { data: openPos }] = await Promise.all([
      db.from("ingredients")
        .select("id, name, unit, supplier_id, current_stock, reorder_level, reorder_quantity, cost_per_unit")
        .eq("active", 1)
        .or(`location_id.eq.${location.locationId},location_id.is.null`),
      db.from("purchase_orders").select("id").in("status", OPEN_PO_STATUSES),
    ]);
    if (ingErr) throw ingErr;

    const onOrder = new Map<number, number>();
    const poIds = (openPos ?? []).map((p) => p.id);
    if (poIds.length) {
      const { data: lines } = await db.from("purchase_order_items").select("ingredient_id, quantity").in("purchase_order_id", poIds);
      for (const l of lines ?? []) onOrder.set(l.ingredient_id, (onOrder.get(l.ingredient_id) ?? 0) + Number(l.quantity));
    }

    return NextResponse.json({ lines: suggestOrder((ingredients ?? []) as SuggestIngredient[], onOrder) });
  } catch (error) {
    console.error("Suggest order error:", error);
    return NextResponse.json({ error: "Failed to work out a suggested order" }, { status: 500 });
  }
}
