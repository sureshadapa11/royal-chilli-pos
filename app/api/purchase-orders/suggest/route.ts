import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import { OPEN_PO_STATUSES, suggestOrder, type SuggestIngredient } from "@/lib/purchase-orders";

// GET — what to order: items at or below their reorder level (less what's
// already on an open order), and the kitchen's open stock requests. Fills a
// draft order; nothing is ordered until a manager creates it.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });

    const [{ data: ingredients, error: ingErr }, { data: openPos }, { data: requests }] = await Promise.all([
      db.from("ingredients")
        .select("id, name, unit, supplier_id, current_stock, reorder_level, reorder_quantity, cost_per_unit")
        .eq("active", 1)
        .or(`location_id.eq.${location.locationId},location_id.is.null`),
      db.from("purchase_orders").select("id").in("status", OPEN_PO_STATUSES),
      db.from("stock_requests")
        .select("id, ingredient_id, item_name, quantity, unit, reason, created_at, requester:staff!stock_requests_requested_by_fkey(name)")
        .eq("status", "open")
        .order("created_at"),
    ]);
    if (ingErr) throw ingErr;

    const onOrder = new Map<number, number>();
    const poIds = (openPos ?? []).map((p) => p.id);
    if (poIds.length) {
      const { data: lines } = await db.from("purchase_order_items").select("ingredient_id, quantity").in("purchase_order_id", poIds);
      for (const l of lines ?? []) onOrder.set(l.ingredient_id, (onOrder.get(l.ingredient_id) ?? 0) + Number(l.quantity));
    }

    const byId = new Map((ingredients ?? []).map((i) => [i.id, i]));
    return NextResponse.json({
      lines: suggestOrder((ingredients ?? []) as SuggestIngredient[], onOrder),
      requests: (requests ?? []).map((r) => {
        const { requester, ...rest } = r as typeof r & { requester: { name: string } | null };
        const ing = r.ingredient_id != null ? byId.get(r.ingredient_id) : undefined;
        return {
          ...rest,
          name: ing?.name ?? r.item_name,
          supplier_id: ing?.supplier_id ?? null,
          unit_cost: Number(ing?.cost_per_unit ?? 0),
          requested_by_name: requester?.name ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Suggest order error:", error);
    return NextResponse.json({ error: "Failed to work out a suggested order" }, { status: 500 });
  }
}
