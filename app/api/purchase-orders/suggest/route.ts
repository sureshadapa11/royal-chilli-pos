import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import { OPEN_PO_STATUSES, suggestOrder, type SuggestIngredient } from "@/lib/purchase-orders";

// GET — what to order: items at or below their reorder level, less what's
// already on an open order. Fills a draft order; nothing is ordered until a
// manager creates it. Also the last price paid for every ingredient (and
// when), shown as a hint: supplier prices change, so the manager types
// today's price on each order.
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

    // Most recent received line per ingredient: the invoice price if one was
    // entered, otherwise the order price.
    const lastPaid: Record<number, { price: number; date: string | null }> = {};
    const { data: paid } = await db.from("purchase_order_items")
      .select("ingredient_id, unit_cost, received_unit_cost, po:purchase_orders!inner(received_date, status)")
      .eq("po.status", "received")
      .gt("received_quantity", 0)
      .order("id", { ascending: false })
      .limit(2000);
    for (const p of (paid ?? []) as unknown as { ingredient_id: number; unit_cost: number; received_unit_cost: number | null; po: { received_date: string | null } }[]) {
      if (lastPaid[p.ingredient_id]) continue;
      lastPaid[p.ingredient_id] = { price: Number(p.received_unit_cost ?? p.unit_cost), date: p.po?.received_date ?? null };
    }

    const lines = suggestOrder((ingredients ?? []) as SuggestIngredient[], onOrder);
    return NextResponse.json({ lines, lastPaid });
  } catch (error) {
    console.error("Suggest order error:", error);
    return NextResponse.json({ error: "Failed to work out a suggested order" }, { status: 500 });
  }
}
