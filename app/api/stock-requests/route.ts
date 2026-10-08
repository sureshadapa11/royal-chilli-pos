import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import type { SessionUser } from "@/lib/types";

// "Request stock" (inventory v2 phase 1, migration 116). The Kitchen Display
// asks for stock; managers turn open requests into a purchase order
// (POST /api/purchase-orders with request_ids) or decline them.

/** Kitchen staff, or anyone who can see Inventory. */
function canRequest(session: SessionUser, method: string): boolean {
  return session.role === "kitchen" || areaAllows(session.role, "inventory", method);
}

// GET — the ingredients to pick from (this branch) and the requests: your own
// from the last 7 days on the kitchen screen; everyone's in Inventory.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canRequest(session, req.method)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    const kitchenView = session.role === "kitchen" || new URL(req.url).searchParams.get("mine") === "1";

    const since = new Date(Date.now() - (kitchenView ? 7 : 30) * 86_400_000).toISOString();
    let requests = db.from("stock_requests")
      .select("id, ingredient_id, item_name, quantity, unit, reason, status, created_at, handled_at, decline_reason, purchase_order_id, ingredient:ingredients(name), requester:staff!stock_requests_requested_by_fkey(name), handler:staff!stock_requests_handled_by_fkey(name), po:purchase_orders(order_number, status)")
      .or(`status.eq.open,created_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (kitchenView) requests = requests.eq("requested_by", session.id);

    const [{ data: ingredients }, { data: rows, error }] = await Promise.all([
      db.from("ingredients").select("id, name, unit").eq("active", 1)
        .or(`location_id.eq.${location.locationId},location_id.is.null`).order("name"),
      requests,
    ]);
    if (error) throw error;

    return NextResponse.json({
      ingredients: ingredients ?? [],
      requests: (rows ?? []).map((r) => {
        const { ingredient, requester, handler, po, ...rest } = r as typeof r & {
          ingredient: { name: string } | null; requester: { name: string } | null; handler: { name: string } | null;
          po: { order_number: string; status: string } | null;
        };
        return {
          ...rest,
          name: ingredient?.name ?? r.item_name,
          requested_by_name: requester?.name ?? null,
          handled_by_name: handler?.name ?? null,
          order_number: po?.order_number ?? null,
          po_status: po?.status ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Stock requests fetch error:", error);
    return NextResponse.json({ error: "Failed to load stock requests" }, { status: 500 });
  }
}

// POST { ingredient_id | item_name, quantity, reason }
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canRequest(session, req.method)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });

    const body = await req.json();
    const quantity = Number(body.quantity);
    const ingredientId = body.ingredient_id ? Number(body.ingredient_id) : null;
    const itemName = typeof body.item_name === "string" ? body.item_name.trim().slice(0, 80) : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    if (!(quantity > 0) || quantity > 100000) return NextResponse.json({ error: "Enter how much you need." }, { status: 400 });
    if (!ingredientId && !itemName) return NextResponse.json({ error: "Pick an item, or type what you need." }, { status: 400 });

    let unit: string | null = typeof body.unit === "string" ? body.unit.trim().slice(0, 20) || null : null;
    if (ingredientId) {
      if (!Number.isInteger(ingredientId) || !(await allOwned(db, "ingredients", [ingredientId]))) {
        return NextResponse.json({ error: "That item isn't on this business's list." }, { status: 400 });
      }
      const { data: ing } = await db.from("ingredients").select("unit").eq("id", ingredientId).maybeSingle();
      unit = ing?.unit ?? unit;

      // Two chefs asking for the same thing: say so instead of a second request.
      const { data: open } = await db.from("stock_requests")
        .select("id, quantity, created_at, requester:staff!stock_requests_requested_by_fkey(name)")
        .eq("ingredient_id", ingredientId).eq("status", "open").eq("location_id", location.locationId).limit(1);
      const dup = open?.[0] as { quantity: number; created_at: string; requester: { name: string } | null } | undefined;
      if (dup) {
        const at = new Date(dup.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
        return NextResponse.json({ error: `Already asked for (${Number(dup.quantity)} ${unit ?? ""}) by ${dup.requester?.name ?? "someone"} at ${at}. It's waiting for a manager.` }, { status: 409 });
      }
    }

    const { data, error } = await db.from("stock_requests").insert({
      location_id: location.locationId,
      ingredient_id: ingredientId,
      item_name: ingredientId ? null : itemName,
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      reason: reason || null,
      requested_by: session.id,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, request: data }, { status: 201 });
  } catch (error) {
    console.error("Stock request create error:", error);
    return NextResponse.json({ error: "Failed to send the request" }, { status: 500 });
  }
}
